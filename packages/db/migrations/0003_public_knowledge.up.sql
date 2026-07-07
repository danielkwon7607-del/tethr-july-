-- Public Knowledge store (handbook Ch 7, §19.2): ~19k embedded chunks of
-- canonical startup knowledge. Shared across founders and founder-free by
-- construction — the enumerated RLS exception of §18.5.4. Read-only during
-- use (ingestion runs as the service role); queried only by Planning and
-- Validation, never Research (§7.2) — that separation is enforced at the
-- access layer in Build 3, recorded here so the schema carries the intent.
create table public_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  title text,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);
create index public_knowledge_chunks_embedding
  on public_knowledge_chunks using hnsw (embedding vector_cosine_ops);

-- Read-only for the app role: no insert/update/delete, and no RLS — there is
-- no founder data here to isolate (§18.5.4 enumerated exception).
grant select on public_knowledge_chunks to tethr_app;
