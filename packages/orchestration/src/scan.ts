import type { WorkflowEngine, WorkflowEvent } from "./engine";

// The scheduled-scan intake (§8.2, §18.3): a cron-triggered workflow that
// sweeps for time/momentum triggers (stalled actions, idle threads, arriving
// deadlines) and emits one internal event per detection. Orchestration owns
// detecting; the Founder Model's policy owns deciding the response (§8.2) —
// so the sweep is injected by the capability that knows what to look for.

export type ScheduledScanOptions = {
  id: string;
  cron: string;
  /**
   * Detect triggers; returns the internal events to emit (may be empty).
   * The dedup id is mandatory: a crash between emission and checkpoint makes
   * the emit step at-least-once, and the id is what collapses it to once.
   */
  sweep: () => Promise<(WorkflowEvent & { id: string })[]>;
};

export function registerScheduledScan(engine: WorkflowEngine, options: ScheduledScanOptions): void {
  const { id, cron, sweep } = options;
  engine.register({
    id,
    trigger: { cron },
    handler: async (_event, step) => {
      const detected = await step.run("sweep", sweep);
      for (const event of detected) {
        if (!event.id) throw new Error(`scan "${id}" produced an event without a dedup id`);
        // One durable step per emission: a crash mid-loop re-emits only the
        // events not yet checkpointed, deduped downstream by their id.
        await step.run(`emit:${event.name}:${event.id}`, () => engine.send(event));
      }
    },
  });
}
