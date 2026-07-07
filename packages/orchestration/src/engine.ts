// Durable-workflow abstraction (handbook Ch 8, §18.3). The proactive loop's
// three trigger intakes all reduce to two trigger shapes here: inbound and
// internal events are `event` triggers; scheduled scans are `cron` triggers.
// Execution state lives in the engine behind this seam; swapping vendors is
// an adapter, not a migration.

export type WorkflowTrigger = { event: string } | { cron: string };

export type WorkflowEvent = {
  name: string;
  data: Record<string, unknown>;
  /**
   * Dedup id for the event intake: a retried send() with the same id must not
   * re-trigger workflows (the intake to an idempotent system is itself
   * idempotent, §18.5.7). Inngest dedupes on it natively.
   */
  id?: string;
};

export type WorkflowStep = {
  /**
   * A durable, memoized unit of work: retried runs skip completed steps.
   * Return values must be JSON-serializable — durable engines memoize by
   * JSON round-trip, so a Date/Map/class instance survives the first run and
   * silently corrupts on replay.
   */
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Day-spanning waits without hand-rolled cron-plus-state (§18.3). */
  sleepUntil(name: string, until: Date): Promise<void>;
};

export type WorkflowDefinition = {
  id: string;
  trigger: WorkflowTrigger;
  handler(event: WorkflowEvent, step: WorkflowStep): Promise<unknown>;
};

export type WorkflowEngine = {
  register(definition: WorkflowDefinition): void;
  send(event: WorkflowEvent): Promise<void>;
};

/**
 * Non-durable engine for tests and local semantics: steps run immediately and
 * are logged as `workflowId:stepName`. Durability is the adapter's concern.
 */
export class InMemoryWorkflowEngine implements WorkflowEngine {
  private readonly definitions: WorkflowDefinition[] = [];
  readonly stepLog: string[] = [];

  register(definition: WorkflowDefinition): void {
    this.definitions.push(definition);
  }

  async send(event: WorkflowEvent): Promise<void> {
    for (const definition of this.definitions) {
      if ("event" in definition.trigger && definition.trigger.event === event.name) {
        await definition.handler(event, this.stepFor(definition.id));
      }
    }
  }

  private stepFor(workflowId: string): WorkflowStep {
    return {
      run: async (name, fn) => {
        this.stepLog.push(`${workflowId}:${name}`);
        return fn();
      },
      sleepUntil: async (name) => {
        this.stepLog.push(`${workflowId}:${name}`);
      },
    };
  }
}
