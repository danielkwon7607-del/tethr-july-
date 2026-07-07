// Durable-workflow abstraction (handbook Ch 8, §18.3). The proactive loop's
// three trigger intakes all reduce to two trigger shapes here: inbound and
// internal events are `event` triggers; scheduled scans are `cron` triggers.
// Execution state lives in the engine behind this seam; swapping vendors is
// an adapter, not a migration.

export type WorkflowTrigger = { event: string } | { cron: string };

/**
 * What may cross a durable boundary: durable engines memoize step results and
 * event payloads by JSON round-trip, so a Date/Map/class instance survives the
 * first run and silently corrupts on replay. The constraint makes that a
 * compile error instead of a production surprise.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type WorkflowEvent = {
  name: string;
  data: Record<string, JsonValue>;
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
   * `void` is admitted for fire-and-forget steps (Inngest memoizes it as
   * null, which is harmless when the result is ignored).
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: fire-and-forget closures return Promise<void>, which `undefined` would not admit
  run<T extends JsonValue | void>(name: string, fn: () => Promise<T>): Promise<T>;
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
  private readonly seenEventIds = new Set<string>();
  readonly stepLog: string[] = [];

  register(definition: WorkflowDefinition): void {
    this.definitions.push(definition);
  }

  async send(event: WorkflowEvent): Promise<void> {
    // Model Inngest's event-id dedup so exactly-once claims that rest on it
    // are actually exercised by tests.
    if (event.id !== undefined) {
      if (this.seenEventIds.has(event.id)) return;
      this.seenEventIds.add(event.id);
    }
    for (const definition of this.definitions) {
      if ("event" in definition.trigger && definition.trigger.event === event.name) {
        await definition.handler(event, this.stepFor(definition.id));
      }
    }
  }

  /**
   * Test affordance: fire a cron-triggered workflow by id, as the scheduler
   * would. Erroring on an unknown id catches typos that would otherwise be a
   * workflow that silently never runs.
   */
  async fireCron(workflowId: string): Promise<void> {
    const definition = this.definitions.find(
      (candidate) => candidate.id === workflowId && "cron" in candidate.trigger,
    );
    if (!definition) throw new Error(`no cron workflow registered with id "${workflowId}"`);
    await definition.handler({ name: `cron:${workflowId}`, data: {} }, this.stepFor(definition.id));
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
