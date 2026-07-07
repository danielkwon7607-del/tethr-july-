import type { QueryEmbedder } from "@tethr/model-router";
import type { Sql } from "postgres";

// Public Knowledge grounding retrieval (handbook Ch 7). Read-only, shared,
// founder-free: the corpus (rag_corpus, 21,349 chunks) is the enumerated
// opposite of every founder-scoped store — no writes, no per-founder RLS.
// Consumed ONLY by Planning (Ch 12) and Validation (Ch 13); the dependency
// boundary is enforced by access-boundary.test.ts, not by convention.

/** The model that embedded the corpus. Queries MUST use exactly this model. */
export const CORPUS_EMBEDDING_MODEL = "text-embedding-3-small";
export const CORPUS_EMBEDDING_DIMENSIONS = 1536;

const DEFAULT_LIMIT = 8;

export class WrongEmbeddingModelError extends Error {
  constructor(actual: string) {
    super(
      `Grounding requires ${CORPUS_EMBEDDING_MODEL} (the corpus embedding model); ` +
        `got an embedder pinned to "${actual}" — mixed models return well-formed nonsense (Ch 7)`,
    );
    this.name = "WrongEmbeddingModelError";
  }
}

export type GroundingChunk = {
  id: string;
  source: string;
  url: string | null;
  title: string | null;
  content: string;
  chunkIndex: number | null;
  metadata: Record<string, unknown> | null;
  /** Cosine similarity in [-1, 1]; higher is more relevant. */
  similarity: number;
};

/**
 * Retrieve the corpus chunks most relevant to a query, by cosine similarity
 * over pgvector. The embedder must be pinned to the corpus model — enforced
 * here and again dimensionally by the QueryEmbedder's own guard.
 */
export async function retrieveGrounding(
  sql: Sql,
  embedder: QueryEmbedder,
  query: string,
  options?: { limit?: number },
): Promise<GroundingChunk[]> {
  if (embedder.model !== CORPUS_EMBEDDING_MODEL) {
    throw new WrongEmbeddingModelError(embedder.model);
  }
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const embedding = JSON.stringify(await embedder.embedQuery(query));

  const rows = await sql<
    {
      id: string;
      source: string;
      url: string | null;
      title: string | null;
      content: string;
      chunk_index: number | null;
      metadata: Record<string, unknown> | null;
      similarity: number;
    }[]
  >`
    select id, source, url, title, content, chunk_index, metadata,
      1 - (embedding <=> ${embedding}) as similarity
    from rag_corpus
    where embedding is not null
    order by embedding <=> ${embedding}
    limit ${limit}`;

  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    url: row.url,
    title: row.title,
    content: row.content,
    chunkIndex: row.chunk_index,
    metadata: row.metadata,
    similarity: row.similarity,
  }));
}
