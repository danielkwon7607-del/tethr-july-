import { recordObservation } from "@tethr/founder-model";
import {
  type ChannelPort,
  createVerificationChallenge,
  type FounderScopedRunner,
  type OtpConfig,
  sendVerificationCode,
} from "@tethr/messaging";
import { sendInternal, type WorkflowEngine } from "@tethr/orchestration";
import type { Sql } from "postgres";
import { founderIdForAuthUser } from "./auth";
import { companyStateSeed, type OnboardingInput, seedProfile } from "./entry-paths";
import { ONBOARDING_COMPLETED_EVENT } from "./events";

// The onboarding orchestrator (§3): create the founder, seed Company State and
// the cold-start Founder Model, then auto-trigger Research (§3.4). It is the
// first writer of real episodes, which is why the write-path extractors
// (Build 4, deferred) arrive alongside it. Two privilege scopes are in play in
// ONE transaction: creating the founder precedes any founder scope (the
// `founders` table has no insert policy — §18.5.4), so the tx inserts it as
// owner, then drops to tethr_app and scopes to the new founder for every seed.

export type OnboardingDeps = {
  /** Service-role client (owner): creates the founder, then self-drops to
   * tethr_app inside one transaction so creation + seeding are atomic. */
  sql: Sql;
  engine: WorkflowEngine;
  // Channel verification (Gate 0, Ch 3 amendment). Supplied together in
  // production: the OTP challenge row is INSERTed inside the atomic tx (so
  // channel + challenge commit as one unit), and the code is sent post-commit.
  // Absent in unit contexts — onboarding creates the unverified channel as
  // before and skips the challenge/send.
  otp?: OtpConfig;
  port?: ChannelPort;
  runScoped?: FounderScopedRunner;
};

export type OnboardingResult = { founderId: string };

export async function runOnboarding(
  deps: OnboardingDeps,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  // Idempotent resume: an auth-linked retry (the natural response to a thrown
  // error, or a redelivered request) returns the existing founder instead of
  // colliding on the unique auth_user_id. Onboarding for a given identity runs
  // once; a second call is a no-op that re-emits nothing.
  if (input.authUserId) {
    const existing = await founderIdForAuthUser(deps.sql, input.authUserId);
    if (existing) return { founderId: existing };
  }

  const seeds = seedProfile(input);
  const company = companyStateSeed(input);

  // Verification is on only when the OTP secret, a channel port, and a scoped
  // runner are all wired (production). The challenge row lands inside the tx
  // below; the code send happens after commit. Plaintext is captured here.
  const otpEnabled = Boolean(deps.otp && deps.port && deps.runScoped);
  let pendingVerification: { channelIdentityId: string; code: string } | undefined;

  // Founder creation and seeding are ONE transaction: creation is a service-
  // role write (the `founders` table has no insert policy — §18.5.4), so the
  // tx inserts the founder as owner, THEN drops to tethr_app and scopes to the
  // new founder for every seeded write. Either the whole model lands or none of
  // it does — no orphaned, half-seeded founder survives a mid-onboarding
  // failure. (This is why we don't reuse runScoped, which switches role first.)
  const founderId = await deps.sql.begin(async (tx) => {
    const [created] = await tx<{ id: string }[]>`
      insert into founders (display_name, auth_user_id)
      values (${input.displayName ?? null}, ${input.authUserId ?? null})
      returning id`;
    const id = (created as { id: string }).id;

    await tx`set local role tethr_app`;
    await tx`select set_config('app.founder_id', ${id}, true)`;
    const trx = tx as unknown as Sql;

    // The founder's own channel is created UNVERIFIED. Onboarding proves no
    // ownership of the address — stamping verified_at here would let a caller
    // claim someone else's number (§18.5.2: unverified identities never reach a
    // founder's context, and the first outbound refuses an unverified channel).
    // The verification mechanism (OTP / proven inbound) is a handbook gap owed
    // by the entry boundary; onboarding sets verified_at once handed proof.
    const [channel] = await trx<{ id: string }[]>`
      insert into channel_identities (channel_type, address, is_primary)
      values (${input.channel.channelType}, ${input.channel.address}, true)
      returning id`;
    const channelIdentityId = (channel as { id: string }).id;

    // OTP challenge in the SAME atomic tx as the channel (Gate 0, Option A): a
    // committed unverified channel always carries its challenge. Only the HMAC
    // persists (§18.5.5 peppered); the plaintext code is captured for the
    // post-commit send and never stored.
    if (deps.otp && otpEnabled) {
      const { code, challenge } = createVerificationChallenge(deps.otp, channelIdentityId);
      await trx`
        insert into channel_verifications (channel_identity_id, code_hash, expires_at)
        values (${challenge.channelIdentityId}, ${challenge.codeHash}, ${challenge.expiresAt})`;
      pendingVerification = { channelIdentityId, code };
    }

    await trx`
      insert into company_state (company_name, stage, state)
      values (${company.companyName ?? null}, ${company.stage}, ${trx.json(company.state)})`;

    // The onboarding episode is the first ground-truth (§6.2); every seed
    // traces to it (provenance, §6.4), so the reads are auditable from day one.
    const [row] = await trx<{ id: string }[]>`
      insert into episodes (kind, content, occurred_at)
      values ('onboarding', ${trx.json({ entryPath: input.path })}, now())
      returning id`;
    const episodeId = (row as { id: string }).id;

    // §6.13 cold start: stated, low-confidence reads on the highest-leverage
    // dimensions. A single stated observation is low-confidence by the §6.15
    // math, which is exactly why early policy is conservative (§6.9).
    for (const seed of seeds) {
      await recordObservation(trx, {
        family: seed.family,
        dimension: seed.dimension,
        source: "stated",
        estimate: seed.estimate,
        provenanceEpisodeIds: [episodeId],
      });
    }
    return id;
  });

  // §3.4: the instant onboarding establishes enough, tethr triggers Research on
  // its own — no founder prompt. Emitted AFTER the write phase commits, so a
  // downstream handler failure can never roll back (or masquerade as) a
  // successful onboarding; an auth-linked retry resumes idempotently above.
  // Emitted BEFORE the code send so a code-delivery failure can never swallow
  // the Research trigger — Research is background work (it needs no verified
  // channel), and the proactive-loop proof must not be hostage to code delivery.
  await sendInternal(deps.engine, {
    name: ONBOARDING_COMPLETED_EVENT,
    id: `onboarding/${founderId}`,
    data: { founderId, entryPath: input.path },
  });

  // Post-commit: send the code to the (still unverified) channel — the one
  // outbound sanctioned to an unverified channel, keyed on the identity so a
  // retry cannot re-send (§18.5.7 audit-before-dispatch). Never inside the tx
  // (no external dispatch under an open transaction); the plaintext lived only
  // in memory and is never persisted. A send failure surfaces to the caller;
  // the resend path is the entry-surface's job (Build 9, §3.5).
  if (deps.otp && deps.port && deps.runScoped && pendingVerification) {
    await sendVerificationCode(
      { port: deps.port, runScoped: deps.runScoped },
      {
        founderId,
        channelIdentityId: pendingVerification.channelIdentityId,
        channelType: input.channel.channelType,
        address: input.channel.address,
        code: pendingVerification.code,
      },
    );
  }

  return { founderId };
}
