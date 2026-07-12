import type { Sql } from "postgres";
import { resequence } from "./sequence";

// Re-planning (§12.4): drop the pushed-back Action and re-sequence the rest,
// preserving completed work (the ratchet). Runs under the founder's scope
// (RLS). The pure `resequence` re-validates the DAG after the mutation (A4), so
// dropping an Action can never leave a cycle, an orphaned dependency, or a
// mutable Action ordered before something it still depends on.

const FROZEN_STATUSES = new Set(["done", "in_progress"]);

type ActionRow = {
  id: string;
  sequence_index: number;
  depends_on_action_ids: string[] | null;
  status: string;
};

export async function resequencePlan(
  trx: Sql,
  planId: string,
  dropActionId: string,
): Promise<void> {
  const rows = await trx<ActionRow[]>`
    select id, sequence_index, depends_on_action_ids, status
    from actions where plan_id = ${planId}`;

  const kept = rows.filter((r) => r.id !== dropActionId);
  const keptIds = new Set(kept.map((r) => r.id));

  // Drop the action and remove it from every remaining dependency list — a
  // dependent loses the prerequisite rather than being orphaned by a dangling id.
  const nodes = kept.map((r) => ({
    key: r.id,
    dependsOn: (r.depends_on_action_ids ?? []).filter((d) => keptIds.has(d)),
  }));
  const frozen = new Map(
    kept.filter((r) => FROZEN_STATUSES.has(r.status)).map((r) => [r.id, r.sequence_index]),
  );

  const resequenced = resequence(nodes, frozen);
  for (const node of resequenced) {
    await trx`
      update actions
      set sequence_index = ${node.sequenceIndex}, depends_on_action_ids = ${node.dependsOn},
        updated_at = now()
      where id = ${node.key}`;
  }

  await trx`update actions set status = 'dropped', updated_at = now() where id = ${dropActionId}`;
}
