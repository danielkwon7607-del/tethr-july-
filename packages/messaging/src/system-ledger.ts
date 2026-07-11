import type { ActionLedger, ActionRecord, ActionStatus } from "@tethr/core";
import type { Sql } from "postgres";

// The §18.5.7 ledger for a PRE-IDENTIFICATION irreversible action — one with no
// founder yet (the unrecognized-inbound reply, Ch 10 amendment). It writes
// null-founder rows into the one action_ledger through the claim_system_action /
// record_system_action_outcome definers (migration 0011), so audit-before-
// dispatch and idempotency hold without a founder scope and without a parallel
// audit store (Constitution VII). Same contract as PgActionLedger, over the
// null-founder partition of the claim index.

const CLAIM_RETRIES = 3;

export class SystemActionLedger implements ActionLedger {
  constructor(private readonly sql: Sql) {}

  async claimIntent(actionType: string, idempotencyKey: string): Promise<"claimed" | ActionStatus> {
    // The definer returns 'retry' when a race winner has since flipped to
    // 'failed' (the live row vanished) — re-attempt the claim, same window
    // PgActionLedger handles.
    for (let attempt = 0; attempt < CLAIM_RETRIES; attempt += 1) {
      const [row] = await this.sql<{ result: string }[]>`
        select claim_system_action(${actionType}, ${idempotencyKey}) as result`;
      if (row?.result && row.result !== "retry") {
        return row.result as "claimed" | ActionStatus;
      }
    }
    throw new Error(`Could not claim system action ${actionType}:${idempotencyKey} — contention`);
  }

  async recordOutcome(
    actionType: string,
    idempotencyKey: string,
    status: Exclude<ActionStatus, "pending">,
    detail?: string,
  ): Promise<void> {
    await this.sql`
      select record_system_action_outcome(
        ${actionType}, ${idempotencyKey}, ${status}, ${detail ?? null})`;
  }

  async list(): Promise<readonly ActionRecord[]> {
    const rows = await this.sql<
      {
        action_type: string;
        idempotency_key: string;
        status: ActionStatus;
        created_at: Date;
        detail: string | null;
      }[]
    >`select action_type, idempotency_key, status, created_at, detail
      from action_ledger where founder_id is null order by created_at, id`;
    return rows.map((row) => ({
      actionType: row.action_type,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      at: row.created_at,
      ...(row.detail !== null ? { detail: row.detail } : {}),
    }));
  }
}
