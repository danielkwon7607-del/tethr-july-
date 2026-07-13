import {
  founderIdForOnboardingSession,
  type OnboardingDeps,
  type OnboardingResult,
  runOnboarding,
} from "@tethr/onboarding";
import { nextStep } from "./machine";
import { toOnboardingInput } from "./mapping";
import { loadSession, markCompleted } from "./session";

// Completion: fold a finished conversation into the seed library (§3). The entry
// surface owns the conversation; @tethr/onboarding owns the atomic seed
// (Constitution XII). Idempotent by construction — runOnboarding resolves a
// repeat by onboarding_session_id (ADR 0015 §7), and markCompleted is a no-op
// once set — so a double-submit or a retry-after-send-failure is safe.

export async function completeOnboarding(
  deps: OnboardingDeps,
  token: string,
): Promise<OnboardingResult> {
  const session = await loadSession(deps.sql, token);
  if (!session) throw new Error("onboarding session not found or expired");

  // Idempotent re-submit: a completed session resolves to its existing founder
  // without re-running. Its `state` was cleared on completion (PII minimization),
  // so re-mapping it here would be both wrong and a crash — short-circuit first.
  if (session.completedAt) {
    const founderId = await founderIdForOnboardingSession(deps.sql, session.id);
    if (founderId) return { founderId, verificationSent: false };
  }

  // Only a terminal conversation seeds a model. Path C sits at "synthesize"
  // until its candidate is picked and re-entered as A/B, so it is not complete
  // here — the guard makes that an explicit error, not a malformed seed.
  const step = nextStep(session.state);
  if (step.type !== "complete") {
    throw new Error(`onboarding is not ready to complete (next step: ${step.type})`);
  }

  const input = { ...toOnboardingInput(session.state), onboardingSessionId: session.id };
  const result = await runOnboarding(deps, input);
  await markCompleted(deps.sql, token);
  return result;
}
