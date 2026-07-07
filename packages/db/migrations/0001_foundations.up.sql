-- Foundations: extensions, founder-context helper, app role, founders root.
-- RLS model (handbook §18.5.4): every founder-scoped table carries founder_id
-- with a FORCED policy checking current_founder_id(). Founder-facing access
-- runs as the non-superuser role tethr_app with app.founder_id set on the
-- connection (in Supabase, a JWT claim mapped to the same setting).

create extension if not exists vector;

-- The founder context of the current connection. Empty/unset — and any
-- malformed value — yields NULL, so a connection without a valid context can
-- neither read nor write founder data: fail-closed as a clean deny, not an
-- error on every query.
create function current_founder_id() returns uuid
language plpgsql stable
as $$
begin
  return nullif(current_setting('app.founder_id', true), '')::uuid;
exception when invalid_text_representation then
  return null;
end $$;

-- Non-superuser application role (NOLOGIN; assumed via SET ROLE or as the
-- connection role in managed environments). Cluster-level: created once,
-- shared across databases on the cluster.
do $$
begin
  if not exists (select from pg_roles where rolname = 'tethr_app') then
    create role tethr_app nologin;
  end if;
end $$;

grant usage on schema public to tethr_app;

create table founders (
  id uuid primary key default gen_random_uuid(),
  -- Supabase Auth linkage (§18.5.2); null until the founder authenticates to the shell.
  auth_user_id uuid unique,
  display_name text,
  created_at timestamptz not null default now(),
  -- §6.16 layer 1: tombstoned founders are excluded from all reads immediately.
  tombstoned_at timestamptz
);

alter table founders enable row level security;
alter table founders force row level security;
-- A founder sees only their own row; creation/deletion is the onboarding and
-- deletion services' job (service role), so no insert/update/delete policy.
create policy founders_self on founders
  for select using (id = current_founder_id() and tombstoned_at is null);
grant select on founders to tethr_app;
