-- 0011 — Channel-ownership verification (OTP) + system-scoped action claims.
-- Gate 0 amendments (Ch 3, Ch 10; ADR 0012), closing the two ADR 0011 gaps.
--
-- (A) OTP verification. Onboarding creates a founder's channel UNVERIFIED
-- (ADR 0011 §2a): stamping verified_at without proof is a channel-takeover
-- primitive (§18.5.2 routes inbound by (channel_type, address) + verified_at).
-- tethr sends a one-time code to the address; the founder replies with it; only
-- a matching reply stamps verified_at. Verification is PRE-IDENTIFICATION — the
-- channel isn't verified yet, so a forced-RLS scoped query cannot bootstrap the
-- stamp — so it is a security-definer function, the same enumerated §18.5.4
-- exception class as resolve_channel_identity (migration 0010), here mutating.
--
-- (B) System-scoped action claims. The unrecognized-inbound reply (Ch 10
-- amendment) is an irreversible outbound to a sender with NO founder yet, so it
-- cannot carry a founder_id — but §18.5.7 still binds it (audit-before-dispatch,
-- idempotency). A null-founder row in the one action_ledger, claimed through a
-- security-definer function, keeps the single audit substrate (Constitution VII)
-- rather than a parallel store.

-- (A) The challenge store. Founder-scoped (the founder exists at challenge time
-- — it's created inside onboarding's atomic tx), forced RLS like every
-- founder-scoped table (§18.5.4). Only the HMAC of the code is stored: the code
-- is peppered app-side with a server secret (§18.5.5) and hashed, so a store
-- leak alone cannot recover a 6-digit code. Plaintext never reaches the DB.
create table channel_verifications (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  channel_identity_id uuid not null references channel_identities(id) on delete cascade,
  -- HMAC-SHA256(secret, channel_identity_id || ':' || code) — computed app-side.
  code_hash text not null check (code_hash <> ''),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  -- Attempt cap is the real online-brute defense (short-lived + rate-limited),
  -- not the hash: a 6-digit code has a small space, so attempts are bounded.
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
-- One live (unconsumed) challenge per identity is what we look up; index it.
create index channel_verifications_live
  on channel_verifications (channel_identity_id, created_at desc)
  where consumed_at is null;

alter table channel_verifications enable row level security;
alter table channel_verifications force row level security;
create policy channel_verifications_founder_isolation on channel_verifications
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update on channel_verifications to tethr_app;

-- The verification function (enumerated §18.5.4 exception, mutating). Given a
-- (channel_type, address) and the app-computed code HMAC, it finds the
-- UNVERIFIED identity and its newest live challenge, and — only on a hash match
-- — atomically stamps channel_identities.verified_at and consumes the challenge.
-- A miss increments attempts (lockout after 5). It never returns the stored
-- hash, never lists challenges, and is a no-op for unknown/already-verified
-- addresses. The founder_id it returns scopes only the caller's post-verify
-- logging; an unverified channel still reaches no founder context (§18.5.2).
create function verify_channel_otp(p_channel_type text, p_address text, p_code_hash text)
returns table (verified boolean, founder_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_founder_id uuid;
  v_challenge_id uuid;
  v_stored_hash text;
begin
  select ci.id, ci.founder_id into v_identity_id, v_founder_id
  from channel_identities ci
  where ci.channel_type = p_channel_type
    and ci.address = p_address
    and ci.verified_at is null
  limit 1;
  if v_identity_id is null then
    return query select false, null::uuid;
    return;
  end if;

  select cv.id, cv.code_hash into v_challenge_id, v_stored_hash
  from channel_verifications cv
  where cv.channel_identity_id = v_identity_id
    and cv.consumed_at is null
    and cv.expires_at > now()
    and cv.attempts < 5
  order by cv.created_at desc
  limit 1;
  if v_challenge_id is null then
    return query select false, v_founder_id;
    return;
  end if;

  if v_stored_hash = p_code_hash then
    update channel_identities set verified_at = now() where id = v_identity_id;
    update channel_verifications set consumed_at = now() where id = v_challenge_id;
    return query select true, v_founder_id;
  else
    update channel_verifications set attempts = attempts + 1 where id = v_challenge_id;
    return query select false, v_founder_id;
  end if;
end;
$$;
revoke all on function verify_channel_otp(text, text, text) from public;
grant execute on function verify_channel_otp(text, text, text) to tethr_app;

-- (B) System-scoped claim. NULLs are distinct in a normal unique index, so the
-- existing action_ledger_claim (which includes founder_id) would NOT dedup
-- null-founder rows — a dedicated partial index over just (action_type, key)
-- for founder_id-null rows gives the "one reply per key" guarantee.
create unique index action_ledger_system_claim
  on action_ledger (action_type, idempotency_key)
  where founder_id is null and status <> 'failed';

-- claim + record for the system (founderless) action, mirroring PgActionLedger
-- against the null-founder partition. security-definer because forced RLS on
-- action_ledger denies a null current_founder_id() (Build 1 clean-deny rule),
-- so the app role cannot write these rows directly. Enumerated §18.5.4.
create function claim_system_action(p_action_type text, p_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  insert into action_ledger (founder_id, action_type, idempotency_key)
  values (null, p_action_type, p_key)
  on conflict (action_type, idempotency_key) where founder_id is null and status <> 'failed'
  do nothing;
  if found then
    return 'claimed';
  end if;
  select status into v_status
  from action_ledger
  where founder_id is null and action_type = p_action_type and idempotency_key = p_key
    and status <> 'failed';
  -- A lost race whose winner has since flipped to 'failed' leaves no live row;
  -- signal the caller to retry the claim rather than inventing a status.
  return coalesce(v_status, 'retry');
end;
$$;
revoke all on function claim_system_action(text, text) from public;
grant execute on function claim_system_action(text, text) to tethr_app;

create function record_system_action_outcome(
  p_action_type text, p_key text, p_status text, p_detail text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('executed', 'failed', 'ambiguous') then
    raise exception 'invalid outcome status %', p_status;
  end if;
  update action_ledger
  set status = p_status, detail = p_detail, resolved_at = now()
  where founder_id is null and action_type = p_action_type
    and idempotency_key = p_key and status = 'pending';
  if not found then
    raise exception 'no pending system intent row for %:%', p_action_type, p_key;
  end if;
end;
$$;
revoke all on function record_system_action_outcome(text, text, text, text) from public;
grant execute on function record_system_action_outcome(text, text, text, text) to tethr_app;
