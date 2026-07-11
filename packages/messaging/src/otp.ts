import { createHmac, randomInt } from "node:crypto";
import { type ActionLedger, type IrreversibleResult, runIrreversible } from "@tethr/core";
import { PgActionLedger } from "@tethr/db";
import type { Sql } from "postgres";
import type { ChannelPort, SendResult } from "./channel-port";
import type { ChannelType } from "./identity";
import type { FounderScopedRunner } from "./runtime";

// Channel-ownership verification (Gate 0, Ch 3 amendment; ADR 0012). Onboarding
// creates a founder's channel UNVERIFIED (ADR 0011 §2a). tethr sends a one-time
// code to the address; the founder texts it back; only a matching reply stamps
// verified_at (the verify_channel_otp definer, migration 0011). This module owns
// the code lifecycle: generate, the peppered hash, the bootstrap send (the one
// outbound allowed to an unverified channel), and the inbound-reply check.

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
/** Mirrors the attempt cap hardcoded in verify_channel_otp (migration 0011). */
export const OTP_MAX_ATTEMPTS = 5;
/** §18.5.7 action type for the bootstrap code send (per-founder ledger). */
export const VERIFICATION_SEND_ACTION = "channel.verify-send";

export type OtpConfig = {
  /** Server-side pepper (§18.5.5, env). The DB stores only HMAC(secret, …), so
   * a store leak alone cannot brute a 6-digit code. */
  secret: string;
};

/** A fresh CSPRNG 6-digit code. Plaintext is ephemeral — only its HMAC persists. */
export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, "0");
}

/** HMAC-SHA256(secret, channelIdentityId:code) — binds the hash to one identity,
 * so a hash minted for one channel cannot be replayed against another. */
export function otpCodeHash(secret: string, channelIdentityId: string, code: string): string {
  return createHmac("sha256", secret).update(`${channelIdentityId}:${code}`).digest("hex");
}

/** The founder's reply is free text ("my code is 123456"); pull the standalone
 * run of exactly OTP_CODE_LENGTH digits. Returns null when there is none. */
export function extractOtpCode(body: string): string | null {
  const match = body.match(new RegExp(`(?<!\\d)(\\d{${OTP_CODE_LENGTH}})(?!\\d)`));
  return match?.[1] ?? null;
}

export type VerificationChallenge = {
  channelIdentityId: string;
  codeHash: string;
  expiresAt: Date;
};

/** Build the challenge row values for onboarding to INSERT inside its atomic tx.
 * The returned `code` is sent post-commit and never persisted. */
export function createVerificationChallenge(
  config: OtpConfig,
  channelIdentityId: string,
  now: Date = new Date(),
): { code: string; challenge: VerificationChallenge } {
  const code = generateOtpCode();
  return {
    code,
    challenge: {
      channelIdentityId,
      codeHash: otpCodeHash(config.secret, channelIdentityId, code),
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    },
  };
}

export type VerificationSendDeps = {
  port: ChannelPort;
  runScoped: FounderScopedRunner;
  /** Test seam; production default is the founder-scoped Postgres ledger. */
  ledger?: ActionLedger;
};

export type VerificationSendRequest = {
  founderId: string;
  channelIdentityId: string;
  channelType: ChannelType;
  address: string;
  code: string;
};

/**
 * The bootstrap send — the ONE outbound allowed to an unverified channel. It is
 * a distinct path from sendFounderMessage (which selects the verified primary),
 * targeting exactly the identity being verified, so the "unverified = no
 * outbound" guard is bypassed structurally and only for the code. §18.5.7 still
 * binds it: claim + intent audit row precede dispatch, keyed on the identity so
 * a retry cannot re-send. No workflow step here (called post-commit from
 * onboarding), so it uses core runIrreversible — the ledger claim is the guard.
 */
export function sendVerificationCode(
  deps: VerificationSendDeps,
  request: VerificationSendRequest,
): Promise<IrreversibleResult<SendResult>> {
  const { founderId, channelIdentityId, channelType, address, code } = request;
  const ledger: ActionLedger = deps.ledger ?? {
    claimIntent: (actionType, key) =>
      deps.runScoped(founderId, (trx) => new PgActionLedger(trx).claimIntent(actionType, key)),
    recordOutcome: (actionType, key, status, detail) =>
      deps.runScoped(founderId, (trx) =>
        new PgActionLedger(trx).recordOutcome(actionType, key, status, detail),
      ),
    list: () => deps.runScoped(founderId, (trx) => new PgActionLedger(trx).list()),
  };

  return runIrreversible<SendResult>({
    actionType: VERIFICATION_SEND_ACTION,
    idempotencyKey: `${VERIFICATION_SEND_ACTION}/${channelIdentityId}`,
    ledger,
    action: (key) =>
      deps.port.send({
        channelType,
        address,
        text: `Your tethr verification code is ${code}. It expires in 10 minutes.`,
        idempotencyKey: key,
      }),
  });
}

/**
 * Check an inbound OTP reply against the live challenge (the verify_channel_otp
 * definer, migration 0011). channelIdentityId comes from resolveInbound and is
 * used only to recompute the peppered hash — the definer resolves the identity
 * itself and, on a match, atomically stamps verified_at. Returns whether the
 * channel is now verified. A missing/malformed code never reaches here.
 */
export async function verifyChannelOtp(
  sql: Sql,
  params: { channelType: ChannelType; address: string; channelIdentityId: string; code: string },
  config: OtpConfig,
): Promise<{ verified: boolean; founderId: string | null }> {
  const codeHash = otpCodeHash(config.secret, params.channelIdentityId, params.code);
  const [row] = await sql<{ verified: boolean; founder_id: string | null }[]>`
    select * from verify_channel_otp(${params.channelType}, ${params.address}, ${codeHash})`;
  return { verified: row?.verified ?? false, founderId: row?.founder_id ?? null };
}
