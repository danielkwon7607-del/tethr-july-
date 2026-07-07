// Build 3 live acceptance (handbook Ch 7, ENGINEERING_OS §7): verifies the
// REAL rag_corpus in Supabase — shape, count, embedding dimension, index, and
// relevance on real queries — through the production seams (QueryEmbedder +
// retrieveGrounding) wherever access allows.
//
//   node scripts/verify-build-3.ts
//
// Credentials: reads apps/web/.env (NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY). With only those, index checks
// are skipped (they need SQL) and retrieval goes through the pre-existing
// match_rag_corpus RPC. Set TETHR_LIVE_DATABASE_URL to the Supabase Postgres
// DSN to run the full SQL path: pg_indexes check, EXPLAIN index-usage proof,
// and retrieveGrounding() itself against the live table.
//
// Deliberately NOT TETHR_DATABASE_URL: the test suite drops the public schema
// of whatever database that variable names. A live DSN must never be exported
// under a name the test runner treats as disposable.
import { readFileSync } from "node:fs";
import type { EmbeddingProvider } from "@tethr/model-router";
import { createQueryEmbedder } from "@tethr/model-router";
import {
  CORPUS_EMBEDDING_DIMENSIONS,
  CORPUS_EMBEDDING_MODEL,
  retrieveGrounding,
} from "@tethr/public-knowledge";

const EXPECTED_ROWS = 21_349;
const PROBES = [
  { query: "How should a founder validate demand before building?", expect: /valid/i },
  { query: "How do I find my first customers?", expect: /customer|user|sales/i },
];

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  try {
    for (const line of readFileSync("apps/web/.env", "utf8").split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match?.[1] && match[2] !== undefined && !env[match[1]]) env[match[1]] = match[2];
    }
  } catch {
    /* .env optional; process env may carry everything */
  }
  return env;
}

const results: { name: string; ok: boolean | "skipped"; detail: string }[] = [];
const report = (name: string, ok: boolean | "skipped", detail: string) => {
  results.push({ name, ok, detail });
  const mark = ok === "skipped" ? "○" : ok ? "✓" : "✗";
  console.log(`${mark} ${name}: ${detail}`);
};

/** The production embedding seam, backed by the real OpenAI API. */
function openAiEmbedder(apiKey: string) {
  const provider: EmbeddingProvider = {
    id: "openai",
    async embed({ model, text }) {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: text }),
      });
      if (!response.ok) throw new Error(`OpenAI embeddings ${response.status}`);
      const json = (await response.json()) as { data: { embedding: number[] }[] };
      const embedding = json.data[0]?.embedding;
      if (!embedding) throw new Error("OpenAI returned no embedding");
      return { embedding };
    },
  };
  return createQueryEmbedder(provider, CORPUS_EMBEDDING_MODEL, CORPUS_EMBEDDING_DIMENSIONS);
}

async function restChecks(env: Record<string, string>) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    report("live corpus reachable", false, "no Supabase URL/service key found");
    return;
  }
  const headers = { apikey: key, authorization: `Bearer ${key}` };

  const count = await fetch(`${base}/rest/v1/rag_corpus?select=id`, {
    headers: { ...headers, prefer: "count=exact", range: "0-0" },
  });
  const range = count.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  report("row count", total === EXPECTED_ROWS, `${total} rows (expected ${EXPECTED_ROWS})`);

  const sample = await fetch(`${base}/rest/v1/rag_corpus?select=*&limit=1`, { headers });
  const [row] = (await sample.json()) as Record<string, unknown>[];
  const columns = Object.keys(row ?? {})
    .sort()
    .join(",");
  const expected = "chunk_index,content,created_at,embedding,id,metadata,source,title,url";
  report("table shape", columns === expected, columns);
  const embedding =
    typeof row?.embedding === "string"
      ? (JSON.parse(row.embedding as string) as number[])
      : (row?.embedding as number[]);
  report(
    "stored embedding dimension",
    embedding?.length === CORPUS_EMBEDDING_DIMENSIONS,
    `${embedding?.length}`,
  );

  if (!env.OPENAI_API_KEY) {
    report("query-path relevance (RPC)", "skipped", "no OPENAI_API_KEY");
    return;
  }
  const embedder = openAiEmbedder(env.OPENAI_API_KEY);
  for (const probe of PROBES) {
    const vector = await embedder.embedQuery(probe.query);
    report("query embedding dimension", vector.length === 1536, `${vector.length}`);
    const rpc = await fetch(`${base}/rest/v1/rpc/match_rag_corpus`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ query_embedding: JSON.stringify(vector), match_count: 5 }),
    });
    const chunks = (await rpc.json()) as { title?: string; content?: string }[];
    const relevant = chunks.some((chunk) =>
      probe.expect.test(`${chunk.title ?? ""} ${chunk.content ?? ""}`),
    );
    report(
      `relevance: "${probe.query.slice(0, 40)}…"`,
      relevant && chunks.length === 5,
      chunks.map((chunk) => (chunk.title ?? "").slice(0, 40)).join(" | "),
    );
  }
}

async function sqlChecks(env: Record<string, string>) {
  if (!env.TETHR_LIVE_DATABASE_URL) {
    report("index exists (hnsw/ivfflat)", "skipped", "set TETHR_LIVE_DATABASE_URL for SQL checks");
    report("index used (EXPLAIN)", "skipped", "set TETHR_LIVE_DATABASE_URL for SQL checks");
    report("retrieveGrounding() live", "skipped", "set TETHR_LIVE_DATABASE_URL for SQL checks");
    return;
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(env.TETHR_LIVE_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const indexes = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes where tablename = 'rag_corpus'`;
    const vectorIndex = indexes.find((row) => /hnsw|ivfflat/.test(row.indexdef));
    report(
      "index exists (hnsw/ivfflat)",
      Boolean(vectorIndex),
      vectorIndex?.indexdef.slice(0, 90) ??
        "ABSENT — run: create index rag_corpus_embedding on rag_corpus using hnsw (embedding vector_cosine_ops)",
    );

    if (env.OPENAI_API_KEY) {
      const embedder = openAiEmbedder(env.OPENAI_API_KEY);
      const vector = JSON.stringify(await embedder.embedQuery(PROBES[0]?.query ?? ""));
      const plan = await sql<{ "QUERY PLAN": string }[]>`
        explain select id from rag_corpus order by embedding <=> ${vector} limit 5`;
      const planText = plan.map((row) => row["QUERY PLAN"]).join("\n");
      report("index used (EXPLAIN)", /Index Scan/i.test(planText), planText.split("\n")[0] ?? "");

      const chunks = await retrieveGrounding(sql, embedder, PROBES[0]?.query ?? "", { limit: 5 });
      const relevant = chunks.some((chunk) =>
        (PROBES[0]?.expect as RegExp).test(`${chunk.title ?? ""} ${chunk.content}`),
      );
      report(
        "retrieveGrounding() live",
        relevant && chunks.length === 5,
        chunks.map((chunk) => (chunk.title ?? "").slice(0, 40)).join(" | "),
      );
    }
  } finally {
    await sql.end();
  }
}

const env = loadEnv();
await restChecks(env);
await sqlChecks(env);

const failed = results.filter((result) => result.ok === false);
const skipped = results.filter((result) => result.ok === "skipped");
console.log(
  `\n${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length - skipped.length} ok, ${failed.length} failed, ${skipped.length} skipped`,
);
process.exit(failed.length === 0 ? 0 : 1);
