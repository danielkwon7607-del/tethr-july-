import type { ActionLedger, ActionRecord, ActionStatus } from "@tethr/core";
import type { Sql } from "postgres";

// Postgres ActionLedger (§18.5.7): the claim and the intent audit row are one
// atomic INSERT against the partial unique index action_ledger_claim. The
// founder linkage comes from the connection's app.founder_id (column default
// + RLS), so a context-less connection cannot write intent rows.

const CLAIM_RETRIES = 3;

export class PgActionLedger implements ActionLedger {
  constructor(private readonly sql: Sql) {}

  async claimIntent(actionType: string, idempotencyKey: string): Promise<"claimed" | ActionStatus> {
    // A lost race can also see the racing row flip to 'failed' between our
    // conflict and our read; retry the insert in that narrow window.
    for (let attempt = 0; attempt < CLAIM_RETRIES; attempt += 1) {
      const inserted = await this.sql<{ status: ActionStatus }[]>`
        insert into action_ledger (action_type, idempotency_key)
        values (${actionType}, ${idempotencyKey})
        on conflict (action_type, idempotency_key) where status <> 'failed' do nothing
        returning status`;
      if (inserted.length > 0) return "claimed";
      const existing = await this.sql<{ status: ActionStatus }[]>`
        select status from action_ledger
        where action_type = ${actionType}
          and idempotency_key = ${idempotencyKey}
          and status <> 'failed'`;
      const status = existing[0]?.status;
      if (status) return status;
    }
    throw new Error(
      `Could not claim or observe ${actionType}:${idempotencyKey} — ledger contention`,
    );
  }

  async recordOutcome(
    actionType: string,
    idempotencyKey: string,
    status: Exclude<ActionStatus, "pending">,
    detail?: string,
  ): Promise<void> {
    const updated = await this.sql<{ id: string }[]>`
      update action_ledger
      set status = ${status}, detail = ${detail ?? null}, resolved_at = now()
      where action_type = ${actionType}
        and idempotency_key = ${idempotencyKey}
        and status = 'pending'
      returning id`;
    if (updated.length === 0) {
      throw new Error(
        `No pending intent row for ${actionType}:${idempotencyKey} — outcome without claim`,
      );
    }
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
    >`
      select action_type, idempotency_key, status, created_at, detail
      from action_ledger
      order by created_at, id`;
    return rows.map((row) => ({
      actionType: row.action_type,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      at: row.created_at,
      ...(row.detail !== null ? { detail: row.detail } : {}),
    }));
  }
}
