import type { Sql } from "postgres";

// §19.4/§18.5.2 inbound resolution. Pre-identification by definition: the
// founder is the OUTPUT, so a forced-RLS scoped query cannot bootstrap
// itself. resolve_channel_identity (migration 0010) is the enumerated
// §18.5.4 security-definer exception — it answers exactly one
// (channel_type, address) with (founder, identity, verified) and nothing
// else. Unverified identities never reach an existing founder's context;
// callers must branch on `kind`.

export type ChannelType = "imessage" | "whatsapp" | "sms" | "rcs";

export type InboundAddress = { channelType: ChannelType; address: string };

export type ResolvedIdentity =
  | { kind: "founder"; founderId: string; channelIdentityId: string }
  | { kind: "unverified"; founderId: string; channelIdentityId: string }
  | { kind: "unknown" };

export async function resolveInbound(sql: Sql, inbound: InboundAddress): Promise<ResolvedIdentity> {
  const [row] = await sql<
    { founder_id: string; channel_identity_id: string; verified: boolean }[]
  >`select * from resolve_channel_identity(${inbound.channelType}, ${inbound.address})`;
  if (!row) return { kind: "unknown" };
  return {
    kind: row.verified ? "founder" : "unverified",
    founderId: row.founder_id,
    channelIdentityId: row.channel_identity_id,
  };
}
