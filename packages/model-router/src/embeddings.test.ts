import { MockEmbeddingModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { aiSdkEmbeddingProvider } from "./ai-sdk-provider";
import type { EmbeddingProvider } from "./embeddings";
import { createQueryEmbedder, EmbeddingDimensionError } from "./embeddings";

const vector = (dimensions: number) => Array.from({ length: dimensions }, (_, i) => i / dimensions);

const fakeProvider = (dimensions: number): EmbeddingProvider => ({
  id: "fake",
  embed: async () => ({ embedding: vector(dimensions) }),
});

describe("createQueryEmbedder", () => {
  it("returns the provider's embedding when the dimension matches", async () => {
    const embedder = createQueryEmbedder(fakeProvider(1536), "text-embedding-3-small", 1536);
    const embedding = await embedder.embedQuery("validate demand before building");
    expect(embedding).toHaveLength(1536);
    expect(embedder.model).toBe("text-embedding-3-small");
  });

  it("fails hard on a dimension mismatch — the wrong-model guard (Ch 7)", async () => {
    // A different embedding model produces a different dimension; retrieval
    // against a 1536-dim corpus with such a vector would be silent nonsense.
    const embedder = createQueryEmbedder(fakeProvider(3072), "text-embedding-3-large", 1536);
    await expect(embedder.embedQuery("any query")).rejects.toThrow(EmbeddingDimensionError);
    await expect(embedder.embedQuery("any query")).rejects.toThrow(/1536.*3072|3072.*1536/);
  });
});

describe("aiSdkEmbeddingProvider", () => {
  it("embeds through an AI SDK embedding model and resolves the requested id", async () => {
    const requested: string[] = [];
    const provider = aiSdkEmbeddingProvider("openai", (model) => {
      requested.push(model);
      return new MockEmbeddingModelV4({
        modelId: model,
        doEmbed: async ({ values }) => ({
          embeddings: values.map(() => vector(1536)),
          warnings: [],
        }),
      });
    });

    const { embedding } = await provider.embed({
      model: "text-embedding-3-small",
      text: "how to find first customers",
    });

    expect(provider.id).toBe("openai");
    expect(embedding).toHaveLength(1536);
    expect(requested).toEqual(["text-embedding-3-small"]);
  });
});
