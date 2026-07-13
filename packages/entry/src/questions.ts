// The onboarding question set (§3.2), verbatim and FINAL (CEO-approved, ADR
// 0015). Reconciled 2026-07-12 from two founder pastes; do not rewrite,
// rephrase, or "improve" this copy. This module is pure display+structure data:
// which questions, in which order, with which tap options and interstitials.
// WHERE each answer lands is mapping.ts's concern (kept separate so the copy is
// one source of truth and the field routing another — Constitution VII).

export type EntryPathId = "A" | "A2" | "B" | "C";

/** free_text = the founder types; tap = pick one option; tap_phone = pick a
 * channel and, for iMessage/WhatsApp/SMS, give a phone number (§Q8). */
export type QuestionKind = "free_text" | "tap" | "tap_phone";

export type TapOption = { readonly label: string; readonly value: string };

export type Question = {
  readonly id: string;
  readonly kind: QuestionKind;
  readonly prompt: string;
  readonly options?: readonly TapOption[];
  /** A verbatim status line tethr shows AFTER this answer (e.g. "scanning X, HN,
   * and Reddit…"). Part of the UX, not decoration — also final copy. */
  readonly interstitialAfter?: string;
};

// ── Shared tap option sets (asked identically across paths) ──────────────────

/** A Q3 / A2 Q6 — feared outcome. Mapping stores the chosen LABEL verbatim as
 * narrativeSeeds.fearedOutcome (the founder's own words), so the value is just
 * a stable code. */
const FEAR_OPTIONS: readonly TapOption[] = [
  {
    label: "That people don't actually have this problem badly enough to pay for a solution",
    value: "no_demand",
  },
  {
    label: "That someone smarter and better funded is already building this right now",
    value: "outcompeted",
  },
  { label: "That I will lose conviction before I build anything real", value: "lose_conviction" },
  { label: "That I am not actually the right person to pull this off", value: "not_the_one" },
];

/** A Q4 — stage. The final option branches into Path A2 (already building). */
export const STAGE_BUILDING = "building";
const STAGE_OPTIONS: readonly TapOption[] = [
  { label: "The idea just clicked and I have not done anything yet", value: "just_clicked" },
  { label: "I have been sitting on this for a while and have not started", value: "sitting" },
  { label: "I have done some early research or talked to a few people", value: "early_research" },
  { label: "I have already started building something", value: STAGE_BUILDING },
];

/** Q5 (all paths) — life context, banded to available hours/week. The value is
 * the banded hours estimate mapping feeds seedProfile.availableHoursPerWeek. */
const HOURS_OPTIONS: readonly TapOption[] = [
  { label: "A full time job with limited hours outside of it", value: "10" },
  { label: "School and everything that comes with that", value: "15" },
  { label: "I have time but a lot of other uncertainty around me", value: "20" },
  { label: "I can genuinely go all in on this right now", value: "40" },
];

/** Q8 / Q7 (all paths) — the reach channel. imessage/whatsapp/sms need a phone;
 * "email" has no messaging ChannelType (§10.2) and "none" is opt-out, so both
 * onboard with NO channel and NO OTP (ADR 0015). */
const CHANNEL_OPTIONS: readonly TapOption[] = [
  { label: "iMessage", value: "imessage" },
  { label: "WhatsApp", value: "whatsapp" },
  { label: "Text me (SMS)", value: "sms" },
  { label: "Email only", value: "email" },
  { label: "Do not reach out", value: "none" },
];

const channelQuestion = (id: string): Question => ({
  id,
  kind: "tap_phone",
  prompt: "How do you want tethr to reach you when you go quiet?",
  options: CHANNEL_OPTIONS,
});

// ── PATH A — has a specific idea ─────────────────────────────────────────────

export const PATH_A: readonly Question[] = [
  {
    id: "A.Q1",
    kind: "free_text",
    prompt:
      "Tell tethr about the idea. The pitch version can wait. Walk through what you actually noticed or experienced that made you think this needs to exist. The research starts the moment you send this.",
    interstitialAfter: "scanning X, HN, and Reddit for your market right now. keep going.",
  },
  {
    id: "A.Q2",
    kind: "free_text",
    prompt:
      "When did this problem first get under your skin, and why haven't you been able to let it go since then?",
  },
  {
    id: "A.Q3",
    kind: "tap",
    prompt: "What is the honest version of what you are most afraid to find out about this idea?",
    options: FEAR_OPTIONS,
    interstitialAfter:
      "that is the first assumption the research will test. you will not have to guess.",
  },
  {
    id: "A.Q4",
    kind: "tap",
    prompt: "Where are you right now with this?",
    options: STAGE_OPTIONS,
  },
  {
    id: "A.Q5",
    kind: "tap",
    prompt: "What does building this have to work around in your life right now?",
    options: HOURS_OPTIONS,
  },
  {
    id: "A.Q6",
    kind: "free_text",
    prompt:
      "A year from now, if this idea is still just an idea, what is the specific thing about that you will not be able to stop thinking about?",
    interstitialAfter: "tethr will hold you to that version. not the other one.",
  },
  {
    id: "A.Q7",
    kind: "free_text",
    prompt:
      "Describe the version of you that actually builds this. The one who shows up when the research comes back with something uncomfortable, when two weeks pass and nothing has moved, when it would be very easy to quietly let this die. What does that person do differently from how you usually operate?",
  },
  channelQuestion("A.Q8"),
];

// ── PATH A2 — already building (branch from A Q4 = STAGE_BUILDING) ────────────

export const PATH_A2: readonly Question[] = [
  {
    id: "A2.Q1",
    kind: "free_text",
    prompt:
      "Walk through what you have built so far. What exists, what works, and what is still missing.",
  },
  {
    id: "A2.Q2",
    kind: "free_text",
    prompt:
      "Who is using it right now, even informally? Be as specific as you can about who they are.",
  },
  {
    id: "A2.Q3",
    kind: "free_text",
    prompt:
      "What has the response been? What are people actually saying, and what are you sensing they mean but are not saying out loud.",
  },
  {
    id: "A2.Q4",
    kind: "free_text",
    prompt: "What is the single thing you are most stuck on right now.",
  },
  { id: "A2.Q5", kind: "tap", prompt: HOURS_PROMPT(), options: HOURS_OPTIONS },
  {
    id: "A2.Q6",
    kind: "tap",
    prompt: "What is the honest version of what you are most afraid to find out about this idea?",
    options: FEAR_OPTIONS,
  },
  channelQuestion("A2.Q7"),
];

// ── PATH B — has a direction, no specific idea ───────────────────────────────

export const B_PERSONAL_VALUES = ["personally", "both"] as const;
/** B Q2's answer branches to the personal-moment origin-story question when the
 * founder has lived the problem (personally or both) — not for watched-only. */
const LIVED_OPTIONS: readonly TapOption[] = [
  { label: "I have experienced this personally", value: "personally" },
  { label: "I have watched others deal with it", value: "watched" },
  { label: "Both, honestly", value: "both" },
];

export const PATH_B: readonly Question[] = [
  {
    id: "B.Q1",
    kind: "free_text",
    prompt:
      "What space or problem area keeps pulling your attention? Walk through what draws you to it and what you keep noticing about it.",
  },
  {
    id: "B.Q2",
    kind: "tap",
    prompt:
      "Is this a problem you have lived through yourself, or one you have watched other people struggle with?",
    options: LIVED_OPTIONS,
  },
  {
    // Branch: only reached when B.Q2 ∈ B_PERSONAL_VALUES (machine.ts).
    id: "B.Q2b",
    kind: "free_text",
    prompt:
      "Walk through a specific moment when you felt this problem. When was it, what were you trying to do, and what made it so frustrating.",
  },
  {
    id: "B.Q3",
    kind: "free_text",
    prompt:
      "Who in this space do you think has the fewest good options right now? Walk through who they are and what makes their situation particularly underserved.",
  },
  {
    id: "B.Q4",
    kind: "free_text",
    prompt:
      "What already exists in this space, and what makes you think there is still a genuine opening?",
  },
  { id: "B.Q5", kind: "tap", prompt: HOURS_PROMPT(), options: HOURS_OPTIONS },
  {
    id: "B.Q6",
    kind: "free_text",
    prompt:
      "A year from now, if you still have not tried to build anything in this space, what is the specific thing about that you will not be able to stop thinking about.",
  },
  channelQuestion("B.Q7"),
];

// ── PATH C — no idea at all ──────────────────────────────────────────────────

const BUILD_TYPE_OPTIONS: readonly TapOption[] = [
  { label: "Something that solves a clear, functional problem", value: "functional" },
  { label: "Something that changes how people feel about something", value: "emotional" },
  { label: "I genuinely do not know yet", value: "unsure" },
];

export const PATH_C: readonly Question[] = [
  {
    id: "C.Q1",
    kind: "free_text",
    prompt:
      "What do you spend most of your time doing right now, and what do you genuinely know better than most people.",
  },
  {
    id: "C.Q2",
    kind: "free_text",
    prompt:
      "What is something you deal with regularly that feels more broken or frustrating than it has any right to be. It does not have to be startup-worthy. Just something that genuinely bothers you.",
  },
  {
    id: "C.Q3",
    kind: "free_text",
    prompt:
      "Is there a specific type of person whose situation you understand from the inside. Someone whose problems and daily life you know well enough that you could describe their frustrations without asking them.",
  },
  {
    id: "C.Q4",
    kind: "tap",
    prompt: "What kind of thing do you want to build?",
    options: BUILD_TYPE_OPTIONS,
  },
  { id: "C.Q5", kind: "tap", prompt: HOURS_PROMPT(), options: HOURS_OPTIONS },
  {
    id: "C.Q6",
    kind: "free_text",
    prompt:
      "What would have to happen for this to feel worth it to you. Not the startup answer. What would actually matter to you, specifically.",
  },
  channelQuestion("C.Q7"),
];

/** Q5's prompt is identical everywhere it appears; one source (Constitution
 * VII). Kept as a function so it reads as shared, not copy-pasted. */
function HOURS_PROMPT(): string {
  return "What does building this have to work around in your life right now?";
}

export const PATHS: Record<EntryPathId, readonly Question[]> = {
  A: PATH_A,
  A2: PATH_A2,
  B: PATH_B,
  C: PATH_C,
};

/** Every question by id, across all paths — for answer lookup and rendering. */
export const QUESTION_BY_ID: ReadonlyMap<string, Question> = new Map(
  [...PATH_A, ...PATH_A2, ...PATH_B, ...PATH_C].map((q) => [q.id, q]),
);
