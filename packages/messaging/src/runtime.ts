import { createHash } from "node:crypto";
import { applyCorrection, EPISODE_LOGGED_EVENT, recordObservation } from "@tethr/founder-model";
import { sendInbound, type WorkflowEngine } from "@tethr/orchestration";
import type { Sql } from "postgres";
import { type EnvelopedContent, envelopeInbound } from "./envelope";
import { type ChannelType, resolveInbound } from "./identity";
import { recordInbound } from "./thread";

// The inbound half of the messaging runtime. One rule shapes it (§10.4):
// inbound handling is DECOUPLED from execution — its only side effects are
// rows and events. The write path, initiation, and sends all run as separate
// workflows the engine dispatches, so a founder reply never blocks, and is
// never blocked by, in-flight execution. Bodies stay in the database
// (§18.5.6): events carry ids, never content.

export const INBOUND_MESSAGE_EVENT = "messaging.inbound-message";
export const UNRECOGNIZED_INBOUND_EVENT = "messaging.unrecognized-inbound";

export type InboundStreamMessage = {
  channelType: ChannelType;
  address: string;
  body: string;
  /** Platform-assigned id — the dedup key end to end (§19.4). */
  platformMessageId: string;
  timestamp: Date;
};

/**
 * §4.5 cadence adjustments, parsed from inbound text (Tier-1 in production,
 * injected and deterministic in tests). The weight rule is load-bearing: an
 * explicit directive about tethr's own behavior ("ease off this week") is a
 * CORRECTION (w=1.0); an offhand mention of being busy is STATED (w=0.4),
 * deliberately too weak alone to move pacing.
 */
export type CadenceSignal = { kind: "correction" | "stated"; estimate: number } | null;
/** Takes EnvelopedContent, not string: the §18.5.6 brand gates this call
 * site too — a Tier-1 parser cannot be handed raw founder text. */
export type CadenceParser = (content: EnvelopedContent) => Promise<CadenceSignal>;

export type FounderScopedRunner = <T>(
  founderId: string,
  work: (trx: Sql) => Promise<T>,
) => Promise<T>;

export type InboundDeps = {
  sql: Sql;
  engine: WorkflowEngine;
  runScoped: FounderScopedRunner;
  cadenceParser?: CadenceParser;
};

export async function handleInbound(
  deps: InboundDeps,
  message: InboundStreamMessage,
): Promise<void> {
  const resolved = await resolveInbound(deps.sql, message);

  // §18.5.2: unverified or unknown addresses never reach a founder's
  // context. Neither the body NOR the raw address leaves the trust boundary
  // (event payloads transit the workflow vendor): the event carries a hash,
  // which Build 6's onboarding linkage can re-derive from a candidate
  // address to correlate (§18.5.6 minimization).
  if (resolved.kind !== "founder") {
    await deps.engine.send({
      name: UNRECOGNIZED_INBOUND_EVENT,
      id: `unrecognized/${message.platformMessageId}`,
      data: {
        channelType: message.channelType,
        addressHash: createHash("sha256").update(message.address).digest("hex"),
      },
    });
    return;
  }

  const persisted = await deps.runScoped(resolved.founderId, async (trx) => {
    const inbound = await recordInbound(trx, {
      channelIdentityId: resolved.channelIdentityId,
      body: message.body,
      channelMessageId: message.platformMessageId,
    });
    if (inbound.duplicate) {
      // Redelivery after the rows committed. The crash window this heals: a
      // death BETWEEN the commit and the event sends below would otherwise
      // lose the events forever (the early return used to eat them). The
      // event ids are stable, so re-emitting is a no-op when the first
      // delivery got through — the engine's id-dedup collapses it.
      const [existing] = await trx<{ id: string }[]>`
        select id from messages
        where channel_identity_id = ${resolved.channelIdentityId}
          and channel_message_id = ${message.platformMessageId}`;
      const [episode] = await trx<{ id: string }[]>`
        select id from episodes
        where kind = 'message' and content->>'platformMessageId' = ${message.platformMessageId}`;
      if (!existing || !episode) return null; // row vanished (deletion): drop
      return { messageId: existing.id, episodeId: episode.id };
    }

    // Episodes are the raw, append-only ground truth (§6.2); this is how
    // messaging feeds the memory harness without being a dumb pipe.
    const [episode] = await trx<{ id: string }[]>`
      insert into episodes (kind, content, occurred_at)
      values ('message', ${trx.json({
        channelType: message.channelType,
        direction: "in",
        body: message.body,
        platformMessageId: message.platformMessageId,
      })}, ${message.timestamp})
      returning id`;
    const episodeId = (episode as { id: string }).id;

    if (deps.cadenceParser) {
      const signal = await deps.cadenceParser(envelopeInbound(message.channelType, message.body));
      if (signal) {
        const write = {
          family: "communication" as const,
          dimension: "communication_cadence",
          estimate: signal.estimate,
          provenanceEpisodeIds: [episodeId],
        };
        if (signal.kind === "correction") await applyCorrection(trx, write);
        else await recordObservation(trx, { ...write, source: "stated" });
      }
    }

    return { messageId: inbound.id as string, episodeId };
  });

  if (!persisted) return; // rows gone (deletion raced the redelivery): drop

  await deps.engine.send({
    name: EPISODE_LOGGED_EVENT,
    id: `episode/${persisted.episodeId}`,
    data: { founderId: resolved.founderId, episodeId: persisted.episodeId },
  });
  await sendInbound(deps.engine, {
    name: INBOUND_MESSAGE_EVENT,
    id: message.platformMessageId,
    data: {
      founderId: resolved.founderId,
      messageId: persisted.messageId,
      episodeId: persisted.episodeId,
    },
  });
}

/** Consume an inbound stream until it ends; per-message errors are isolated. */
export function createMessagingRuntime(
  deps: InboundDeps & {
    stream: AsyncIterable<InboundStreamMessage>;
    onError?: (error: unknown, message: InboundStreamMessage) => void;
  },
): { start(): Promise<void> } {
  return {
    async start() {
      for await (const message of deps.stream) {
        try {
          await handleInbound(deps, message);
        } catch (error) {
          // One poisoned message must not stop the founder's line.
          deps.onError?.(error, message);
        }
      }
    },
  };
}
