import type { IrreversibleResult } from "@tethr/core";
import {
  type ChannelPort,
  type ChannelType,
  createVerificationChallenge,
  type FounderScopedRunner,
  type OtpConfig,
  type SendResult,
  sendVerificationCode,
} from "@tethr/messaging";

// OTP re-challenge (ADR 0012 §9, owed to the entry surface): a founder who never
// got the code, or locked out the challenge with 5 wrong replies, requests a
// fresh one. Minting a NEW challenge supersedes the old — verify_channel_otp
// takes the newest live challenge with attempts < 5 — so a resend both delivers
// a new code and clears a lockout. The send is idempotent per new challenge, so
// a genuine resend goes out while a double-tap of the same request does not.
//
// SECURITY (review /cso): the target channel is resolved from the founder's OWN
// RLS scope, never taken from the caller. channel_verifications isolates on its
// own founder_id but not on whether channel_identity_id belongs to that founder,
// and verify_channel_otp resolves by (channel_type, address) + newest live
// challenge — so trusting a caller-supplied channel id/address would let one
// founder mint a challenge (with a code they chose) against another's channel.

export type ResendDeps = {
  otp: OtpConfig;
  port: ChannelPort;
  runScoped: FounderScopedRunner;
};

export type ResendRequest = { founderId: string };

export type ResendOutcome = IrreversibleResult<SendResult> | { outcome: "no-channel" };

export async function resendVerification(
  deps: ResendDeps,
  req: ResendRequest,
): Promise<ResendOutcome> {
  // The founder's own unverified primary channel — RLS ensures they can only see
  // their own, so the caller cannot target someone else's channel.
  const [channel] = await deps.runScoped(
    req.founderId,
    (trx) => trx<{ id: string; channel_type: ChannelType; address: string }[]>`
      select id, channel_type, address from channel_identities
      where verified_at is null and is_primary = true
      order by created_at desc limit 1`,
  );
  if (!channel) return { outcome: "no-channel" };

  const { code, challenge } = createVerificationChallenge(deps.otp, channel.id);
  const [row] = await deps.runScoped(
    req.founderId,
    (trx) => trx<{ id: string }[]>`
      insert into channel_verifications (channel_identity_id, code_hash, expires_at)
      values (${challenge.channelIdentityId}, ${challenge.codeHash}, ${challenge.expiresAt})
      returning id`,
  );
  const challengeId = (row as { id: string }).id;
  return sendVerificationCode(
    { port: deps.port, runScoped: deps.runScoped },
    {
      founderId: req.founderId,
      channelIdentityId: channel.id,
      channelType: channel.channel_type,
      address: channel.address,
      code,
      // Each re-challenge is its own irreversible send (a new code must go out);
      // the challenge id keeps a double-tap of the same resend deduped.
      idempotencySuffix: challengeId,
    },
  );
}
