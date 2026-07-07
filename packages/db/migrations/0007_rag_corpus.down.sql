-- Reverse of 0007: restore the 0003 Public Knowledge store. Note this drops
-- rag_corpus — correct for local/test databases this chain created; a live
-- environment holding the real corpus must never run this down casually.
drop table if exists rag_corpus;

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
grant select on public_knowledge_chunks to tethr_app;
