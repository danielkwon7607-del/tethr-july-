import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { type Candidate, pickCandidate } from "./candidates";
import {
  type AnswerInput,
  applyAnswer,
  type ConversationState,
  nextStep,
  type Step,
  startConversation,
} from "./machine";
import type { EntryPathId } from "./questions";

// In-progress onboarding persistence (ADR 0015 §2–4). A draft is keyed by an
// opaque CSPRNG token — the founder's only handle — so a founder who goes quiet
// mid-flow resumes at the exact next question. Pre-founder state, service-role
// only (no RLS scope); partial PII is cleared by the 14-day sweep. `state` is
// the machine's ConversationState, opaque to the DB.

/** 24 bytes = 192 bits of CSPRNG entropy, url-safe (ADR 0015: token >=128-bit). */
const newToken = (): string => randomBytes(24).toString("base64url");

export type OnboardingSession = {
  readonly id: string;
  readonly token: string;
  readonly state: ConversationState;
  readonly completedAt: Date | null;
  readonly expiresAt: Date;
};

export async function createSession(sql: Sql, path: EntryPathId): Promise<OnboardingSession> {
  const token = newToken();
  const state = startConversation(path);
  const [row] = await sql<{ id: string; expires_at: Date }[]>`
    insert into onboarding_sessions (token, state)
    values (${token}, ${sql.json(state)})
    returning id, expires_at`;
  const created = row as { id: string; expires_at: Date };
  return { id: created.id, token, state, completedAt: null, expiresAt: created.expires_at };
}

/**
 * Load a resumable session by token. Returns null for an unknown token or for
 * an expired, still-incomplete draft (its PII is due to be swept — resuming
 * stale data is not resuming). A COMPLETED session still loads, so a re-submit
 * resolves idempotently (ADR 0015 §3).
 */
export async function loadSession(sql: Sql, token: string): Promise<OnboardingSession | null> {
  const [row] = await sql<
    { id: string; state: ConversationState; completed_at: Date | null; expires_at: Date }[]
  >`
    select id, state, completed_at, expires_at from onboarding_sessions
    where token = ${token} and (completed_at is not null or expires_at > now())`;
  if (!row) return null;
  return {
    id: row.id,
    token,
    state: row.state,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
  };
}

/** Record one answer (validated + canonicalized by the machine) and return the
 * updated session with the next step. Rejects writes to a completed draft. */
export async function recordAnswer(
  sql: Sql,
  token: string,
  questionId: string,
  input: AnswerInput,
): Promise<{ session: OnboardingSession; next: Step }> {
  const session = await loadSession(sql, token);
  if (!session) throw new Error("onboarding session not found or expired");
  if (session.completedAt) throw new Error("onboarding already completed");
  const state = applyAnswer(session.state, questionId, input);
  await sql`
    update onboarding_sessions set state = ${sql.json(state)}, updated_at = now()
    where token = ${token}`;
  return { session: { ...session, state }, next: nextStep(state) };
}

/** Path C: record the founder's candidate pick, re-pathing the draft to A or B
 * (candidates.pickCandidate) and persisting it. Returns the next step so the
 * caller keeps driving the re-entered path. */
export async function recordCandidatePick(
  sql: Sql,
  token: string,
  candidate: Candidate,
): Promise<{ session: OnboardingSession; next: Step }> {
  const session = await loadSession(sql, token);
  if (!session) throw new Error("onboarding session not found or expired");
  if (session.completedAt) throw new Error("onboarding already completed");
  const state = pickCandidate(session.state, candidate);
  await sql`
    update onboarding_sessions set state = ${sql.json(state)}, updated_at = now()
    where token = ${token}`;
  return { session: { ...session, state }, next: nextStep(state) };
}

export async function markCompleted(sql: Sql, token: string): Promise<void> {
  // Clear the answer PII on completion (review /cso, §6.16 minimization): the
  // answers are now in the founder model + onboarding episode with provenance,
  // so the session's copy is redundant. Idempotency rides on
  // founders.onboarding_session_id, not on state, so emptying it is safe.
  await sql`
    update onboarding_sessions
    set completed_at = now(), updated_at = now(), state = '{}'::jsonb
    where token = ${token} and completed_at is null`;
}

/** Delete expired, still-incomplete drafts and their partial PII (ADR 0015 §4).
 * Reversible in spirit — it only removes drafts no founder came back for. */
export async function sweepExpiredSessions(sql: Sql): Promise<number> {
  const rows = await sql`
    delete from onboarding_sessions
    where completed_at is null and expires_at <= now() returning id`;
  return rows.length;
}
