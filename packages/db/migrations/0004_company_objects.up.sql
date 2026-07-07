-- Canonical company and workflow objects (handbook §1.9, §19.3):
-- Company State, Verdicts, Plans/Actions, Experiments, outreach threads.
-- All founder-scoped; all under forced RLS (§18.5.4).

create table company_state (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  company_name text,
  stage text not null default 'onboarding',
  -- The living through-line (§17.2): idea, verdict summary, plan position,
  -- open questions — shaped by use, so jsonb rather than prematurely columned.
  state jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  -- One Company State per founder (the through-line, not a history table).
  unique (founder_id)
);

alter table company_state enable row level security;
alter table company_state force row level security;
create policy company_state_founder_isolation on company_state
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on company_state to tethr_app;

create table verdicts (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  verdict text not null check (verdict in ('strong_signal', 'weak_signal', 'pivot')),
  summary text not null,
  -- Evidence-linked by requirement (§11.4): the founder can always see why.
  evidence jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index verdicts_founder on verdicts (founder_id, created_at desc);

alter table verdicts enable row level security;
alter table verdicts force row level security;
create policy verdicts_founder_isolation on verdicts
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on verdicts to tethr_app;

create table plans (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  verdict_id uuid references verdicts(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'superseded', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plans_founder on plans (founder_id, status);

alter table plans enable row level security;
alter table plans force row level security;
create policy plans_founder_isolation on plans
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on plans to tethr_app;

-- The Action: all five §12.2 fields are mandatory — an Action missing any
-- field is malformed, so the columns are NOT NULL rather than app-validated.
create table actions (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete cascade,
  -- Ordered, dependency-aware sequencing (§12.1); re-sequencing rewrites
  -- sequence_index, so it is deliberately not unique.
  sequence_index integer not null,
  depends_on_action_ids uuid[] not null default '{}',
  action text not null,
  founder_requirement text not null,
  definition_of_done text not null,
  estimated_time interval not null,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'blocked', 'done', 'dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index actions_plan_sequence on actions (plan_id, sequence_index);

alter table actions enable row level security;
alter table actions force row level security;
create policy actions_founder_isolation on actions
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on actions to tethr_app;

-- The Experiment: hypothesis, success criteria, failure criteria, duration,
-- sample size — explicit and set in advance (§13.2), so all NOT NULL.
create table experiments (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  plan_id uuid references plans(id) on delete set null,
  hypothesis text not null,
  success_criteria text not null,
  failure_criteria text not null,
  duration interval not null,
  sample_size integer not null check (sample_size > 0),
  status text not null default 'designed'
    check (status in ('designed', 'running', 'passed', 'failed', 'aborted')),
  result jsonb,
  created_at timestamptz not null default now()
);
create index experiments_founder on experiments (founder_id, status);

alter table experiments enable row level security;
alter table experiments force row level security;
create policy experiments_founder_isolation on experiments
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on experiments to tethr_app;

create table outreach_threads (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  prospect_name text not null,
  prospect_contact jsonb not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_approval', 'sent', 'replied', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outreach_threads_founder on outreach_threads (founder_id, status);

alter table outreach_threads enable row level security;
alter table outreach_threads force row level security;
create policy outreach_threads_founder_isolation on outreach_threads
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on outreach_threads to tethr_app;
