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
  /**
   * 'one' (default): a new target supersedes the old — the relation holds one
   * value at a time (pursues, stage). 'many': targets coexist (works_with,
   * mentions). Fixed per relation by the extraction vocabulary (ADR 0008).
   */
  cardinality?: "one" | "many";
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

/**
 * Find-or-create an entity by (type, name); returns its id. Matching is
 * case- and whitespace-insensitive so extraction noise ("AI bookkeeping " vs
 * "AI Bookkeeping") cannot fabricate a second entity — and with it a false
 * "different target" that wrongly supersedes a live fact.
 */
export async function upsertEntity(sql: Sql, entity: EntityRef): Promise<string> {
  const name = entity.name.trim();
  const [existing] = await sql<{ id: string }[]>`
    select id from graph_entities
    where entity_type = ${entity.entityType} and lower(name) = lower(${name})
      and tombstoned_at is null`;
  if (existing) return existing.id;
  const [created] = await sql<{ id: string }[]>`
    insert into graph_entities (entity_type, name) values (${entity.entityType}, ${name})
    returning id`;
  return (created as { id: string }).id;
}

/**
 * Assert a fact. For a single-valued relation (cardinality 'one', the
 * default), a new target supersedes EVERY live edge on (source, relation):
 * invalidated bi-temporally and replaced. For a multi-valued relation
 * ('many'), targets coexist and only the identical fact is deduplicated.
 * Re-asserting an identical fact extends its provenance either way. The
 * one-live-edge invariant is also enforced by the database (migration 0009),
 * so a concurrent conflicting assert fails loudly instead of corrupting.
 */
export async function assertFact(
  sql: Sql,
  fact: Fact,
): Promise<{ id: string; superseded: string[] }> {
  const cardinality = fact.cardinality ?? "one";
  const sourceId = await upsertEntity(sql, fact.source);
  const targetId = await upsertEntity(sql, fact.target);
  const provenance = (fact.provenanceEpisodeIds ?? []) as string[];

  const live = await sql<{ id: string; target_entity_id: string }[]>`
    select id, target_entity_id from graph_edges
    where source_entity_id = ${sourceId} and relation = ${fact.relation}
      and invalidated_at is null`;

  const identical = live.find((edge) => edge.target_entity_id === targetId);
  if (identical) {
    await sql`update graph_edges
      set provenance_episode_ids = (
        select array(select distinct unnest(provenance_episode_ids || ${provenance})))
      where id = ${identical.id}`;
    return { id: identical.id, superseded: [] };
  }

  const superseded = cardinality === "one" ? live.map((edge) => edge.id) : [];
  if (superseded.length > 0) {
    await sql`update graph_edges set invalidated_at = now(), valid_to = now()
      where id in ${sql(superseded)}`;
  }
  const [created] = await sql<{ id: string }[]>`
    insert into graph_edges (source_entity_id, target_entity_id, relation, cardinality, attributes, valid_from, provenance_episode_ids)
    values (${sourceId}, ${targetId}, ${fact.relation}, ${cardinality}, ${sql.json(fact.attributes ?? {})}, now(), ${provenance})
    returning id`;
  return { id: (created as { id: string }).id, superseded };
}

/**
 * Bounded by default: the live-fact set only grows over a founder's tenure,
 * and this feeds every context read (§6.8 "cheap by construction").
 */
export const DEFAULT_FACT_LIMIT = 100;

/** Live (non-invalidated) facts, joined to entity names, newest first. */
export async function liveFacts(
  sql: Sql,
  filter?: { relation?: string; limit?: number },
): Promise<LiveFact[]> {
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
    order by e.valid_from desc
    limit ${filter?.limit ?? DEFAULT_FACT_LIMIT}`;
  return rows.map((row) => ({
    id: row.id,
    relation: row.relation,
    validFrom: row.valid_from,
    provenanceEpisodeIds: row.provenance_episode_ids,
    source: { entityType: row.source_type, name: row.source_name },
    target: { entityType: row.target_type, name: row.target_name },
  }));
}
