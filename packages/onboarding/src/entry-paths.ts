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
  /** The founder's own channel, verified through onboarding (§18.5.2). */
  channel: { channelType: ChannelType; address: string };
  /** Supabase Auth user id (§18.5.2) — links the founder to their session so
   * the shell resolves founder from the JWT claim instead of a dev binding. */
  authUserId?: string;
  displayName?: string;
  companyName?: string;
  /** Idea path: recorded as a hypothesis, never a settled fact (§3.2). */
  ideaText?: string;
  /** Problem path: the problem space, framed researchable (§3.2). */
  problemText?: string;
  /** None path: a direction surfaced with the founder, not invented (§3.2). */
  surfacedDirection?: string;
  selfReport?: SelfReport;
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
      estimate: PROCESS_BY_PATH[input.path],
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
