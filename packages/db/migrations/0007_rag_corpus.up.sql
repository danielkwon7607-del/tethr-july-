-- Build 3 (handbook Ch 7, §19.2): the Public Knowledge corpus lives in the
-- pre-existing Supabase table rag_corpus (21,349 embedded chunks, confirmed
-- 2026-07-07) — this migration aligns the canonical repo schema to that live
-- shape and supersedes 0003's never-populated public_knowledge_chunks.
--
-- rag_corpus is deliberately the opposite of every founder-scoped table:
-- shared across founders, founder-free by construction, and read-only during
-- use — so NO founder_id, NO RLS (the enumerated §18.5.4 exception), and no
-- write grants. Queried only by Planning and Validation, never Research
-- (§7.2); that boundary is enforced structurally in packages/public-knowledge.
drop table if exists public_knowledge_chunks;

-- "if not exists" throughout: against the live database the table (and its
-- data) pre-date this migration chain, so the create must adopt, not clobber.
create table if not exists rag_corpus (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  url text,
  title text,
  content text not null,
  chunk_index integer,
  -- vector(1536): OpenAI text-embedding-3-small. The query path must embed
  -- with the same model; the dimension is the structural guard (Ch 7).
  embedding vector(1536),
  -- date / stage / topic / content_hash (shape owned by the ingestion side).
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- The similarity index for grounding retrieval; created here if absent.
create index if not exists rag_corpus_embedding
  on rag_corpus using hnsw (embedding vector_cosine_ops);

-- Read-only for the app role: SELECT only, no RLS — no founder data to isolate.
grant select on rag_corpus to tethr_app;
