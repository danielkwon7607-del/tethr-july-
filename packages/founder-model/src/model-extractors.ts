import type { TierRunner } from "@tethr/orchestration";
import { z } from "zod";
import type { TraitFamily } from "./trait-store";
import type { EpisodeRef, FounderScopedRunner, WireFact, WireObservation } from "./write-path";

// The production write-path extractors (§6.5), deferred from Build 4 and wired
// now that onboarding produces the first real episodes. `extract` is Tier-1
// (fast entity/relationship pull); `abstract` is Tier-2 (the GraphRAG-style
// roll-up into trait observations). Both fetch the episode body under the
// founder's RLS scope — events carry ids, not bodies (§18.5.6) — and validate
// the model's JSON at the boundary, because model output is untrusted external
// data: a malformed shape is rejected, never written.

const TRAIT_FAMILIES: readonly [TraitFamily, ...TraitFamily[]] = [
  "capacity",
  "execution",
  "risk_decision",
  "market_customer",
  "motivation_psychology",
  "communication",
  "skill_sophistication",
];

// Bounds are part of the boundary contract: a misbehaving model must not be
// able to drive an unbounded write loop or store pathological strings per
// episode. One episode's extraction is small by nature.
const MAX_ITEMS = 50;
const MAX_LEN = 200;

const shortString = z.string().min(1).max(MAX_LEN);
const entitySchema = z.object({ entityType: shortString, name: shortString });
const factsSchema = z.object({
  facts: z
    .array(
      z.object({
        source: entitySchema,
        relation: shortString,
        target: entitySchema,
        cardinality: z.enum(["one", "many"]).optional(),
      }),
    )
    .max(MAX_ITEMS),
});
const observationsSchema = z.object({
  observations: z
    .array(
      z.object({
        family: z.enum(TRAIT_FAMILIES),
        dimension: shortString,
        source: z.enum(["correction", "revealed", "proxy", "stated"]),
        estimate: z.number().min(0).max(1),
      }),
    )
    .max(MAX_ITEMS),
});

const EXTRACT_SYSTEM =
  "Extract entities and typed relationships from the founder episode. Return ONLY JSON " +
  '{"facts":[{"source":{"entityType","name"},"relation","target":{"entityType","name"},' +
  '"cardinality":"one"|"many"}]}. cardinality is "one" when the relation holds a single ' +
  'current value (supersedes prior), "many" when values coexist. Empty array if nothing.';

const ABSTRACT_SYSTEM =
  "Roll the founder episode up into behavioral trait observations. Return ONLY JSON " +
  '{"observations":[{"family","dimension","source","estimate"}]}. family is one of ' +
  `${TRAIT_FAMILIES.join(", ")}. source is "revealed" for observed behavior, "stated" for ` +
  'self-report, "correction" for a direct correction. estimate is 0..1. Empty array if nothing.';

/**
 * Strip a Markdown code fence if the model wrapped its output in one — any
 * language tag (```json, ```javascript, or a bare ```), not just `json`.
 * A syntactically invalid body throws, which the caller treats as a boundary
 * rejection (nothing is written), same as a Zod shape failure.
 */
function parseModelJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```[a-z0-9]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

type EpisodeContent = { kind: string; content: unknown };

export type ModelExtractorDeps = {
  tierRunner: TierRunner;
  runScoped: FounderScopedRunner;
};

export function createModelExtractors(deps: ModelExtractorDeps): {
  extract: (episode: EpisodeRef) => Promise<WireFact[]>;
  abstract: (episode: EpisodeRef) => Promise<WireObservation[]>;
} {
  const loadEpisode = (episode: EpisodeRef): Promise<EpisodeContent | null> =>
    deps.runScoped(episode.founderId, async (trx) => {
      const [row] = await trx<{ kind: string; content: unknown }[]>`
        select kind, content from episodes
        where id = ${episode.episodeId} and tombstoned_at is null`;
      return row ?? null;
    });

  const render = (episode: EpisodeContent): string =>
    `Episode (kind=${episode.kind}):\n${JSON.stringify(episode.content)}`;

  return {
    async extract(episode) {
      const loaded = await loadEpisode(episode);
      if (!loaded) return [];
      const result = await deps.tierRunner.tier1({
        system: EXTRACT_SYSTEM,
        prompt: render(loaded),
      });
      // exactOptionalPropertyTypes: omit cardinality rather than pass undefined
      // (assertFact defaults it to 'one', ADR 0008).
      return factsSchema.parse(parseModelJson(result.text)).facts.map(
        (fact): WireFact => ({
          source: fact.source,
          relation: fact.relation,
          target: fact.target,
          ...(fact.cardinality === undefined ? {} : { cardinality: fact.cardinality }),
        }),
      );
    },
    async abstract(episode) {
      const loaded = await loadEpisode(episode);
      if (!loaded) return [];
      const result = await deps.tierRunner.tier2({
        system: ABSTRACT_SYSTEM,
        prompt: render(loaded),
      });
      return observationsSchema.parse(parseModelJson(result.text)).observations;
    },
  };
}
