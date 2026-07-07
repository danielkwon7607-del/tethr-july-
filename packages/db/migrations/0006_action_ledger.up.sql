-- The action ledger (handbook §18.5.7, §5.4): the Postgres implementation of
-- @tethr/core's ActionLedger contract. The idempotency claim and the intent
-- audit row are the same atomic INSERT — there is no code path that contacts
-- the world without this row existing first.
create table action_ledger (
  id uuid primary key default gen_random_uuid(),
  -- §6.16: audit rows are retained through founder deletion with personal
  -- content redacted — hence SET NULL, not CASCADE: the record that an action
  -- occurred survives; its founder linkage is severed.
  founder_id uuid default current_founder_id() references founders(id) on delete set null,
  action_type text not null check (action_type <> ''),
  idempotency_key text not null check (idempotency_key <> ''),
  status text not null default 'pending'
    check (status in ('pending', 'executed', 'failed', 'ambiguous')),
  -- Under which grant or confirmation the action fires (§5.4, §18.5.7).
  authority text,
  -- What will be done — written at intent time, before dispatch; redactable (§6.16).
  intent jsonb not null default '{}',
  detail text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- The claim (§18.5.7): at most one non-failed row per (action_type, key).
-- A definite failure ('failed') drops out of the index, releasing the claim
-- for retry while the failed row remains as history; 'pending', 'executed',
-- and 'ambiguous' all hold the claim — ambiguous never releases (§18.5.7).
create unique index action_ledger_claim
  on action_ledger (action_type, idempotency_key)
  where status <> 'failed';
create index action_ledger_founder on action_ledger (founder_id, created_at desc);

alter table action_ledger enable row level security;
alter table action_ledger force row level security;
-- Rows with a severed founder linkage (founder deleted, §6.16) are visible
-- only to the service role, never through founder-scoped access.
create policy action_ledger_founder_isolation on action_ledger
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update on action_ledger to tethr_app;
-- No DELETE grant: the ledger is the safety trail; even founder-data
-- deletion redacts rather than removes it (§6.16, service role only).
