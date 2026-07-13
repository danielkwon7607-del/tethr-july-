import type { Answer, ConversationState } from "./machine";
import type { EntryPathId } from "./questions";

// Path C candidate surfacing + re-entry (§3.2 none-path, ADR 0015). After the
// founder answers C's questions, tethr synthesizes 3–5 starting directions from
// their OWN domain knowledge, frustrations, customer understanding, and desired
// product type — a Tier-2 model call, NOT a Public-Knowledge one (Ch 7 is
// Planning/Validation-only, ADR 0006; entry must not read the corpus). The
// founder picks one and re-enters as Path A (a specific idea) or B (a direction).

export type Candidate = {
  readonly id: string;
  readonly title: string;
  /** Which path the founder re-enters when they pick this (§3.2). */
  readonly kind: "idea" | "problem";
  readonly summary: string;
};

export type CandidateInputs = {
  domainKnowledge: string; // C.Q1
  frustration: string; // C.Q2
  customerUnderstood: string; // C.Q3
  productType: string; // C.Q4 (tapped value)
  whatMatters: string; // C.Q6
};

/** The Tier-2 synthesis seam. Injected — faked in tests, wired to a Tier-2 model
 * in production (model wiring is deploy-time, same posture as research/planning).
 * Deliberately not given a Public-Knowledge retriever: §3.2's none-path reads
 * the founder, not the market. */
export type CandidateModel = (inputs: CandidateInputs) => Promise<Candidate[]>;

const MIN_CANDIDATES = 3;
const MAX_CANDIDATES = 5;

const text = (a?: Answer): string => (a?.kind === "free_text" ? a.text : "");
const tapValue = (a?: Answer): string => (a?.kind === "tap" ? a.value : "");

/** Surface 3–5 candidates from a completed Path C. Throws outside the band — the
 * founder needs a real, bounded set to choose from, not zero and not a wall. */
export async function synthesizeCandidates(
  model: CandidateModel,
  state: ConversationState,
): Promise<Candidate[]> {
  if (state.path !== "C") throw new Error("candidate synthesis only applies to Path C");
  const a = state.answers;
  const candidates = await model({
    domainKnowledge: text(a["C.Q1"]),
    frustration: text(a["C.Q2"]),
    customerUnderstood: text(a["C.Q3"]),
    productType: tapValue(a["C.Q4"]),
    whatMatters: text(a["C.Q6"]),
  });
  if (candidates.length < MIN_CANDIDATES || candidates.length > MAX_CANDIDATES) {
    throw new Error(
      `expected ${MIN_CANDIDATES}-${MAX_CANDIDATES} candidates, got ${candidates.length}`,
    );
  }
  return candidates;
}

/**
 * The founder picks a candidate and re-enters as Path A (idea) or B (problem) —
 * §3.2. The chosen candidate seeds the opening question, and the life-context
 * (hours), what-matters (→ one-year regret), and channel ALREADY collected in
 * Path C carry over so they are not re-asked; the remaining path-specific
 * questions (origin/fear/builder-self for A, problem framing for B) are asked
 * next as normal.
 *
 * Structural decision (ADR 0015): carryover, not a full re-ask. Faithful to
 * "re-enter the relevant question set" without double-asking what C already
 * gathered. The CEO can override to full re-ask or a self-contained C.
 */
export function pickCandidate(state: ConversationState, candidate: Candidate): ConversationState {
  if (state.path !== "C") throw new Error("pickCandidate only applies to Path C");
  const target: EntryPathId = candidate.kind === "idea" ? "A" : "B";
  const c = state.answers;
  const seed = candidate.summary.trim() || candidate.title;
  const answers: Record<string, Answer> = {
    [target === "A" ? "A.Q1" : "B.Q1"]: { kind: "free_text", text: seed },
  };
  const carry = (fromId: string, toId: string): void => {
    const answer = c[fromId];
    if (answer) answers[toId] = answer;
  };
  carry("C.Q5", target === "A" ? "A.Q5" : "B.Q5"); // life context / hours
  carry("C.Q6", target === "A" ? "A.Q6" : "B.Q6"); // what matters → one-year regret
  carry("C.Q7", target === "A" ? "A.Q8" : "B.Q7"); // reach channel
  // Carry the C origin so seeding keeps the §3.2 process-sophistication signal
  // (this founder arrived with no idea, even though they now hold one).
  return { path: target, answers, originPath: "C" };
}
