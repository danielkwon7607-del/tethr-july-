import type { JsonValue, WorkflowEngine } from "@tethr/orchestration";
import type { Sql } from "postgres";
import type { ObservationSource } from "./calibration";
import { assertFact } from "./graph-store";
import { recordObservation, type TraitFamily } from "./trait-store";

// The background write path (§6.5), on the Build 2 orchestration engine and
// OFF the hot path: log → extract → abstract → reconcile run as durable,
// memoized steps after the turn, so they can be as expensive as they need to
// be without slowing the founder down. Extraction/abstraction are injected:
// in production they are Tier-1/Tier-2 model calls through the tier runner
// (Ch 20); tests inject deterministic functions. Reconciliations that fire
// become internal events (§8.2) for the intervention policy to consume.

export const EPISODE_LOGGED_EVENT = "founder.episode-logged";
export const RECONCILIATION_FLAGGED_EVENT = "founder.reconciliation-flagged";
export const WRITE_PATH_WORKFLOW_ID = "founder-model.write-path";

export type EpisodeRef = { episodeId: string; founderId: string };

/** withFounderContext partially applied: background writes stay under RLS. */
export type FounderScopedRunner = <T>(
  founderId: string,
  work: (trx: Sql) => Promise<T>,
) => Promise<T>;

// JSON-safe wire shapes: step results cross the durable boundary and must
// survive the engine's JSON round-trip (memoized replays).
export type WireEntity = { entityType: string; name: string };
export type WireFact = {
  source: WireEntity;
  relation: string;
  target: WireEntity;
  /** Relation cardinality (ADR 0008); defaults to 'one' in assertFact. */
  cardinality?: "one" | "many";
  attributes?: { [key: string]: JsonValue };
  provenanceEpisodeIds?: string[];
};
export type WireObservation = {
  family: TraitFamily;
  dimension: string;
  source: ObservationSource;
  /** Normalized [0,1]. */
  estimate: number;
  provenanceEpisodeIds?: string[];
};

export type WritePathDeps = {
  runScoped: FounderScopedRunner;
  /** Pull entities/relationships out of the episode (Tier-1 in production). */
  extract(episode: EpisodeRef): Promise<WireFact[]>;
  /** Roll episodes up into trait observations (the GraphRAG-style consolidation). */
  abstract(episode: EpisodeRef): Promise<WireObservation[]>;
};

export function registerFounderModelWritePath(engine: WorkflowEngine, deps: WritePathDeps): void {
  engine.register({
    id: WRITE_PATH_WORKFLOW_ID,
    trigger: { event: EPISODE_LOGGED_EVENT },
    handler: async (event, step) => {
      const episode: EpisodeRef = {
        episodeId: event.data.episodeId as string,
        founderId: event.data.founderId as string,
      };
      if (!episode.episodeId || !episode.founderId) {
        throw new Error(`${EPISODE_LOGGED_EVENT} requires episodeId and founderId`);
      }

      // §18.5: the event payload's founderId is untrusted input — it decides
      // the RLS scope every write below runs under. Prove it owns the episode
      // before anything else: under the claimed founder's scope, RLS makes a
      // foreign (or tombstoned, §6.16) episode invisible.
      await step.run("verify-episode", async () => {
        const visible = await deps.runScoped(
          episode.founderId,
          (trx) => trx<{ id: string }[]>`
            select id from episodes
            where id = ${episode.episodeId} and tombstoned_at is null`,
        );
        if (visible.length === 0) {
          throw new Error(
            `episode ${episode.episodeId} does not belong to founder ${episode.founderId}`,
          );
        }
        return true;
      });

      // Extract → Graph: superseded facts are invalidated, never deleted.
      const facts = await step.run("extract", () => deps.extract(episode));
      await step.run("write-graph", async () => {
        await deps.runScoped(episode.founderId, async (trx) => {
          for (const fact of facts) {
            await assertFact(trx, {
              ...fact,
              provenanceEpisodeIds: [...(fact.provenanceEpisodeIds ?? []), episode.episodeId],
            });
          }
        });
      });

      // Abstract → Traits, collecting reconciliation gates that fire (§6.7).
      const observations = await step.run("abstract", () => deps.abstract(episode));
      const flagged = await step.run("update-traits", async () => {
        const fires: { dimension: string; divergence: number }[] = [];
        await deps.runScoped(episode.founderId, async (trx) => {
          for (const observation of observations) {
            const result = await recordObservation(trx, {
              ...observation,
              provenanceEpisodeIds: [
                ...(observation.provenanceEpisodeIds ?? []),
                episode.episodeId,
              ],
            });
            if (result.reconciliation.fires) {
              fires.push({
                dimension: observation.dimension,
                divergence: result.reconciliation.divergence,
              });
            }
          }
        });
        return fires;
      });

      // Reconcile: divergence is a primary signal — surface it to the policy
      // as an internal event, deduped per episode+dimension.
      for (const flag of flagged) {
        await engine.send({
          name: RECONCILIATION_FLAGGED_EVENT,
          id: `${episode.episodeId}/${flag.dimension}`,
          data: {
            founderId: episode.founderId,
            episodeId: episode.episodeId,
            dimension: flag.dimension,
            divergence: flag.divergence,
          },
        });
      }
    },
  });
}
