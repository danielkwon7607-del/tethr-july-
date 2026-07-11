-- 0012 — Research pipeline persistence (Build 7, Ch 11; ADR 0013).
-- Two founder-scoped stores under forced RLS (§18.5.4):
--   research_spend — the per-founder cost audit ledger. Every costed call (a
--     paid source fetch or a model completion) appends a row; back-pressure
--     reads SUM(cost_micros) against a per-founder budget cap (Handbook
--     Recommendation #5). Append-only: the ledger is the audit trail.
--   research_cache — the staleness-typed source cache (Handbook Recommendation
--     #6). Per-source TTL is applied at read time (fetched_at + ttl > now); a
--     stale row is refreshed in place. Founder-scoped rather than shared: the
--     cache key derives from the founder's idea text, so a shared table would
--     leak one founder's research query into another's cache (privacy §6.14).

create table research_spend (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  -- 'source' (paid provider fetch) or 'model' (router completion).
  kind text not null check (kind in ('source', 'model')),
  -- What was called — a source id ('xai'/'serper'/…) or a tier ('tier1'/'tier2').
  detail text not null,
  -- Micro-dollars (1e-6 USD): integer math, no float drift on a running total.
  cost_micros bigint not null check (cost_micros >= 0),
  created_at timestamptz not null default now()
);
create index research_spend_founder on research_spend (founder_id, created_at desc);

alter table research_spend enable row level security;
alter table research_spend force row level security;
create policy research_spend_founder_isolation on research_spend
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
-- No update/delete grant: a spend ledger is append-only (like action_ledger).
grant select, insert on research_spend to tethr_app;

create table research_cache (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  source text not null,
  -- Hash of the query (the idea text is founder data — the raw query is not
  -- stored here, only its hash and the public response payload).
  cache_key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  unique (founder_id, source, cache_key)
);
create index research_cache_lookup on research_cache (founder_id, source, cache_key);

alter table research_cache enable row level security;
alter table research_cache force row level security;
create policy research_cache_founder_isolation on research_cache
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on research_cache to tethr_app;
