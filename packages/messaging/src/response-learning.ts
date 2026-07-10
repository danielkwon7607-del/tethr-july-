import { reweightPolicy } from "@tethr/founder-model";
import type { WorkflowEngine } from "@tethr/orchestration";
import { type FounderScopedRunner, INBOUND_MESSAGE_EVENT } from "./runtime";

// Response-driven policy learning (§6.9): delivery is not efficacy — a founder
// REPLY is. When the founder answers, the most recent proactive initiation
// that preceded the reply is credited positive, so the policy reweights toward
// what actually lands for this founder (memify-style, §6.15). Decoupled from
// execution (§10.4): a separate workflow on the inbound event, not a hook in
// the hot inbound path.

export const RESPONSE_LEARNING_WORKFLOW_ID = "messaging.response-learning";

const EPOCH = new Date(0);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResponseLearningDeps = { runScoped: FounderScopedRunner };

export function registerResponseLearning(engine: WorkflowEngine, deps: ResponseLearningDeps): void {
  engine.register({
    id: RESPONSE_LEARNING_WORKFLOW_ID,
    trigger: { event: INBOUND_MESSAGE_EVENT },
    handler: async (event) => {
      // Both ids decide/scope the reads below — treat them as untrusted input
      // (ADR 0008's class), matching the sibling handlers. A non-UUID messageId
      // would otherwise be a hard uuid-cast error, not a graceful no-op.
      const founderId = event.data.founderId as string;
      const messageId = event.data.messageId as string;
      if (!UUID_PATTERN.test(founderId ?? "") || !UUID_PATTERN.test(messageId ?? "")) return;

      await deps.runScoped(founderId, async (trx) => {
        const [inbound] = await trx<{ created_at: Date }[]>`
          select created_at from messages where id = ${messageId} and direction = 'in'`;
        if (!inbound) return;

        // The window opens at the founder's PREVIOUS reply: an initiation is
        // credited by the first reply after it, and only once — the next
        // reply's window starts here, excluding an already-credited act.
        const [previous] = await trx<{ created_at: Date }[]>`
          select created_at from messages
          where direction = 'in' and created_at < ${inbound.created_at}
          order by created_at desc limit 1`;
        const since = previous?.created_at ?? EPOCH;

        // Delivery is not efficacy — but neither is a decision that never
        // reached the founder. `decideAndRecord` logs 'act' BEFORE the send,
        // which can still fail or resolve ambiguous (no 'sent' row). Credit the
        // initiation only if an outbound was actually delivered in the window.
        const [delivered] = await trx<{ n: number }[]>`
          select 1 as n from messages
          where direction = 'out' and status = 'sent'
            and created_at > ${since} and created_at < ${inbound.created_at}
          limit 1`;
        if (!delivered) return;

        // The proactive initiation the founder is answering: the most recent
        // acted decision in the window (§6.12's only actor on policy_decisions).
        const [initiation] = await trx<{ behavior: string }[]>`
          select behavior from policy_decisions
          where decision = 'act'
            and created_at > ${since} and created_at < ${inbound.created_at}
          order by created_at desc limit 1`;
        if (initiation) await reweightPolicy(trx, initiation.behavior, "positive");
      });
    },
  });
}
