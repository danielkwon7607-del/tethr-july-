-- Channel-agnostic messaging identity (handbook §19.4, verbatim schema):
-- one founder, many channel identities, one logical thread. The same phone
-- number on iMessage and SMS is two channel_identities under one founder,
-- so cross-channel continuity is automatic (§10.3).

create table channel_identities (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  channel_type text not null check (channel_type in ('imessage', 'whatsapp', 'sms', 'rcs')),
  address text not null,
  -- §18.5.2: unverified identities never reach an existing founder's context;
  -- inbound resolution requires verified_at to be set.
  verified_at timestamptz,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  -- Inbound resolution key: one owner per (channel, address).
  unique (channel_type, address)
);
create index channel_identities_founder on channel_identities (founder_id);

alter table channel_identities enable row level security;
alter table channel_identities force row level security;
create policy channel_identities_founder_isolation on channel_identities
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on channel_identities to tethr_app;

create table messages (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null default current_founder_id() references founders(id) on delete cascade,
  channel_identity_id uuid not null references channel_identities(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  body text not null,
  channel_message_id text,
  -- Delivery tracking for reliability (§10.3).
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'delivered', 'read', 'failed', 'received')),
  created_at timestamptz not null default now()
);
-- The logical thread: messages by founder, ordered by time (§19.4).
create index messages_thread on messages (founder_id, created_at);
-- Ordering and dedup use channel_message_id + created_at (§19.4): the same
-- provider message can arrive twice (webhook retry); it lands once.
create unique index messages_channel_dedup
  on messages (channel_identity_id, channel_message_id)
  where channel_message_id is not null;

alter table messages enable row level security;
alter table messages force row level security;
create policy messages_founder_isolation on messages
  using (founder_id = current_founder_id())
  with check (founder_id = current_founder_id());
grant select, insert, update, delete on messages to tethr_app;
