import type { TraitFamily } from "@tethr/founder-model";
import type { ChannelType } from "@tethr/messaging";

// The three entry paths (§3.2) and the cold-start seed profile (§3.3, §6.13).
// Pure functions: the shape of the model before anything is persisted, so the
// seeding policy is unit-testable without a database. Everything here is a
// STATED read (§3.3 — onboarding produces a stated-heavy, low-confidence
// model); revealed reads accrue only once the founder starts acting (§6.7).

export type EntryPath = "idea" | "problem" | "none";

/**
 * Gently gathered self-reports (§3.3 "gathered gently"). All optional: a
 * founder made to answer a question that doesn't change tethr's behavior is a
 * violated principle (§3.1), so an absent answer takes a neutral prior rather
 * than forcing the question.
 */
export type SelfReport = {
  /** Hours the founder can realistically spend (gates plan pace, §6.3.A). */
  availableHoursPerWeek?: number;
  /** When in the day they act, 0–23 (drives intervention timing, §6.12). */
  activeHourOfDay?: number;
  /** Current load / burnout risk, 0–1 — the safety-bearing dimension (§6.14). */
  currentLoad?: number;
  /** How much contact they want, 0–1 (the cadence dial, §6.12). */
  communicationCadence?: number;
  /** Soft-nudge → hard-push preference, 0–1 (the accountability style, §6.12). */
  accountabilityStyle?: number;
  /** Comfort with customer contact, 0–1; avoidance = 1 − comfort (§6.3.D). */
  customerContactComfort?: number;
};

export type OnboardingInput = {
  path: EntryPath;
  /** The founder's own channel. Created UNVERIFIED (§18.5.2): onboarding proves
   * no address ownership, so verified_at is set only once the entry boundary's
   * verification step (OTP / proven inbound) hands over proof — see ADR 0011.
   * OPTIONAL (Build 9a): a founder who chose "Do not reach out" (or "Email
   * only", which the substrate has no channel type for — §10.2) onboards with
   * NO messaging channel; the model still seeds and Research still fires, but no
   * channel is created and no OTP is sent (ADR 0015). */
  channel?: { channelType: ChannelType; address: string };
  /** Supabase Auth user id (§18.5.2) — links the founder to their session so
   * the shell resolves founder from the JWT claim instead of a dev binding. */
  authUserId?: string;
  /** The entry-surface onboarding session this founder was created from (ADR
   * 0015 §7). Stored on the founder and checked on retry so a double-submitted
   * completion — or a retry after the post-commit OTP send failed — returns the
   * existing founder instead of creating a second, WITHOUT needing auth. */
  onboardingSessionId?: string;
  /** The path the founder ORIGINALLY entered on, when it differs from `path`.
   * A Path C founder (no idea) who picks a synthesized candidate is routed into
   * A/B, but arriving via C is itself a process-sophistication signal (§3.2)
   * that must not be lost in the re-route — so seedProfile starts their
   * process read below the native A/B default (ADR 0015). Set to "none" for a
   * Path-C origin; unset for native A/B founders. */
  originPath?: EntryPath;
  displayName?: string;
  companyName?: string;
  /** Idea path: recorded as a hypothesis, never a settled fact (§3.2). */
  ideaText?: string;
  /** Problem path: the problem space, framed researchable (§3.2). */
  problemText?: string;
  /** None path: a direction surfaced with the founder, not invented (§3.2). */
  surfacedDirection?: string;
  /** Path A2 (already building): what exists, who uses it, the response, the
   * blocker. Free-text build context, not a hypothesis to stress-test. */
  buildingContext?: string;
  /**
   * Free-text narrative the question set draws out (origin story, feared
   * outcome, one-year regret, stated builder-self). NOT trait estimates — raw
   * material for §6.7 stated-vs-revealed reconciliation later. Persisted into
   * the onboarding episode with the same provenance discipline as every seed
   * (§6.4), never discarded after the conversation (ADR 0015 §6).
   */
  narrativeSeeds?: NarrativeSeeds;
  selfReport?: SelfReport;
};

/** Stated self-descriptions the founder gives during onboarding; §6.7 later
 * reconciles these against revealed behavior. All optional (a founder may skip
 * a free-text prompt), and each is kept verbatim — this is the "stated" side of
 * the divergence that is itself a primary signal (§6.7). */
export type NarrativeSeeds = {
  originStory?: string;
  fearedOutcome?: string;
  oneYearRegret?: string;
  statedBuilderSelf?: string;
};

export type TraitSeed = { family: TraitFamily; dimension: string; estimate: number };

const NEUTRAL = 0.5;
// A fresh founder is assumed low-load until they reveal otherwise; the veto is
// gated on confidence, so a low stated read never triggers it (§6.14, §6.15).
const FRESH_FOUNDER_LOAD = 0.3;
const FULL_TIME_HOURS = 40;
// §3.2: the path taken is itself a process-sophistication signal — an idea in
// hand implies more of the build sequence is already held than nothing does.
const PROCESS_BY_PATH: Record<EntryPath, number> = { none: 0.2, problem: 0.4, idea: 0.55 };

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const orDefault = (value: number | undefined, fallback: number): number =>
  value === undefined ? fallback : clamp01(value);

/**
 * The cold-start seed set (§6.13): the highest-leverage dimensions, each a
 * low-confidence STATED read. The set is the UNION of §3.3's families and the
 * four dimensions `registerInitiation` consumes (accountability, cadence,
 * rhythm, burnout) — so the very first proactive contact is personalized from
 * message one, and conservative because a single stated read is low-confidence.
 */
export function seedProfile(input: OnboardingInput): TraitSeed[] {
  const report = input.selfReport ?? {};
  const availableTime =
    report.availableHoursPerWeek === undefined
      ? NEUTRAL
      : clamp01(report.availableHoursPerWeek / FULL_TIME_HOURS);
  const workingRhythm =
    report.activeHourOfDay === undefined ? NEUTRAL : clamp01(report.activeHourOfDay / 24);
  const customerAvoidance =
    report.customerContactComfort === undefined
      ? NEUTRAL
      : clamp01(1 - report.customerContactComfort);

  // §3.2: the path is a process-sophistication signal. A founder routed into A/B
  // FROM Path C (arrived with no idea) is less process-sophisticated than one who
  // walked in with an idea/direction, so their read starts between the resolved
  // path's prior and the "none" prior — the C-origin signal is not lost in the
  // re-route (ADR 0015). Native A/B founders are unaffected (originPath unset).
  const processSophistication =
    input.originPath === "none" && input.path !== "none"
      ? (PROCESS_BY_PATH[input.path] + PROCESS_BY_PATH.none) / 2
      : PROCESS_BY_PATH[input.path];

  return [
    { family: "capacity", dimension: "available_time", estimate: availableTime },
    { family: "capacity", dimension: "working_rhythm", estimate: workingRhythm },
    {
      family: "capacity",
      dimension: "load_burnout",
      estimate: orDefault(report.currentLoad, FRESH_FOUNDER_LOAD),
    },
    {
      family: "communication",
      dimension: "communication_cadence",
      estimate: orDefault(report.communicationCadence, NEUTRAL),
    },
    {
      family: "motivation_psychology",
      dimension: "accountability_responsiveness",
      estimate: orDefault(report.accountabilityStyle, NEUTRAL),
    },
    {
      family: "market_customer",
      dimension: "customer_contact_avoidance",
      estimate: customerAvoidance,
    },
    {
      family: "skill_sophistication",
      dimension: "process_sophistication",
      estimate: processSophistication,
    },
  ];
}

/** JSON-safe (§8 durable-boundary discipline): only the keys §3.3 stores. */
export type CompanySeedState = {
  entryPath: EntryPath;
  ideaHypothesis?: string;
  problem?: string;
  surfacedDirection?: string;
};

export type CompanyStateSeed = {
  companyName?: string;
  stage: string;
  state: CompanySeedState;
};

/** Into Company State (§3.3): the idea/problem, the stage, named context. */
export function companyStateSeed(input: OnboardingInput): CompanyStateSeed {
  const state: CompanySeedState = {
    entryPath: input.path,
    // §3.2: the idea is a hypothesis to stress-test, not a fact to build on.
    ...(input.path === "idea" && input.ideaText ? { ideaHypothesis: input.ideaText } : {}),
    ...(input.path === "problem" && input.problemText ? { problem: input.problemText } : {}),
    ...(input.path === "none" && input.surfacedDirection
      ? { surfacedDirection: input.surfacedDirection }
      : {}),
  };
  return {
    stage: "onboarding",
    state,
    ...(input.companyName === undefined ? {} : { companyName: input.companyName }),
  };
}
