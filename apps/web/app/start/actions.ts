"use server";

import { createDbClient, requireDatabaseUrl, type Sql } from "@tethr/db";
import {
  type AnswerInput,
  type Candidate,
  completeOnboarding,
  createSession,
  type EntryPathId,
  loadSession,
  nextStep,
  recordAnswer,
  recordCandidatePick,
  type Step,
  synthesizeCandidates,
} from "@tethr/entry";
import { InMemoryWorkflowEngine } from "@tethr/orchestration";
import { cookies } from "next/headers";

// Server actions for the web entry surface (§3.6, ADR 0015). The conversation
// state lives in the DB, keyed by an httpOnly token cookie the client never
// reads. Onboarding is PRE-founder, so these use a service-role connection
// (not the tethr_app-scoped shell reads in lib/data.ts).
//
// Deploy-time seams (handoff): the OTP send, the real Inngest engine (so the
// Research trigger reaches the deployed runner), and Path C's Tier-2 candidate
// model. Absent here, completion still seeds the founder + model atomically;
// the channel is created unverified with no code sent, matching the library's
// graceful degradation.

const COOKIE = "tethr_onboarding";
const TTL_SECONDS = 60 * 60 * 24 * 14;

let client: Sql | null = null;
const db = (): Sql => (client ??= createDbClient(requireDatabaseUrl(process.env), { max: 3 }));

const readToken = async (): Promise<string | null> => (await cookies()).get(COOKIE)?.value ?? null;

export type StepResult = { ok: true; step: Step } | { ok: false; error: string };

/** The current step for the token in the cookie, or null when there is no live
 * session (the page then shows the path picker). */
export async function currentStep(): Promise<Step | null> {
  const token = await readToken();
  if (!token) return null;
  const session = await loadSession(db(), token);
  if (!session) return null;
  if (session.completedAt) return { type: "complete" };
  return nextStep(session.state);
}

export async function startPath(path: EntryPathId): Promise<StepResult> {
  const session = await createSession(db(), path);
  (await cookies()).set(COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
  return { ok: true, step: nextStep(session.state) };
}

export async function submitAnswer(questionId: string, input: AnswerInput): Promise<StepResult> {
  const token = await readToken();
  if (!token) return { ok: false, error: "Your onboarding session expired. Start again." };
  try {
    const { next } = await recordAnswer(db(), token, questionId, input);
    return { ok: true, step: next };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save answer." };
  }
}

export async function pickCandidate(candidate: Candidate): Promise<StepResult> {
  const token = await readToken();
  if (!token) return { ok: false, error: "Your onboarding session expired. Start again." };
  try {
    const { next } = await recordCandidatePick(db(), token, candidate);
    return { ok: true, step: next };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not record pick." };
  }
}

export type FinishResult =
  | { ok: true; verificationSent: boolean; hasChannel: boolean }
  | { ok: false; error: string };

export async function finish(): Promise<FinishResult> {
  const token = await readToken();
  if (!token) return { ok: false, error: "Your onboarding session expired. Start again." };
  try {
    const session = await loadSession(db(), token);
    const hasChannel = Boolean(session && sessionHasChannel(session.state));
    // Deploy-time: swap InMemoryWorkflowEngine for the Inngest client, and pass
    // { otp, port, runScoped } so the OTP code actually sends.
    const result = await completeOnboarding(
      { sql: db(), engine: new InMemoryWorkflowEngine() },
      token,
    );
    return { ok: true, verificationSent: result.verificationSent, hasChannel };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not complete." };
  }
}

export async function surfaceCandidates(): Promise<
  { ok: true; candidates: Candidate[] } | { ok: false; error: string }
> {
  const token = await readToken();
  if (!token) return { ok: false, error: "Your onboarding session expired. Start again." };
  const session = await loadSession(db(), token);
  if (!session) return { ok: false, error: "Session not found." };
  try {
    // Deploy-time: wire a Tier-2 candidate model here (model-router, no Public
    // Knowledge — §3.2/ADR 0006). Until then the surface can't synthesize.
    const candidates = await synthesizeCandidates(candidateModel(), session.state);
    return { ok: true, candidates };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not surface." };
  }
}

// ── helpers (kept local to the action module) ──────────────────────────────

const candidateModel = () => async () => {
  throw new Error("Candidate synthesis needs the Tier-2 model (deploy-time wiring).");
};

const CHANNEL_IDS = ["A.Q8", "A2.Q7", "B.Q7", "C.Q7"];
function sessionHasChannel(state: { answers: Record<string, unknown> }): boolean {
  for (const id of CHANNEL_IDS) {
    const a = state.answers[id] as { value?: string } | undefined;
    if (a?.value) return a.value === "imessage" || a.value === "whatsapp" || a.value === "sms";
  }
  return false;
}
