-- Build 4 (handbook §6.15): the Founder Model's evidence ledger and policy
-- instrumentation. trait_observations is both the provenance chain for every
-- Trait read (confidence is recomputable from it) and the instrumentation
-- that will tune the v0 calibration constants. policy_decisions records each
-- §6.15 policy scoring outcome — including burnout-veto applications — so the
-- constants (action threshold, veto bands, learning factors) can be measured
-- against real founder outcomes rather than guessed.

create table trait_observations (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  family text not null check (family in (
    'capacity', 'execution', 'risk_decision', 'market_customer',
    'motivation_psychology', 'communication', 'skill_sophistication'
  )),
  dimension text not null,
  -- §6.15 source weights: correction 1.0 / revealed 0.7 / proxy 0.5 / stated 0.4.
  source text not null check (source in ('correction', 'revealed', 'proxy', 'stated')),
  -- Estimates are normalized to [0,1] (§6.15, reconciliation divergence).
  observed_estimate real not null check (observed_estimate >= 0 and observed_estimate <= 1),
  corroborating boolean not null,
  observed_at timestamptz not null default now(),
  provenance_episode_ids uuid[] not null default '{}'
);
create index trait_observations_founder_dimension
  on trait_observations (founder_id, dimension, observed_at desc);

alter table trait_observations enable row level security;
alter table trait_observations force row level security;
create policy trait_observations_founder_isolation on trait_observations
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
-- Evidence is append-only for the app role: no update/delete grants. Hard
-- deletion (§6.16) runs as the service role, following provenance.
grant select, insert on trait_observations to tethr_app;

create table policy_decisions (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  behavior text not null,
  base_fit real not null,
  confidence_gate real not null,
  learned_weight real not null,
  score real not null,
  decision text not null check (decision in ('act', 'ask')),
  veto_applied boolean not null default false,
  created_at timestamptz not null default now()
);
create index policy_decisions_founder_time on policy_decisions (founder_id, created_at desc);

alter table policy_decisions enable row level security;
alter table policy_decisions force row level security;
create policy policy_decisions_founder_isolation on policy_decisions
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert on policy_decisions to tethr_app;
