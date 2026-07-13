import {
  B_PERSONAL_VALUES,
  type EntryPathId,
  PATH_A,
  PATH_A2,
  PATH_B,
  PATH_C,
  QUESTION_BY_ID,
  type Question,
  STAGE_BUILDING,
} from "./questions";

// The onboarding state machine (§3.2). Explicit and path-specific by design —
// NOT a configurable question engine (Ponytail, ADR 0015): there are exactly
// four paths with two branches (A→A2 at the stage tap; B's personal-moment
// branch), and Path C's synthesis handoff. Pure: (path, answers) → next step,
// so every path is unit-testable without a database or a browser.

/** A founder's answer. Tap answers are canonicalized on store so `label` is the
 * verbatim option copy from questions.ts, not whatever the caller passed —
 * narrativeSeeds.fearedOutcome must be the founder's exact words. */
export type TapAnswer = {
  readonly kind: "tap";
  readonly value: string;
  readonly label: string;
  /** Only for the channel question, and only for imessage/whatsapp/sms. */
  readonly phone?: string;
};
export type Answer = { readonly kind: "free_text"; readonly text: string } | TapAnswer;

/** What the caller submits; `label` is derived from the question's options. */
export type AnswerInput =
  | { readonly kind: "free_text"; readonly text: string }
  | { readonly kind: "tap"; readonly value: string; readonly phone?: string };

export type ConversationState = {
  /** The path the founder entered on. A→A2 is a branch derived from the stage
   * answer, not a path change; Path C re-entry (→A/B) is handled downstream. */
  readonly path: EntryPathId;
  readonly answers: Readonly<Record<string, Answer>>;
  /** Set to "C" when a Path C founder picked a candidate and was re-routed into
   * A/B — the origin is carried so seeding keeps the §3.2 process signal (ADR
   * 0015). Unset for native A/A2/B/C conversations. */
  readonly originPath?: EntryPathId;
};

export type Step =
  | { readonly type: "question"; readonly question: Question }
  /** Path C collected enough: surface 3–5 candidates, then re-enter as A or B. */
  | { readonly type: "synthesize" }
  | { readonly type: "complete" };

export function startConversation(path: EntryPathId): ConversationState {
  return { path, answers: {} };
}

/** The ordered question sequence for the current state, with branches resolved.
 * Derived from answers so the machine holds no mutable branch flag. */
function sequenceFor(state: ConversationState): readonly Question[] {
  const a = state.answers;
  switch (state.path) {
    case "A":
    case "A2": {
      // A→A2 branch: once the founder says they're already building, the stage
      // tap is the last Path-A question; the rest of the flow is Path A2.
      if (a["A.Q4"]?.kind === "tap" && a["A.Q4"].value === STAGE_BUILDING) {
        return [...PATH_A.slice(0, 4), ...PATH_A2];
      }
      return PATH_A;
    }
    case "B": {
      // B's personal-moment origin story (B.Q2b) is asked only when the founder
      // has lived the problem (personally / both), not watched-only.
      const lived =
        a["B.Q2"]?.kind === "tap" && B_PERSONAL_VALUES.includes(a["B.Q2"].value as never);
      return lived ? PATH_B : PATH_B.filter((q) => q.id !== "B.Q2b");
    }
    case "C":
      return PATH_C;
  }
}

export function nextStep(state: ConversationState): Step {
  for (const question of sequenceFor(state)) {
    if (!state.answers[question.id]) return { type: "question", question };
  }
  // Everything asked. Path C surfaces candidates before it can seed a model
  // (§3.2 none-path); every other path is ready to complete.
  return state.path === "C" ? { type: "synthesize" } : { type: "complete" };
}

/** Immutably record an answer, canonicalizing tap labels and validating the
 * answer against the question (the one runnable guard on the input boundary). */
export function applyAnswer(
  state: ConversationState,
  questionId: string,
  input: AnswerInput,
): ConversationState {
  const question = QUESTION_BY_ID.get(questionId);
  if (!question) throw new Error(`unknown question: ${questionId}`);
  const answer = validateAndCanonicalize(question, input);
  return { ...state, answers: { ...state.answers, [questionId]: answer } };
}

const PHONE_CHANNELS = new Set(["imessage", "whatsapp", "sms"]);

function validateAndCanonicalize(question: Question, input: AnswerInput): Answer {
  if (question.kind === "free_text") {
    if (input.kind !== "free_text" || input.text.trim() === "") {
      throw new Error(`${question.id} expects non-empty free text`);
    }
    return { kind: "free_text", text: input.text };
  }
  if (input.kind !== "tap") throw new Error(`${question.id} expects a tap`);
  const option = question.options?.find((o) => o.value === input.value);
  if (!option) throw new Error(`${question.id}: invalid option "${input.value}"`);
  if (question.kind === "tap_phone" && PHONE_CHANNELS.has(input.value)) {
    if (!input.phone || input.phone.trim() === "") {
      throw new Error(`${question.id}: "${input.value}" requires a phone number`);
    }
  }
  return {
    kind: "tap",
    value: option.value,
    label: option.label,
    ...(input.phone ? { phone: input.phone } : {}),
  };
}
