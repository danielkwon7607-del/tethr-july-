import type { ChannelType } from "@tethr/messaging";
import type { NarrativeSeeds, OnboardingInput } from "@tethr/onboarding";
import type { Answer, ConversationState } from "./machine";
import { STAGE_BUILDING } from "./questions";

// Answer → OnboardingInput (ADR 0015 field mapping). Explicit per-question
// routing, keyed on the fixed question ids — the four paths are hardcoded (not a
// generic engine), so reading specific ids is clearer than any indirection.
// narrativeSeeds are the verbatim free-text / tapped-label the founder gave;
// they are raw material for §6.7 reconciliation, never trait estimates.

const text = (a?: Answer): string | undefined => (a?.kind === "free_text" ? a.text : undefined);
const tap = (a?: Answer): Extract<Answer, { kind: "tap" }> | undefined =>
  a?.kind === "tap" ? a : undefined;

/** Q5's banded life-context answer carries the hours estimate as its value. */
const HOURS_IDS = ["A.Q5", "A2.Q5", "B.Q5", "C.Q5"] as const;
/** The channel tap is each path's last question. */
const CHANNEL_IDS = ["A.Q8", "A2.Q7", "B.Q7", "C.Q7"] as const;
/** Channels the messaging substrate can actually send on (§10.2). "email" and
 * "none" are not among them, so they yield no channel and no OTP. */
const MESSAGING_CHANNELS = new Set<string>(["imessage", "whatsapp", "sms", "rcs"]);
const A2_CONTEXT_IDS = ["A2.Q1", "A2.Q2", "A2.Q3", "A2.Q4"] as const;

/**
 * Fold a completed conversation into the OnboardingInput `runOnboarding`
 * expects. Paths A/A2 → "idea", B → "problem". (Path C reaches here only after
 * its synthesis + re-entry has re-pathed it to A or B — handled upstream.)
 */
export function toOnboardingInput(state: ConversationState): OnboardingInput {
  const a = state.answers;
  const building = tap(a["A.Q4"])?.value === STAGE_BUILDING;

  const narrativeSeeds: NarrativeSeeds = {};
  const originStory = text(a["A.Q2"]) ?? text(a["B.Q2b"]);
  if (originStory) narrativeSeeds.originStory = originStory;
  // A2 re-asks the feared-outcome tap (A2.Q6); prefer it, else Path A's A.Q3.
  const fearedOutcome = tap(a["A2.Q6"])?.label ?? tap(a["A.Q3"])?.label;
  if (fearedOutcome) narrativeSeeds.fearedOutcome = fearedOutcome;
  const oneYearRegret = text(a["A.Q6"]) ?? text(a["B.Q6"]) ?? text(a["C.Q6"]);
  if (oneYearRegret) narrativeSeeds.oneYearRegret = oneYearRegret;
  const statedBuilderSelf = text(a["A.Q7"]);
  if (statedBuilderSelf) narrativeSeeds.statedBuilderSelf = statedBuilderSelf;

  let availableHoursPerWeek: number | undefined;
  for (const id of HOURS_IDS) {
    const t = tap(a[id]);
    if (t) {
      availableHoursPerWeek = Number(t.value);
      break;
    }
  }

  let channel: OnboardingInput["channel"];
  for (const id of CHANNEL_IDS) {
    const t = tap(a[id]);
    if (!t) continue;
    if (MESSAGING_CHANNELS.has(t.value) && t.phone) {
      channel = { channelType: t.value as ChannelType, address: t.phone };
    }
    break; // "email"/"none": no channel; the founder still onboards (ADR 0015).
  }

  const buildingContext = building
    ? A2_CONTEXT_IDS.map((id) => text(a[id]))
        .filter((v): v is string => Boolean(v))
        .join("\n\n") || undefined
    : undefined;

  const path: OnboardingInput["path"] =
    state.path === "B" ? "problem" : state.path === "C" ? "none" : "idea";

  const ideaText = text(a["A.Q1"]);
  const problemText = text(a["B.Q1"]);
  return {
    path,
    // A Path-C origin (the founder had no idea and picked a candidate) is passed
    // through so seedProfile starts process-sophistication below the A/B default
    // (§3.2, ADR 0015). Native A/B founders carry no originPath.
    ...(state.originPath === "C" ? { originPath: "none" as const } : {}),
    ...(channel ? { channel } : {}),
    ...(ideaText ? { ideaText } : {}),
    ...(problemText ? { problemText } : {}),
    ...(buildingContext ? { buildingContext } : {}),
    ...(Object.keys(narrativeSeeds).length > 0 ? { narrativeSeeds } : {}),
    ...(availableHoursPerWeek !== undefined ? { selfReport: { availableHoursPerWeek } } : {}),
  };
}
