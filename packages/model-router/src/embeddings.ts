// Embeddings capability (handbook Ch 20, added Build 3): like completions,
// every embedding call goes through this abstraction, never a provider SDK
// directly. Deliberately NOT routed like completions: embeddings have no
// cross-provider fallback, because a corpus is only searchable by vectors
// from the exact model that embedded it — "failing over" to another model
// would return well-formed garbage. One pinned model per corpus, and a
// dimension guard that turns a wrong-model wiring mistake into a hard error.

export type EmbeddingProvider = {
  id: string;
  embed(request: { model: string; text: string }): Promise<{ embedding: number[] }>;
};

export class EmbeddingDimensionError extends Error {
  constructor(model: string, expected: number, actual: number) {
    super(
      `Embedding model "${model}" returned ${actual} dimensions, expected ${expected} — ` +
        "query and corpus must be embedded by the same model (handbook Ch 7)",
    );
    this.name = "EmbeddingDimensionError";
  }
}

export type QueryEmbedder = {
  model: string;
  embedQuery(text: string): Promise<number[]>;
};

/** A single pinned model + dimension guard: the only way to embed a query. */
export function createQueryEmbedder(
  provider: EmbeddingProvider,
  model: string,
  dimensions: number,
): QueryEmbedder {
  return {
    model,
    async embedQuery(text: string): Promise<number[]> {
      const { embedding } = await provider.embed({ model, text });
      if (embedding.length !== dimensions) {
        throw new EmbeddingDimensionError(model, dimensions, embedding.length);
      }
      return embedding;
    },
  };
}
