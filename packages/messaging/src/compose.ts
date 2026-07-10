import type { TierRunner } from "@tethr/orchestration";
import type { ComposeInput } from "./initiation";

// Tier-2 message composition for initiation (§8.3, Ch 20), replacing Build 5's
// template compose. High-judgment generation is exactly Tier-2's lane; the
// message is the founder-facing texture the §6.12 intensity produced. Injected
// into registerInitiation as `compose`, so tests stay on a fake runner.

const INTENSITY_BRIEF: Record<1 | 2 | 3, string> = {
  1: "a gentle, low-pressure check-in",
  2: "a warm but clear nudge",
  3: "a firm, direct push",
};

const COMPOSE_SYSTEM =
  "You are tethr, an AI cofounder texting the founder. Write ONE short, natural message — " +
  "no greeting boilerplate, no sign-off, no subject. It should read like a text from a " +
  "cofounder, matching the requested intensity.";

export function createInitiationCompose(
  tierRunner: TierRunner,
): (input: ComposeInput) => Promise<string> {
  return async ({ behavior, intensity }) => {
    const result = await tierRunner.tier2({
      system: COMPOSE_SYSTEM,
      prompt: `Compose ${INTENSITY_BRIEF[intensity]} for behavior "${behavior}". One or two sentences.`,
    });
    return result.text.trim();
  };
}
