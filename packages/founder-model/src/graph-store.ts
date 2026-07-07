import type { JsonValue } from "@tethr/orchestration";
import type { Sql } from "postgres";

// The Graph layer store (§6.2, §19.1): entities and typed, bi-temporal
// relationships extracted from episodes. Facts are invalidated on
// supersession, never deleted — tethr can always explain how its read
// changed. Founder-scoped transactions only.

export type EntityRef = { entityType: string; name: string };

export type Fact = {
  source: EntityRef;
  relation: string;
  target: EntityRef;
  attributes?: { [key: string]: JsonValue };
  provenanceEpisodeIds?: readonly string[];
};

export type LiveFact = {
  id: string;
  source: EntityRef;
  relation: string;
  target: EntityRef;
  validFrom: Date;
  provenanceEpisodeIds: string[];
};

/** Find-or-create an entity by (type, name); returns its id. */
export async function upsertEntity(sql: Sql, entity: EntityRef): Promise<string> {
  const [existing] = await sql<{ id: string }[]>`
    select id from graph_entities
    where entity_type = ${entity.entityType} and name = ${entity.name}
      and tombstoned_at is null`;
  if (existing) return existing.id;
  const [created] = await sql<{ id: string }[]>`
    insert into graph_entities (entity_type, name) values (${entity.entityType}, ${entity.name})
    returning id`;
  return (created as { id: string }).id;
}

/**
 * Assert a fact. If a live edge with the same (source, relation) points at a
 * DIFFERENT target, that fact is superseded: invalidated bi-temporally and
 * replaced. Re-asserting the identical fact just extends its provenance.
 */
export async function assertFact(
  sql: Sql,
  fact: Fact,
): Promise<{ id: string; superseded: string | null }> {
  const sourceId = await upsertEntity(sql, fact.source);
  const targetId = await upsertEntity(sql, fact.target);
  const provenance = (fact.provenanceEpisodeIds ?? []) as string[];

  const [live] = await sql<{ id: string; target_entity_id: string }[]>`
    select id, target_entity_id from graph_edges
    where source_entity_id = ${sourceId} and relation = ${fact.relation}
      and invalidated_at is null`;

  if (live && live.target_entity_id === targetId) {
    await sql`update graph_edges
      set provenance_episode_ids = (
        select array(select distinct unnest(provenance_episode_ids || ${provenance})))
      where id = ${live.id}`;
    return { id: live.id, superseded: null };
  }
  if (live) {
    await sql`update graph_edges set invalidated_at = now(), valid_to = now()
      where id = ${live.id}`;
  }
  const [created] = await sql<{ id: string }[]>`
    insert into graph_edges (source_entity_id, target_entity_id, relation, attributes, valid_from, provenance_episode_ids)
    values (${sourceId}, ${targetId}, ${fact.relation}, ${sql.json(fact.attributes ?? {})}, now(), ${provenance})
    returning id`;
  return { id: (created as { id: string }).id, superseded: live?.id ?? null };
}

/** Live (non-invalidated) facts, joined to entity names, newest first. */
export async function liveFacts(sql: Sql, filter?: { relation?: string }): Promise<LiveFact[]> {
  const rows = await sql<
    {
      id: string;
      relation: string;
      valid_from: Date;
      provenance_episode_ids: string[];
      source_type: string;
      source_name: string;
      target_type: string;
      target_name: string;
    }[]
  >`
    select e.id, e.relation, e.valid_from, e.provenance_episode_ids,
      s.entity_type as source_type, s.name as source_name,
      t.entity_type as target_type, t.name as target_name
    from graph_edges e
    join graph_entities s on s.id = e.source_entity_id
    join graph_entities t on t.id = e.target_entity_id
    where e.invalidated_at is null
      ${filter?.relation ? sql`and e.relation = ${filter.relation}` : sql``}
    order by e.valid_from desc`;
  return rows.map((row) => ({
    id: row.id,
    relation: row.relation,
    validFrom: row.valid_from,
    provenanceEpisodeIds: row.provenance_episode_ids,
    source: { entityType: row.source_type, name: row.source_name },
    target: { entityType: row.target_type, name: row.target_name },
  }));
}
