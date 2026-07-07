import type { WorkflowEngine, WorkflowEvent } from "./engine";

// Two of the three trigger intakes of §8.2/§18.3 as typed seams (the third —
// scheduled scans — is registerScheduledScan in ./scan). Inbound events come
// from webhooks, which redeliver; the dedup id is therefore mandatory here
// and merely optional on raw send().

export type InboundEvent = WorkflowEvent & { id: string };

/** Inbound intake (channel webhooks, founder replies). Dedup id required. */
export async function sendInbound(engine: WorkflowEngine, event: InboundEvent): Promise<void> {
  if (!event.id) {
    throw new Error(`Inbound event "${event.name}" requires a dedup id (§18.5.7)`);
  }
  await engine.send(event);
}

/** Internal intake (stage transitions: verdict landed → plan, …). */
export async function sendInternal(engine: WorkflowEngine, event: WorkflowEvent): Promise<void> {
  await engine.send(event);
}
