import { describe, expect, it } from "vitest";
import {
  type AnswerInput,
  applyAnswer,
  type ConversationState,
  nextStep,
  startConversation,
} from "./machine";

// The state machine (§3.2): four explicit paths, the A→A2 branch, B's personal
// branch, and Path C's synthesis handoff. Pure — no DB, no browser.

const answer = (
  state: ConversationState,
  steps: readonly [string, AnswerInput][],
): ConversationState => steps.reduce((s, [id, input]) => applyAnswer(s, id, input), state);

const freeText = (text: string): AnswerInput => ({ kind: "free_text", text });
const t = (value: string, phone?: string): AnswerInput => ({
  kind: "tap",
  value,
  ...(phone ? { phone } : {}),
});

const nextId = (state: ConversationState): string | null => {
  const step = nextStep(state);
  return step.type === "question" ? step.question.id : null;
};

describe("Path A sequencing", () => {
  it("opens on A.Q1 and advances in order", () => {
    let state = startConversation("A");
    expect(nextId(state)).toBe("A.Q1");
    state = answer(state, [
      ["A.Q1", freeText("an idea")],
      ["A.Q2", freeText("origin")],
      ["A.Q3", t("no_demand")],
    ]);
    expect(nextId(state)).toBe("A.Q4");
  });

  it("a non-building stage continues down Path A (Q5)", () => {
    const state = answer(startConversation("A"), [
      ["A.Q1", freeText("idea")],
      ["A.Q2", freeText("origin")],
      ["A.Q3", t("no_demand")],
      ["A.Q4", t("early_research")],
    ]);
    expect(nextId(state)).toBe("A.Q5");
  });

  it("completes after A.Q8", () => {
    const state = answer(startConversation("A"), [
      ["A.Q1", freeText("idea")],
      ["A.Q2", freeText("origin")],
      ["A.Q3", t("not_the_one")],
      ["A.Q4", t("sitting")],
      ["A.Q5", t("40")],
      ["A.Q6", freeText("regret")],
      ["A.Q7", freeText("builder")],
      ["A.Q8", t("imessage", "+15551234567")],
    ]);
    expect(nextStep(state).type).toBe("complete");
  });
});

describe("A→A2 branch", () => {
  it("branches into Path A2 when the founder is already building", () => {
    const state = answer(startConversation("A"), [
      ["A.Q1", freeText("idea")],
      ["A.Q2", freeText("origin")],
      ["A.Q3", t("outcompeted")],
      ["A.Q4", t("building")],
    ]);
    expect(nextId(state)).toBe("A2.Q1");
  });

  it("never asks A.Q5–A.Q8 on the A2 branch, and completes after A2.Q7", () => {
    const state = answer(startConversation("A"), [
      ["A.Q1", freeText("idea")],
      ["A.Q2", freeText("origin")],
      ["A.Q3", t("outcompeted")],
      ["A.Q4", t("building")],
      ["A2.Q1", freeText("built a prototype")],
      ["A2.Q2", freeText("a few early users")],
      ["A2.Q3", freeText("mixed response")],
      ["A2.Q4", freeText("stuck on pricing")],
      ["A2.Q5", t("10")],
      ["A2.Q6", t("lose_conviction")],
      ["A2.Q7", t("whatsapp", "+15559876543")],
    ]);
    expect(nextStep(state).type).toBe("complete");
    expect(state.answers["A.Q5"]).toBeUndefined();
  });
});

describe("Path B personal branch", () => {
  it("asks B.Q2b when the founder has lived the problem", () => {
    const state = answer(startConversation("B"), [
      ["B.Q1", freeText("a space")],
      ["B.Q2", t("personally")],
    ]);
    expect(nextId(state)).toBe("B.Q2b");
  });

  it("skips B.Q2b for watched-only", () => {
    const state = answer(startConversation("B"), [
      ["B.Q1", freeText("a space")],
      ["B.Q2", t("watched")],
    ]);
    expect(nextId(state)).toBe("B.Q3");
  });

  it("treats 'both' as lived (asks B.Q2b)", () => {
    const state = answer(startConversation("B"), [
      ["B.Q1", freeText("a space")],
      ["B.Q2", t("both")],
    ]);
    expect(nextId(state)).toBe("B.Q2b");
  });
});

describe("Path C synthesis handoff", () => {
  it("signals synthesize once Q1–Q7 are answered", () => {
    const state = answer(startConversation("C"), [
      ["C.Q1", freeText("what I do")],
      ["C.Q2", freeText("a frustration")],
      ["C.Q3", freeText("a person I understand")],
      ["C.Q4", t("functional")],
      ["C.Q5", t("20")],
      ["C.Q6", freeText("what would matter")],
      ["C.Q7", t("sms", "+15551112222")],
    ]);
    expect(nextStep(state).type).toBe("synthesize");
  });
});

describe("answer validation (input boundary guard)", () => {
  it("rejects empty free text", () => {
    expect(() => applyAnswer(startConversation("A"), "A.Q1", freeText("  "))).toThrow();
  });

  it("rejects an invalid tap option", () => {
    expect(() => applyAnswer(startConversation("A"), "A.Q3", t("nonsense"))).toThrow();
  });

  it("requires a phone for iMessage/WhatsApp/SMS", () => {
    expect(() => applyAnswer(startConversation("A"), "A.Q8", t("imessage"))).toThrow();
  });

  it("allows email and 'do not reach out' with no phone", () => {
    expect(() => applyAnswer(startConversation("A"), "A.Q8", t("email"))).not.toThrow();
    expect(() => applyAnswer(startConversation("A"), "A.Q8", t("none"))).not.toThrow();
  });

  it("canonicalizes the tap label from the question copy, not the caller", () => {
    const state = applyAnswer(startConversation("A"), "A.Q3", t("not_the_one"));
    const stored = state.answers["A.Q3"];
    expect(stored?.kind).toBe("tap");
    if (stored?.kind === "tap") {
      expect(stored.label).toBe("That I am not actually the right person to pull this off");
    }
  });

  it("rejects an unknown question id", () => {
    expect(() => applyAnswer(startConversation("A"), "A.Q99", freeText("x"))).toThrow();
  });
});
