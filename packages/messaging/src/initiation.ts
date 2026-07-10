import type { ActionLedger } from "@tethr/core";
import {
  type BehaviorCandidate,
  type BurnoutRead,
  decideAndRecord,
  learnedWeight,
  listTraits,
  type PolicyDecision,
  RECONCILIATION_FLAGGED_EVENT,
  type SideRead,
} from "@tethr/founder-model";
import type { WorkflowEngine } from "@tethr/orchestration";
import type { ChannelPort } from "./channel-port";
import { sendFounderMessage } from "./outbound";
import type { FounderScopedRunner } from "./runtime";

// Founder-initiated contact (§6.12 wired, not reimplemented): timing,
// cadence, and style are read from the Founder Model and scored by the
// EXISTING decideAndRecord — burnout veto, confidence gating, and learned
// weights all intact. This module maps dimension reads to candidates and
// acts on the decision; it owns no scoring shapes and no constants beyond
// the direct §6.12 sentence-to-code mappings below. Outcome-based
// reweighting (§6.9) fires from founder-response processing (Build 6+),
// not from delivery.

export const INITIATION_TRIGGER_EVENT = "messaging.initiation-trigger";
export const INITIATE_CONTACT_WORKFLOW_ID = "messaging.initiate-contact";

/** Soft check-ins fit everyone moderately (§6.12's universal fallback). */
const GENTLE_BASE_FIT = 0.65;
/** Timing follows working rhythm only when the read is trustworthy (§6.6). */
const RHYTHM_TIMING_CONFIDENCE = 0.5;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ComposeInput = { founderId: string; behavior: string; intensity: 1 | 2 | 3 };

export type InitiationDeps = {
  runScoped: FounderScopedRunner;
  port: ChannelPort;
  engine?: WorkflowEngine;
  /** The loop's dial (Ch 8), not a baked constant (ADR 0007). */
  actionThreshold: number;
  /** Message generation — Tier-2 through the tier runner in production. */
  compose: (input: ComposeInput) => Promise<string>;
  /** Test seam; production default is the founder-scoped Postgres ledger. */
  ledger?: ActionLedger;
};

type DimensionRead = { estimate: number; confidence: number };

/** Action policy follows revealed; stated only fills a cold void (§6.7). */
const readSide = (revealed: SideRead, stated: SideRead): DimensionRead => {
  const side = revealed.confidence > 0 ? revealed : stated;
  return {
    estimate: typeof side.estimate === "number" ? side.estimate : 0.5,
    confidence: side.confidence,
  };
};

export function registerInitiation(engine: WorkflowEngine, deps: InitiationDeps): void {
  // Build 5's internal trigger: a reconciliation flag (stated ≠ revealed) is
  // exactly the diagnostic that selects an intervention (§6.7, §6.12).
  engine.register({
    id: `${INITIATE_CONTACT_WORKFLOW_ID}.reconciliation-bridge`,
    trigger: { event: RECONCILIATION_FLAGGED_EVENT },
    handler: async (event) => {
      await engine.send({
        name: INITIATION_TRIGGER_EVENT,
        id: `init/${event.data.episodeId}/${event.data.dimension}`,
        data: {
          founderId: event.data.founderId ?? null,
          reason: "reconciliation",
          dimension: event.data.dimension ?? null,
        },
      });
    },
  });

  engine.register({
    id: INITIATE_CONTACT_WORKFLOW_ID,
    trigger: { event: INITIATION_TRIGGER_EVENT },
    handler: async (event, step) => {
      const founderId = event.data.founderId as string;
      // The payload's founderId decides the RLS scope below — treat it as
      // untrusted input (same defect class ADR 0008 fixed in the write
      // path). No external surface can inject this event today; the UUID
      // check keeps that true cheaply if one ever ships.
      if (!founderId || !UUID_PATTERN.test(founderId) || !event.id) {
        throw new Error(`${INITIATION_TRIGGER_EVENT} requires a UUID founderId and a dedup id`);
      }

      // Hot-path read (§6.5): the traits are already computed; extract the
      // JSON-safe reads this policy consumes.
      const model = await step.run("read-model", () =>
        deps.runScoped(founderId, async (trx) => {
          const traits = await listTraits(trx);
          const read = (dimension: string): DimensionRead | null => {
            const trait = traits.find((candidate) => candidate.dimension === dimension);
            return trait ? readSide(trait.revealed, trait.stated) : null;
          };
          return {
            accountability: read("accountability_responsiveness"),
            cadence: read("communication_cadence"),
            rhythm: read("working_rhythm"),
            burnout: read("load_burnout"),
          };
        }),
      );

      // Timing (§6.12): reach the founder inside their working window when
      // the rhythm read has earned trust; otherwise send when triggered.
      const rhythm = model.rhythm;
      if (rhythm && rhythm.confidence > RHYTHM_TIMING_CONFIDENCE) {
        await step.sleepUntil("wait-for-window", nextWorkingWindow(rhythm.estimate));
      }

      // Candidates: §6.12's accountability-style sentence, directly.
      // "Hard push for those who respond to it, soft nudge for those who
      // don't" — fit scales with the accountability read; every contact
      // candidate is dialed by the cadence preference (frequency is a dial
      // the model sets). Cold start: missing reads are neutral estimates at
      // ZERO confidence, so the gate suppresses action (§6.13).
      const accountability = model.accountability ?? { estimate: 0.5, confidence: 0 };
      const cadence = model.cadence ?? { estimate: 0.5, confidence: 0 };

      const decision = await step.run("decide", () =>
        deps.runScoped(founderId, async (trx) => {
          const candidates: BehaviorCandidate[] = [
            {
              behavior: "nudge.hard",
              baseFit: accountability.estimate * cadence.estimate,
              dimensionConfidences: [accountability.confidence, cadence.confidence],
              learnedWeight: await learnedWeight(trx, "nudge.hard"),
              paceIncreasing: true,
              intensity: 3,
            },
            {
              behavior: "checkin.gentle",
              baseFit: GENTLE_BASE_FIT * cadence.estimate,
              dimensionConfidences: [cadence.confidence],
              learnedWeight: await learnedWeight(trx, "checkin.gentle"),
              intensity: 1,
            },
          ];
          const burnout: BurnoutRead | undefined =
            model.burnout && model.burnout.confidence > 0
              ? { estimate: model.burnout.estimate, confidence: model.burnout.confidence }
              : undefined;
          return decideAndRecord(trx, candidates, {
            actionThreshold: deps.actionThreshold,
            ...(burnout ? { burnout } : {}),
          }) as Promise<PolicyDecision>;
        }),
      );

      // Below threshold the policy degrades to asking (§8.5) — for an
      // intervention, "ask" means hold: no contact is the conservative act.
      if (decision.kind !== "act") return;

      const intensity = decision.behavior === "nudge.hard" ? 3 : 1;
      const text = await step.run("compose", () =>
        deps.compose({ founderId, behavior: decision.behavior, intensity }),
      );
      await sendFounderMessage(
        {
          step,
          engine,
          runScoped: deps.runScoped,
          port: deps.port,
          ...(deps.ledger ? { ledger: deps.ledger } : {}),
        },
        { founderId, text, initiatingEventId: event.id },
      );
    },
  });
}

/** v0: the rhythm estimate encodes the founder's active hour as a day fraction. */
function nextWorkingWindow(estimate: number): Date {
  const hour = Math.min(23, Math.max(0, Math.round(estimate * 24)));
  const window = new Date();
  window.setMinutes(0, 0, 0);
  window.setHours(hour);
  if (window.getTime() <= Date.now()) window.setDate(window.getDate() + 1);
  return window;
}
