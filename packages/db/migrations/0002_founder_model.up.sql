-- The Founder Model's four layers (handbook Ch 6, §19.1):
-- Episodes (append-only ground truth) → Graph (bi-temporal facts) →
-- Traits (typed behavioral dimensions) → Policy (per-founder reweighting).
-- Embeddings are vector(1536) — the text-embedding-3-small class; a dimension
-- change is a migration, not config, by design (embeddings must be re-computed anyway).

-- Layer 1: Episodes — append-only; never updated in place (§19.1).
create table episodes (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  kind text not null,
  content jsonb not null,
  occurred_at timestamptz not null default now(),
  ingested_at timestamptz not null default now(),
  -- Backfilled asynchronously by the background write path (§6.5); the
  -- append-only trigger permits exactly that one write.
  embedding vector(1536),
  -- §6.16 layer 1: excluded from retrieval immediately on deletion request.
  tombstoned_at timestamptz
);
create index episodes_founder_time on episodes (founder_id, occurred_at desc);
create index episodes_embedding on episodes using hnsw (embedding vector_cosine_ops);

create function episodes_append_only() returns trigger
language plpgsql
as $$
begin
  if row(new.id, new.founder_id, new.kind, new.content, new.occurred_at, new.ingested_at)
     is distinct from row(old.id, old.founder_id, old.kind, old.content, old.occurred_at, old.ingested_at) then
    raise exception 'episodes are append-only (§19.1); only embedding backfill and tombstoning are allowed';
  end if;
  if old.embedding is not null and new.embedding::text is distinct from old.embedding::text then
    raise exception 'episode embeddings may only be backfilled from null, not rewritten';
  end if;
  return new;
end $$;

create trigger episodes_append_only before update on episodes
  for each row execute function episodes_append_only();

alter table episodes enable row level security;
alter table episodes force row level security;
create policy episodes_founder_isolation on episodes
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on episodes to tethr_app;

-- Layer 2: Graph — entities and typed, bi-temporal relationships (§6.4, §19.1).
create table graph_entities (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  entity_type text not null,
  name text not null,
  attributes jsonb not null default '{}',
  created_at timestamptz not null default now(),
  tombstoned_at timestamptz
);
create index graph_entities_founder_type on graph_entities (founder_id, entity_type);

alter table graph_entities enable row level security;
alter table graph_entities force row level security;
create policy graph_entities_founder_isolation on graph_entities
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on graph_entities to tethr_app;

create table graph_edges (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  source_entity_id uuid not null references graph_entities(id) on delete cascade,
  target_entity_id uuid not null references graph_entities(id) on delete cascade,
  relation text not null,
  attributes jsonb not null default '{}',
  -- Bi-temporal (§6.4): valid time is when the fact holds of the world;
  -- ingestion time is when tethr learned it. Superseded facts are
  -- invalidated (invalidated_at set), never deleted.
  valid_from timestamptz not null,
  valid_to timestamptz,
  ingested_at timestamptz not null default now(),
  invalidated_at timestamptz,
  -- Provenance links down to the episodes that produced the fact (§6.4).
  provenance_episode_ids uuid[] not null default '{}'
);
create index graph_edges_founder_live on graph_edges (founder_id, relation) where invalidated_at is null;
create index graph_edges_source on graph_edges (source_entity_id);
create index graph_edges_target on graph_edges (target_entity_id);

alter table graph_edges enable row level security;
alter table graph_edges force row level security;
create policy graph_edges_founder_isolation on graph_edges
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on graph_edges to tethr_app;

-- Layer 3: Traits — the typed behavioral dimensions (§6.3, §6.4).
create table traits (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  -- The seven families of §6.3.
  family text not null check (family in (
    'capacity', 'execution', 'risk_decision', 'market_customer',
    'motivation_psychology', 'communication', 'skill_sophistication'
  )),
  dimension text not null,
  -- Stated vs revealed kept separate on purpose; divergence is signal (§6.7).
  stated_estimate jsonb,
  stated_confidence real not null default 0 check (stated_confidence >= 0 and stated_confidence < 1),
  revealed_estimate jsonb,
  revealed_confidence real not null default 0 check (revealed_confidence >= 0 and revealed_confidence < 1),
  -- Dimension-specific decay (§6.6, §6.15); acts on confidence at read time.
  half_life_weeks real not null check (half_life_weeks > 0),
  last_reinforced_at timestamptz not null default now(),
  -- Bi-temporal, invalidate-don't-delete (§6.4).
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  ingested_at timestamptz not null default now(),
  invalidated_at timestamptz,
  provenance_episode_ids uuid[] not null default '{}'
);
-- One live read per dimension per founder; superseded reads stay as history.
create unique index traits_live_dimension on traits (founder_id, dimension) where invalidated_at is null;

alter table traits enable row level security;
alter table traits force row level security;
create policy traits_founder_isolation on traits
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on traits to tethr_app;

-- Layer 4: Policy — per-founder learned reweighting state (§6.9, §6.15).
create table policy_state (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  behavior text not null,
  -- Multiplicative, bounded [0.5, 2.0], decaying toward 1.0 (§6.15).
  learned_weight real not null default 1.0 check (learned_weight >= 0.5 and learned_weight <= 2.0),
  updated_at timestamptz not null default now(),
  unique (founder_id, behavior)
);

alter table policy_state enable row level security;
alter table policy_state force row level security;
create policy policy_state_founder_isolation on policy_state
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on policy_state to tethr_app;
