import { loadConfig } from "@tethr/core";
import { currentStep } from "./actions";
import { Conversation } from "./Conversation";

// The entry surface (§3.6): a web conversational onboarding. The server resolves
// the current step for the session cookie (or none → the path picker); the
// client component drives the turn-by-turn conversation from there. Build 0's
// fail-fast property holds — the page renders only under a valid environment.

export const dynamic = "force-dynamic";

export default async function StartPage() {
  loadConfig(process.env);
  const step = await currentStep();
  return <Conversation initialStep={step} />;
}
