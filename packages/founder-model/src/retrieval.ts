import type { QueryEmbedder } from "@tethr/model-router";
import type { Sql } from "postgres";
import { type LiveFact, liveFacts } from "./graph-store";
import { type InspectableTrait, listTraits } from "./trait-store";

// Hybrid retrieval (§6.8): graph traversal for relational reasoning, semantic
// recall over episodes, and the already-computed Traits — fused into one
// read. Cheap by construction: the expensive abstraction happened on the
// write path. Tombstoned episodes are excluded unconditionally (§6.16 layer 1:
// deletion changes behavior immediately).

export type EpisodeHit = {
  id: string;
  kind: string;
  content: unknown;
  occurredAt: Date;
  similarity: number;
};

export type FounderContext = {
  episodes: EpisodeHit[];
  facts: LiveFact[];
  traits: InspectableTrait[];
};

const DEFAULT_EPISODE_LIMIT = 8;

export async function retrieveFounderContext(
  sql: Sql,
  options: {
    /** Semantic recall: requires the embedder that matches episode embeddings (1536-dim). */
    query?: { text: string; embedder: QueryEmbedder };
    /** Optional relation filter for the graph read. */
    relation?: string;
    episodeLimit?: number;
  } = {},
): Promise<FounderContext> {
  const [facts, traits, episodes] = await Promise.all([
    liveFacts(sql, options.relation ? { relation: options.relation } : undefined),
    listTraits(sql),
    options.query
      ? semanticEpisodes(sql, options.query, options.episodeLimit)
      : Promise.resolve([]),
  ]);
  return { episodes, facts, traits };
}

async function semanticEpisodes(
  sql: Sql,
  query: { text: string; embedder: QueryEmbedder },
  limit = DEFAULT_EPISODE_LIMIT,
): Promise<EpisodeHit[]> {
  const embedding = JSON.stringify(await query.embedder.embedQuery(query.text));
  const rows = await sql<
    { id: string; kind: string; content: unknown; occurred_at: Date; similarity: number }[]
  >`
    select id, kind, content, occurred_at, 1 - (embedding <=> ${embedding}) as similarity
    from episodes
    where embedding is not null and tombstoned_at is null
    order by embedding <=> ${embedding}
    limit ${limit}`;
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    content: row.content,
    occurredAt: row.occurred_at,
    similarity: row.similarity,
  }));
}
