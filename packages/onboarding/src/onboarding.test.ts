import { randomUUID } from "node:crypto";
import { migrateUp, withFounderContext } from "@tethr/db";
import { listTraits } from "@tethr/founder-model";
import {
  createMemoryChannel,
  extractOtpCode,
  INITIATION_TRIGGER_EVENT,
  registerInitiation,
  verifyChannelOtp,
} from "@tethr/messaging";
import { InMemoryWorkflowEngine } from "@tethr/orchestration";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { founderIdForAuthUser } from "./auth";
import type { OnboardingInput } from "./entry-paths";
import { ONBOARDING_COMPLETED_EVENT } from "./events";
import { runOnboarding } from "./onboard";

// Build 6 end-to-end (§3, §6.13): onboarding seeds the cold-start model at low
// confidence, auto-triggers Research with no founder prompt, and the very
// first proactive contact reads those seeds and stays conservative under the
// low cold-start confidence — using the EXISTING §6.12 policy (no new policy
// logic). Own scratch database; serialized with the other integration suites.
const adminUrl = process.env.TETHR_DATABASE_URL;

const input = (path: OnboardingInput["path"], address: string): OnboardingInput => ({
  path,
  displayName: "Cold Start Founder",
  channel: { channelType: "imessage", address },
  ...(path === "idea" ? { ideaText: "AI for dentists" } : {}),
  ...(path === "problem" ? { problemText: "scheduling is broken" } : {}),
});

describe.skipIf(!adminUrl)("onboarding & seeding (requires TETHR_DATABASE_URL)", () => {
  let sql: Sql;
  const runScoped = <T>(founderId: string, work: (trx: Sql) => Promise<T>): Promise<T> =>
    withFounderContext(sql, founderId, work);

  beforeAll(async () => {
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_ob_test");
    await admin.unsafe("create database tethr_ob_test");
    await admin.end();
    const url = new URL(adminUrl as string);
    url.pathname = "/tethr_ob_test";
    sql = postgres(url.href, { max: 1, onnotice: () => {} });
    await migrateUp(sql);
  });

  afterAll(async () => {
    await sql?.end();
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_ob_test");
    await admin.end();
  });

  it("seeds the highest-leverage dimensions at low confidence, stated-only (§3.3, §6.13)", async () => {
    const engine = new InMemoryWorkflowEngine();
    const { founderId } = await runOnboarding({ sql, engine }, input("idea", "+1001"));

    const traits = await runScoped(founderId, (trx) => listTraits(trx));
    const byDim = new Map(traits.map((trait) => [trait.dimension, trait]));

    for (const dimension of [
      "accountability_responsiveness",
      "communication_cadence",
      "working_rhythm",
      "load_burnout",
      "available_time",
      "process_sophistication",
      "customer_contact_avoidance",
    ]) {
      const trait = byDim.get(dimension);
      expect(trait, `${dimension} should be seeded`).toBeDefined();
      // Cold start (§3.3): stated-heavy, revealed accrues only once acting.
      expect(trait?.stated.estimate).not.toBeNull();
      expect(trait?.revealed.estimate).toBeNull();
      // Low confidence by construction — a single stated observation (§6.15).
      expect(trait?.stated.confidence).toBeLessThan(0.3);
    }
  });

  it("emits onboarding.completed to auto-trigger Research, with no founder prompt (§3.4)", async () => {
    // Onboarding's job at the handoff is to EMIT the event; the Research
    // pipeline (a separate owner, @tethr/research) consumes it and advances the
    // stage. Here we assert the producer side — the founder never asked.
    const engine = new InMemoryWorkflowEngine();
    const triggered: string[] = [];
    engine.register({
      id: "test.research-listener",
      trigger: { event: ONBOARDING_COMPLETED_EVENT },
      handler: async (event) => {
        triggered.push(event.data.founderId as string);
      },
    });

    const { founderId } = await runOnboarding({ sql, engine }, input("problem", "+1002"));

    expect(triggered).toEqual([founderId]);
  });

  it("first proactive contact reflects the seeds but stays conservative under low confidence", async () => {
    const engine = new InMemoryWorkflowEngine();
    const channel = createMemoryChannel();
    registerInitiation(engine, {
      runScoped,
      port: channel.port,
      engine,
      actionThreshold: 0.15,
      compose: async ({ behavior }) => `gentle:${behavior}`,
    });

    const { founderId } = await runOnboarding({ sql, engine }, input("none", "+1003"));

    // Onboarding creates the channel UNVERIFIED (no proof of ownership). The
    // real verification step (OTP / proven inbound) is out of scope here; mark
    // it verified to represent a founder who completed it, so the send path is
    // exercisable and the conservative decision is what's under test.
    await runScoped(founderId, (trx) => trx`update channel_identities set verified_at = now()`);

    // Fire the first initiation as the loop would.
    await engine.send({
      name: INITIATION_TRIGGER_EVENT,
      id: `init/${founderId}/first`,
      data: { founderId, reason: "first-contact" },
    });

    // The decision was recorded (§6.15 instrumentation) and is conservative:
    // low cold-start confidence gates OUT the hard nudge — never intensity 3.
    const decisions = await runScoped(
      founderId,
      (trx) => trx<{ behavior: string; decision: string; confidence_gate: number }[]>`
        select behavior, decision, confidence_gate
        from policy_decisions order by created_at desc`,
    );
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.some((d) => d.behavior === "nudge.hard" && d.decision === "act")).toBe(false);

    // The seeds DID flow into the policy read (the harness link): the recorded
    // confidence gate is non-zero — the seeded reads were consumed — but low,
    // so the policy stayed conservative (§6.9, §6.13). This is the whole point:
    // personalized from message one, gentle because confidence is still low.
    for (const decision of decisions) {
      expect(decision.confidence_gate).toBeGreaterThan(0);
      expect(decision.confidence_gate).toBeLessThan(0.3);
    }

    // Whatever went out (if anything) is the gentle check-in, never a hard push.
    for (const sent of channel.sent) {
      expect(sent.text).toBe("gentle:checkin.gentle");
    }
  });

  it("wires OTP: challenge in the atomic tx, code sent to the unverified channel, verifiable (Ch 3, Gate 0)", async () => {
    const engine = new InMemoryWorkflowEngine();
    const channel = createMemoryChannel();
    const secret = "onboard-pepper";
    const OTP_ADDR = "+1005";
    const { founderId } = await runOnboarding(
      { sql, engine, otp: { secret }, port: channel.port, runScoped },
      input("idea", OTP_ADDR),
    );

    // The channel is created UNVERIFIED (onboarding proves no ownership).
    const [ch] = await runScoped(
      founderId,
      (trx) => trx<{ id: string; verified_at: Date | null }[]>`
        select id, verified_at from channel_identities where address = ${OTP_ADDR}`,
    );
    const channelIdentityId = (ch as { id: string }).id;
    expect(ch?.verified_at).toBeNull();

    // A challenge row landed inside onboarding's atomic tx (Option A) — one per
    // channel, committed with it.
    const [challengeCount] = await runScoped(
      founderId,
      (trx) => trx<{ n: number }[]>`
        select count(*)::int as n from channel_verifications
        where channel_identity_id = ${channelIdentityId}`,
    );
    expect(challengeCount?.n).toBe(1);

    // The code was sent post-commit to the still-unverified channel (the one
    // sanctioned exception to "unverified = no outbound").
    expect(channel.sent).toHaveLength(1);
    const sent = channel.sent[0];
    expect(sent?.address).toBe(OTP_ADDR);
    const code = extractOtpCode(sent?.text ?? "");
    expect(code).not.toBeNull();

    // Round-trip: a WRONG reply does not verify; the MATCHING code does — a
    // channel cannot be verified without a matching OTP reply (§18.5.2).
    const wrong = await verifyChannelOtp(
      sql,
      {
        channelType: "imessage",
        address: OTP_ADDR,
        channelIdentityId,
        code: code === "000000" ? "000001" : "000000",
      },
      { secret },
    );
    expect(wrong.verified).toBe(false);
    const ok = await verifyChannelOtp(
      sql,
      { channelType: "imessage", address: OTP_ADDR, channelIdentityId, code: code as string },
      { secret },
    );
    expect(ok.verified).toBe(true);
    const [after] = await runScoped(
      founderId,
      (trx) => trx<{ verified_at: Date | null }[]>`
        select verified_at from channel_identities where id = ${channelIdentityId}`,
    );
    expect(after?.verified_at).not.toBeNull();
  });

  it("links the founder to a Supabase Auth user and resolves back by it (shell auth, §18.5.2)", async () => {
    const engine = new InMemoryWorkflowEngine();
    const authUserId = randomUUID();
    const { founderId } = await runOnboarding(
      { sql, engine },
      { ...input("idea", "+1004"), authUserId },
    );

    // The shell resolves the founder from the session's auth user id — the
    // replacement for the TETHR_DEV_FOUNDER_ID binding.
    expect(await founderIdForAuthUser(sql, authUserId)).toBe(founderId);
    expect(await founderIdForAuthUser(sql, randomUUID())).toBeNull();

    // Idempotent resume: a retry for the same auth user returns the existing
    // founder — no unique-constraint collision, no duplicate/half-seeded row.
    const retry = await runOnboarding({ sql, engine }, { ...input("idea", "+1004"), authUserId });
    expect(retry.founderId).toBe(founderId);
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from founders where auth_user_id = ${authUserId}`;
    expect(count?.n).toBe(1);
  });
});

if (!adminUrl) {
  it("onboarding suite SKIPPED — set TETHR_DATABASE_URL to run it", () => {
    expect(adminUrl).toBeUndefined();
  });
}
