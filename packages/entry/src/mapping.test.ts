import { describe, expect, it } from "vitest";
import {
  type AnswerInput,
  applyAnswer,
  type ConversationState,
  startConversation,
} from "./machine";
import { toOnboardingInput } from "./mapping";

// answers → OnboardingInput (ADR 0015). Verifies free-text/tap routing, the
// banded hours, the channel (and the no-channel cases), and that narrativeSeeds
// carry the founder's verbatim words.

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

const fullPathA = (channel: AnswerInput): ConversationState =>
  answer(startConversation("A"), [
    ["A.Q1", freeText("AI for dentists")],
    ["A.Q2", freeText("it got under my skin in 2024")],
    ["A.Q3", t("no_demand")],
    ["A.Q4", t("sitting")],
    ["A.Q5", t("40")],
    ["A.Q6", freeText("I would regret not trying")],
    ["A.Q7", freeText("the version that ships anyway")],
    ["A.Q8", channel],
  ]);

describe("Path A mapping", () => {
  it("routes free text and taps to the annotated fields", () => {
    const input = toOnboardingInput(fullPathA(t("imessage", "+15551234567")));
    expect(input.path).toBe("idea");
    expect(input.ideaText).toBe("AI for dentists");
    expect(input.channel).toEqual({ channelType: "imessage", address: "+15551234567" });
    expect(input.selfReport?.availableHoursPerWeek).toBe(40);
  });

  it("captures narrativeSeeds verbatim (the §6.7 stated side)", () => {
    const input = toOnboardingInput(fullPathA(t("sms", "+15550000000")));
    expect(input.narrativeSeeds).toEqual({
      originStory: "it got under my skin in 2024",
      fearedOutcome:
        "That people don't actually have this problem badly enough to pay for a solution",
      oneYearRegret: "I would regret not trying",
      statedBuilderSelf: "the version that ships anyway",
    });
  });

  it("'do not reach out' yields no channel but still seeds", () => {
    const input = toOnboardingInput(fullPathA(t("none")));
    expect(input.channel).toBeUndefined();
    expect(input.path).toBe("idea");
    expect(input.ideaText).toBe("AI for dentists");
  });

  it("'email only' yields no channel (no email ChannelType, §10.2)", () => {
    const input = toOnboardingInput(fullPathA(t("email")));
    expect(input.channel).toBeUndefined();
  });
});

describe("A2 mapping", () => {
  it("collects buildingContext and prefers the A2 feared-outcome tap", () => {
    const state = answer(startConversation("A"), [
      ["A.Q1", freeText("a builder idea")],
      ["A.Q2", freeText("origin")],
      ["A.Q3", t("no_demand")],
      ["A.Q4", t("building")],
      ["A2.Q1", freeText("a working prototype")],
      ["A2.Q2", freeText("ten early users")],
      ["A2.Q3", freeText("cautiously positive")],
      ["A2.Q4", freeText("stuck on retention")],
      ["A2.Q5", t("15")],
      ["A2.Q6", t("not_the_one")],
      ["A2.Q7", t("whatsapp", "+15551239876")],
    ]);
    const input = toOnboardingInput(state);
    expect(input.path).toBe("idea");
    expect(input.buildingContext).toContain("a working prototype");
    expect(input.buildingContext).toContain("stuck on retention");
    expect(input.narrativeSeeds?.fearedOutcome).toBe(
      "That I am not actually the right person to pull this off",
    );
    expect(input.selfReport?.availableHoursPerWeek).toBe(15);
    expect(input.channel).toEqual({ channelType: "whatsapp", address: "+15551239876" });
  });
});

describe("Path B mapping", () => {
  it("maps to the problem path with the personal-moment origin story", () => {
    const state = answer(startConversation("B"), [
      ["B.Q1", freeText("scheduling is broken")],
      ["B.Q2", t("personally")],
      ["B.Q2b", freeText("the day I missed a shift")],
      ["B.Q3", freeText("hourly workers")],
      ["B.Q4", freeText("nothing good exists")],
      ["B.Q5", t("20")],
      ["B.Q6", freeText("I would still be stuck on it")],
      ["B.Q7", t("sms", "+15557654321")],
    ]);
    const input = toOnboardingInput(state);
    expect(input.path).toBe("problem");
    expect(input.problemText).toBe("scheduling is broken");
    expect(input.ideaText).toBeUndefined();
    expect(input.narrativeSeeds?.originStory).toBe("the day I missed a shift");
    expect(input.narrativeSeeds?.oneYearRegret).toBe("I would still be stuck on it");
    expect(input.channel).toEqual({ channelType: "sms", address: "+15557654321" });
  });
});
