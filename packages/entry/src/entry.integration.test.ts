import { migrateUp, withFounderContext } from "@tethr/db";
import { listTraits } from "@tethr/founder-model";
import { createMemoryChannel, extractOtpCode, verifyChannelOtp } from "@tethr/messaging";
import { InMemoryWorkflowEngine } from "@tethr/orchestration";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Candidate, type CandidateModel, synthesizeCandidates } from "./candidates";
import { type AnswerInput, nextStep } from "./machine";
import { resendVerification } from "./resend";
import { completeOnboarding } from "./run";
import { createSession, loadSession, recordAnswer, recordCandidatePick } from "./session";

// Build 9a end-to-end (§3, ADR 0015): a founder completes a path through the
// entry surface's state machine + session persistence and lands in a fully
// seeded Founder Model (incl. narrativeSeeds provenance) with the OTP challenge
// fired. Own drop-schema slate (pooler-compatible, unlike create-database);
// serialized with the other integration suites.
const adminUrl = process.env.TETHR_DATABASE_URL;

const freeText = (text: string): AnswerInput => ({ kind: "free_text", text });
const tap = (value: string, phone?: string): AnswerInput => ({
  kind: "tap",
  value,
  ...(phone ? { phone } : {}),
});

/** A full Path A answer set, parameterized by the channel choice + phone. */
const pathAAnswers = (channel: AnswerInput): Record<string, AnswerInput> => ({
  "A.Q1": freeText("AI for dentists"),
  "A.Q2": freeText("it got under my skin in 2024 at the clinic"),
  "A.Q3": tap("no_demand"),
  "A.Q4": tap("sitting"),
  "A.Q5": tap("40"),
  "A.Q6": freeText("I would not be able to stop thinking about not trying"),
  "A.Q7": freeText("the version of me that ships anyway"),
  "A.Q8": channel,
});

describe.skipIf(!adminUrl)("entry surface end-to-end (requires TETHR_DATABASE_URL)", () => {
  let sql: Sql;
  const runScoped = <T>(founderId: string, work: (trx: Sql) => Promise<T>): Promise<T> =>
    withFounderContext(sql, founderId, work);

  /** Drive the conversation to its terminal step, answering by question id. */
  const drive = async (token: string, answers: Record<string, AnswerInput>) => {
    for (;;) {
      const session = await loadSession(sql, token);
      if (!session) throw new Error("session vanished mid-drive");
      const step = nextStep(session.state);
      if (step.type !== "question") return step;
      const input = answers[step.question.id];
      if (!input) throw new Error(`no prepared answer for ${step.question.id}`);
      await recordAnswer(sql, token, step.question.id, input);
    }
  };

  beforeAll(async () => {
    sql = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await sql.unsafe("drop schema public cascade; create schema public;");
    await migrateUp(sql);
    // runOnboarding does `set local role tethr_app` (§18.5.4). CI runs as a
    // superuser cluster where that is always allowed; a managed Postgres (the
    // scratch project here) connects as a non-superuser, so the connection role
    // must be a MEMBER of tethr_app. Granting it makes the test environment
    // match production's requirement — a real deploy note: the app's DB role
    // needs tethr_app membership. Best-effort: already-a-member is harmless.
    await sql.unsafe("grant tethr_app to current_user").catch(() => {});
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("Path A: conversation → seeded Founder Model + narrativeSeeds + OTP challenge", async () => {
    const engine = new InMemoryWorkflowEngine();
    const channel = createMemoryChannel();
    const secret = "entry-pepper";
    const ADDR = "+1201";

    const created = await createSession(sql, "A");
    const terminal = await drive(created.token, pathAAnswers(tap("imessage", ADDR)));
    expect(terminal.type).toBe("complete");

    const result = await completeOnboarding(
      { sql, engine, otp: { secret }, port: channel.port, runScoped },
      created.token,
    );
    expect(result.founderId).toBeTruthy();
    expect(result.verificationSent).toBe(true);
    const founderId = result.founderId;

    // The cold-start model is seeded (§3.3): available_time from the 40h band,
    // and customer_contact_avoidance sits at the NEUTRAL default (Gap A: deferred
    // to behavioral learning — no onboarding question feeds it).
    const traits = await runScoped(founderId, (trx) => listTraits(trx));
    const byDim = new Map(traits.map((t) => [t.dimension, t]));
    expect(byDim.get("available_time")?.stated.estimate).toBeGreaterThan(0.9);
    expect(byDim.get("customer_contact_avoidance")?.stated.estimate).toBeCloseTo(0.5, 5);

    // narrativeSeeds persisted with provenance: they live in the onboarding
    // episode (which carries the id every seed traces to), NOT discarded.
    const [episode] = await runScoped(
      founderId,
      (trx) => trx<{ content: Record<string, unknown> }[]>`
        select content from episodes where kind = 'onboarding'`,
    );
    const seeds = episode?.content.narrativeSeeds as Record<string, string> | undefined;
    expect(seeds).toMatchObject({
      originStory: "it got under my skin in 2024 at the clinic",
      fearedOutcome:
        "That people don't actually have this problem badly enough to pay for a solution",
      oneYearRegret: "I would not be able to stop thinking about not trying",
      statedBuilderSelf: "the version of me that ships anyway",
    });

    // The channel is created UNVERIFIED with a challenge, and the code went out
    // (OTP gate fired). Verification blocks until the founder replies (§3.5).
    const [ch] = await runScoped(
      founderId,
      (trx) => trx<{ verified_at: Date | null }[]>`
        select verified_at from channel_identities where address = ${ADDR}`,
    );
    expect(ch?.verified_at).toBeNull();
    expect(channel.sent).toHaveLength(1);
    expect(extractOtpCode(channel.sent[0]?.text ?? "")).not.toBeNull();
  });

  it("resumes a stalled onboarding at the next unanswered question, no re-ask", async () => {
    const engine = new InMemoryWorkflowEngine();
    const created = await createSession(sql, "A");
    await recordAnswer(sql, created.token, "A.Q1", freeText("a specific idea"));
    await recordAnswer(sql, created.token, "A.Q2", freeText("origin story"));
    await recordAnswer(sql, created.token, "A.Q3", tap("outcompeted"));

    // The founder goes quiet, then returns (a fresh load by token).
    const resumed = await loadSession(sql, created.token);
    expect(resumed).not.toBeNull();
    const step = nextStep((resumed as NonNullable<typeof resumed>).state);
    expect(step.type === "question" && step.question.id).toBe("A.Q4");
    // Earlier answers are intact — not re-asked.
    expect(resumed?.state.answers["A.Q1"]).toBeDefined();
    expect(resumed?.state.answers["A.Q3"]).toMatchObject({ value: "outcompeted" });

    // Finish from where they left off and complete.
    await drive(created.token, {
      "A.Q4": tap("sitting"),
      "A.Q5": tap("20"),
      "A.Q6": freeText("regret"),
      "A.Q7": freeText("builder"),
      "A.Q8": tap("sms", "+1202"),
    });
    const result = await completeOnboarding({ sql, engine }, created.token);
    expect(result.founderId).toBeTruthy();
  });

  it("completion is idempotent: a re-submit returns the same founder, not a second", async () => {
    const engine = new InMemoryWorkflowEngine();
    const created = await createSession(sql, "A");
    await drive(created.token, pathAAnswers(tap("none")));

    const first = await completeOnboarding({ sql, engine }, created.token);
    const second = await completeOnboarding({ sql, engine }, created.token);
    expect(second.founderId).toBe(first.founderId);

    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from founders where onboarding_session_id = ${created.id}`;
    expect(count?.n).toBe(1);
  });

  it("Path B: problem-space conversation with the personal-moment origin story", async () => {
    const engine = new InMemoryWorkflowEngine();
    const created = await createSession(sql, "B");
    const terminal = await drive(created.token, {
      "B.Q1": freeText("scheduling for hourly workers is broken"),
      "B.Q2": tap("personally"),
      "B.Q2b": freeText("the day I missed a shift because the app failed"),
      "B.Q3": freeText("hourly workers at small businesses"),
      "B.Q4": freeText("existing tools ignore them"),
      "B.Q5": tap("20"),
      "B.Q6": freeText("I would still be stuck on it"),
      "B.Q7": tap("whatsapp", "+1301"),
    });
    expect(terminal.type).toBe("complete");
    const { founderId } = await completeOnboarding({ sql, engine }, created.token);

    const [company] = await runScoped(
      founderId,
      (trx) => trx<{ stage: string; state: Record<string, unknown> }[]>`
        select stage, state from company_state`,
    );
    expect((company?.state as { entryPath?: string }).entryPath).toBe("problem");
    expect((company?.state as { problem?: string }).problem).toBe(
      "scheduling for hourly workers is broken",
    );
    const [episode] = await runScoped(
      founderId,
      (trx) => trx<{ content: { narrativeSeeds?: Record<string, string> } }[]>`
        select content from episodes where kind = 'onboarding'`,
    );
    expect(episode?.content.narrativeSeeds?.originStory).toBe(
      "the day I missed a shift because the app failed",
    );
  });

  it("Path A2: the A→A2 branch collects buildingContext and completes", async () => {
    const engine = new InMemoryWorkflowEngine();
    const created = await createSession(sql, "A");
    const terminal = await drive(created.token, {
      "A.Q1": freeText("a dev tool"),
      "A.Q2": freeText("origin"),
      "A.Q3": tap("outcompeted"),
      "A.Q4": tap("building"),
      "A2.Q1": freeText("a working CLI prototype"),
      "A2.Q2": freeText("about ten developers on my team"),
      "A2.Q3": freeText("they like it but want plugins"),
      "A2.Q4": freeText("stuck on the plugin API"),
      "A2.Q5": tap("15"),
      "A2.Q6": tap("not_the_one"),
      "A2.Q7": tap("imessage", "+1302"),
    });
    expect(terminal.type).toBe("complete");
    const { founderId } = await completeOnboarding({ sql, engine }, created.token);

    const [episode] = await runScoped(
      founderId,
      (trx) => trx<
        { content: { buildingContext?: string; narrativeSeeds?: Record<string, string> } }[]
      >`
        select content from episodes where kind = 'onboarding'`,
    );
    expect(episode?.content.buildingContext).toContain("a working CLI prototype");
    expect(episode?.content.buildingContext).toContain("stuck on the plugin API");
    // A2 re-asks the feared-outcome tap (A2.Q6); it is the one that lands.
    expect(episode?.content.narrativeSeeds?.fearedOutcome).toBe(
      "That I am not actually the right person to pull this off",
    );
  });

  it("OTP re-challenge (ADR 0012 §9): a resend delivers a fresh, verifiable code", async () => {
    const engine = new InMemoryWorkflowEngine();
    const channel = createMemoryChannel();
    const secret = "resend-pepper";
    const ADDR = "+1401";
    const created = await createSession(sql, "A");
    await drive(created.token, pathAAnswers(tap("imessage", ADDR)));
    const { founderId } = await completeOnboarding(
      { sql, engine, otp: { secret }, port: channel.port, runScoped },
      created.token,
    );
    expect(channel.sent).toHaveLength(1); // the initial code

    const [ch] = await runScoped(
      founderId,
      (trx) => trx<{ id: string }[]>`select id from channel_identities where address = ${ADDR}`,
    );
    const channelIdentityId = (ch as { id: string }).id;

    // Re-challenge: resolves the founder's OWN unverified channel (not a
    // caller-supplied one), mints a fresh challenge, and sends a new code.
    const result = await resendVerification(
      { otp: { secret }, port: channel.port, runScoped },
      { founderId },
    );
    expect(result.outcome).toBe("executed");
    expect(channel.sent).toHaveLength(2);
    const [n] = await runScoped(
      founderId,
      (trx) => trx<{ c: number }[]>`
        select count(*)::int c from channel_verifications where channel_identity_id = ${channelIdentityId}`,
    );
    expect(n?.c).toBe(2);

    // The NEW code (from the resend) verifies the channel — the newest live
    // challenge supersedes the first.
    const newCode = extractOtpCode(channel.sent[1]?.text ?? "");
    const ok = await verifyChannelOtp(
      sql,
      { channelType: "imessage", address: ADDR, channelIdentityId, code: newCode as string },
      { secret },
    );
    expect(ok.verified).toBe(true);
  });

  it("Path C: synthesize candidates → pick idea → re-enter A (carryover) → seed", async () => {
    const engine = new InMemoryWorkflowEngine();
    const created = await createSession(sql, "C");
    const terminal = await drive(created.token, {
      "C.Q1": freeText("I run logistics operations"),
      "C.Q2": freeText("carrier scheduling is a nightmare"),
      "C.Q3": freeText("small freight brokers"),
      "C.Q4": tap("functional"),
      "C.Q5": tap("20"),
      "C.Q6": freeText("proving to myself I can build something real"),
      "C.Q7": tap("imessage", "+1601"),
    });
    // Path C sits at "synthesize", not "complete" — it needs a picked candidate.
    expect(terminal.type).toBe("synthesize");

    const session = await loadSession(sql, created.token);
    const fakeModel: CandidateModel = async () => [
      {
        id: "1",
        title: "Broker scheduler",
        kind: "idea",
        summary: "A scheduler for small freight brokers",
      },
      { id: "2", title: "Carrier CRM", kind: "problem", summary: "carrier relationship tracking" },
      { id: "3", title: "Load board", kind: "idea", summary: "a smarter load board" },
    ];
    const candidates = await synthesizeCandidates(
      fakeModel,
      (session as NonNullable<typeof session>).state,
    );
    expect(candidates.length).toBeGreaterThanOrEqual(3);

    // Founder picks the idea candidate → re-enter Path A; C's hours + channel
    // carry over (not re-asked); remaining Path A questions are asked next.
    const picked = candidates[0] as Candidate;
    const afterPick = await recordCandidatePick(sql, created.token, picked);
    expect(afterPick.session.state.path).toBe("A");
    expect(afterPick.next.type === "question" && afterPick.next.question.id).toBe("A.Q2");
    expect(afterPick.session.state.answers["A.Q5"]).toBeDefined(); // hours carried
    expect(afterPick.session.state.answers["A.Q8"]).toBeDefined(); // channel carried

    // Answer the remaining Path A questions and complete.
    await drive(created.token, {
      "A.Q2": freeText("I lived the scheduling pain for years"),
      "A.Q3": tap("no_demand"),
      "A.Q4": tap("just_clicked"),
      "A.Q7": freeText("the operator who ships"),
    });
    const { founderId } = await completeOnboarding({ sql, engine }, created.token);

    const [company] = await runScoped(
      founderId,
      (trx) => trx<{ state: Record<string, unknown> }[]>`select state from company_state`,
    );
    // Re-entered as an idea path; the candidate seeded the idea hypothesis.
    expect((company?.state as { entryPath?: string }).entryPath).toBe("idea");
    expect((company?.state as { ideaHypothesis?: string }).ideaHypothesis).toContain(
      "scheduler for small freight brokers",
    );
    // Carryover landed: available_time reflects C's 20h band, not a default.
    const traits = await runScoped(founderId, (trx) => listTraits(trx));
    const available = traits.find((t) => t.dimension === "available_time");
    expect(available?.stated.estimate).toBeCloseTo(0.5, 5); // 20/40
    // §3.2 origin signal survived the C→A re-route: process_sophistication seeded
    // below the native idea default (0.55), not at it (ADR 0015).
    const proc = traits.find((t) => t.dimension === "process_sophistication");
    expect(proc?.stated.estimate).toBeLessThan(0.55);
  });

  it("Path C: picking a problem candidate re-enters Path B", async () => {
    const created = await createSession(sql, "C");
    await drive(created.token, {
      "C.Q1": freeText("marketing ops"),
      "C.Q2": freeText("attribution is broken"),
      "C.Q3": freeText("growth teams"),
      "C.Q4": tap("functional"),
      "C.Q5": tap("40"),
      "C.Q6": freeText("independence"),
      "C.Q7": tap("none"),
    });
    const session = await loadSession(sql, created.token);
    const problem: Candidate = {
      id: "p",
      title: "Attribution",
      kind: "problem",
      summary: "marketing attribution for growth teams",
    };
    const after = await recordCandidatePick(sql, created.token, problem);
    expect(after.session.state.path).toBe("B");
    expect(after.next.type === "question" && after.next.question.id).toBe("B.Q2");
    // B.Q1 seeded from the candidate; B.Q5 (hours) carried from C.Q5.
    expect(after.session.state.answers["B.Q1"]).toBeDefined();
    expect(after.session.state.answers["B.Q5"]).toBeDefined();
    void session;
  });

  it("'do not reach out' seeds the model with no channel and no OTP", async () => {
    const engine = new InMemoryWorkflowEngine();
    const channel = createMemoryChannel();
    const created = await createSession(sql, "A");
    await drive(created.token, pathAAnswers(tap("none")));

    const result = await completeOnboarding(
      { sql, engine, otp: { secret: "p" }, port: channel.port, runScoped },
      created.token,
    );
    expect(result.verificationSent).toBe(false);
    expect(channel.sent).toHaveLength(0);

    const channels = await runScoped(
      result.founderId,
      (trx) => trx<{ id: string }[]>`select id from channel_identities`,
    );
    expect(channels).toHaveLength(0);
    // The model still seeded — onboarding is not gated on a reachable channel.
    const traits = await runScoped(result.founderId, (trx) => listTraits(trx));
    expect(traits.length).toBeGreaterThan(0);
  });
});

if (!adminUrl) {
  it("entry integration SKIPPED — set TETHR_DATABASE_URL to run it", () => {
    expect(adminUrl).toBeUndefined();
  });
}
