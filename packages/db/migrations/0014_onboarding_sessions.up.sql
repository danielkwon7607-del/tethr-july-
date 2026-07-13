-- 0014 — Entry-surface onboarding sessions (Build 9a, ADR 0015).
--
-- The web conversational entry surface (§3.5 entry boundary) holds an
-- in-progress onboarding as a DRAFT keyed by an opaque server token, so a
-- founder who goes quiet mid-flow resumes without re-answering. This is
-- PRE-FOUNDER state: there is no founder_id to scope by yet, and §10.3 (which
-- governs inbound identities keyed by ADDRESS) does not apply — the token is
-- the only handle. Access is service-role only (the entry package), never
-- tethr_app, so no RLS policy is needed; RLS is enabled as defense-in-depth but
-- NOT forced, so the owning service role manages the drafts. Partial founder
-- PII lives in `state` until completion or the 14-day expiry sweep (ADR 0015).
create table onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Opaque CSPRNG token (>=128-bit), the founder's only handle to resume.
  token text not null unique check (token <> ''),
  -- Machine-owned conversation state {path, answers, ...}. Opaque to the DB;
  -- the entry state machine owns its shape (Constitution XII).
  state jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Stalled drafts expire (partial PII cleared) here; the sweep deletes rows
  -- past it. Default 14 days from creation (ADR 0015 §4); the app may set it.
  expires_at timestamptz not null default now() + interval '14 days'
);
-- The sweep targets expired, still-incomplete drafts.
create index onboarding_sessions_expiry
  on onboarding_sessions (expires_at)
  where completed_at is null;

alter table onboarding_sessions enable row level security;
-- No policy + no tethr_app grant: only the owning service role (the entry
-- package) reaches these pre-founder drafts. RLS is not FORCED, so the owner
-- manages them; tethr_app is denied by the absence of any grant.

-- Idempotent completion (ADR 0015 §7, Constitution X): the created founder
-- carries the session id, so a double-submitted completion or a retry after a
-- post-commit OTP-send failure finds the EXISTING founder (runOnboarding checks
-- this exactly like auth_user_id) instead of creating a second one. Nullable —
-- founders created by other paths (tests, future auth) have none. Unique — one
-- session yields at most one founder.
alter table founders add column onboarding_session_id uuid unique
  references onboarding_sessions(id) on delete set null;
