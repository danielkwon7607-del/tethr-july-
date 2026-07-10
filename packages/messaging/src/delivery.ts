import {
  RECONCILIATION_EVENT,
  registerScheduledScan,
  type WorkflowEngine,
} from "@tethr/orchestration";
import type { Sql } from "postgres";

// The delivery-reconciliation scan (design D2, reviewed 3×): aimed at the
// artifact that actually survives a stuck send — a stale `pending` claim in
// action_ledger. (A workflow that died before/during dispatch leaves exactly
// this row; ambiguous claims are already surfaced by runExternalAction; a
// crash-then-replay heals via memoization and never looks stuck.) The event
// id reuses runExternalAction's exact format, so an incident already asked
// about dedups away instead of double-asking the founder (§8.5).
//
// Cross-founder by nature: runs under service role — enumerated as a
// §18.5.4 exception alongside the inbound resolver (ADR 0009).

export const DELIVERY_SCAN_ID = "messaging.delivery-scan";

export function registerDeliveryScan(
  engine: WorkflowEngine,
  options: {
    /** Service-role connection (RLS-bypassing, enumerated §18.5.4). */
    serviceSql: Sql;
    olderThanMinutes?: number;
    cron?: string;
  },
): void {
  const olderThanMinutes = options.olderThanMinutes ?? 30;
  registerScheduledScan(engine, {
    id: DELIVERY_SCAN_ID,
    cron: options.cron ?? "*/15 * * * *",
    sweep: async () => {
      const stale = await options.serviceSql<
        { action_type: string; idempotency_key: string }[]
      >`select action_type, idempotency_key from action_ledger
        where action_type = 'message.send' and status = 'pending'
          and created_at < now() - make_interval(mins => ${olderThanMinutes})`;
      return stale.map((claim) => ({
        name: RECONCILIATION_EVENT,
        id: `${RECONCILIATION_EVENT}:${claim.action_type}:${claim.idempotency_key}`,
        data: { actionType: claim.action_type, idempotencyKey: claim.idempotency_key },
      }));
    },
  });
}
