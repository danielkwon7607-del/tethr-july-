-- 0010 — Inbound channel resolver (ADR 0009, Build 5).
--
-- Inbound resolution is pre-identification by definition: a webhook/stream
-- message arrives as (channel_type, address) and the founder is the OUTPUT,
-- but channel_identities carries forced RLS keyed on the founder — a scoped
-- query cannot bootstrap itself. This narrow security-definer function is the
-- enumerated §18.5.4 exception that closes the loop: it returns only the
-- owning founder, the identity row id, and whether the identity is verified,
-- for exactly one (channel_type, address). It never returns message content,
-- never lists identities, and unverified identities still never reach an
-- existing founder's context (§18.5.2) — the caller branches on `verified`.
create function resolve_channel_identity(p_channel_type text, p_address text)
returns table (founder_id uuid, channel_identity_id uuid, verified boolean)
language sql
security definer
stable
set search_path = public
as $$
  select founder_id, id, verified_at is not null
  from channel_identities
  where channel_type = p_channel_type and address = p_address
$$;

revoke all on function resolve_channel_identity(text, text) from public;
grant execute on function resolve_channel_identity(text, text) to tethr_app;
