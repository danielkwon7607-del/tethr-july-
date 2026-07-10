import type { Sql } from "postgres";

// Ordered, deduped thread persistence over migration 0005's messages table.
// The logical thread is founder-keyed (RLS-scoped), ordered by created_at —
// channel-agnostic by construction (§19.4). Dedup rides the existing
// messages_channel_dedup partial unique index; redelivery lands once.

export type ThreadMessage = {
  id: string;
  channelIdentityId: string;
  direction: "in" | "out";
  body: string;
  status: string;
  createdAt: Date;
};

export async function recordInbound(
  sql: Sql,
  input: { channelIdentityId: string; body: string; channelMessageId: string },
): Promise<{ id: string | null; duplicate: boolean }> {
  const [row] = await sql<{ id: string }[]>`
    insert into messages (channel_identity_id, direction, body, channel_message_id, status)
    values (${input.channelIdentityId}, 'in', ${input.body}, ${input.channelMessageId}, 'received')
    on conflict (channel_identity_id, channel_message_id) where channel_message_id is not null
    do nothing
    returning id`;
  return row ? { id: row.id, duplicate: false } : { id: null, duplicate: true };
}

export async function recordOutbound(
  sql: Sql,
  input: {
    channelIdentityId: string;
    body: string;
    status: "sent" | "pending";
    channelMessageId: string | null;
  },
): Promise<{ id: string | null }> {
  const [row] = await sql<{ id: string }[]>`
    insert into messages (channel_identity_id, direction, body, channel_message_id, status)
    values (${input.channelIdentityId}, 'out', ${input.body}, ${input.channelMessageId}, ${input.status})
    on conflict (channel_identity_id, channel_message_id) where channel_message_id is not null
    do nothing
    returning id`;
  return { id: row?.id ?? null };
}

/** The one thread (§10.3): every message for the founder in scope, in order. */
export async function threadFor(
  sql: Sql,
  options: { limit?: number } = {},
): Promise<ThreadMessage[]> {
  const rows = await sql<
    {
      id: string;
      channel_identity_id: string;
      direction: "in" | "out";
      body: string;
      status: string;
      created_at: Date;
    }[]
  >`select id, channel_identity_id, direction, body, status, created_at
    from messages order by created_at asc limit ${options.limit ?? 200}`;
  return rows.map((row) => ({
    id: row.id,
    channelIdentityId: row.channel_identity_id,
    direction: row.direction,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
  }));
}
