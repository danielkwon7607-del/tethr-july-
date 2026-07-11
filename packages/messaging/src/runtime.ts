import { createHash } from "node:crypto";
import { runIrreversible } from "@tethr/core";
import { applyCorrection, EPISODE_LOGGED_EVENT, recordObservation } from "@tethr/founder-model";
import { sendInbound, type WorkflowEngine } from "@tethr/orchestration";
import type { Sql } from "postgres";
import type { ChannelPort, SendResult } from "./channel-port";
import { type EnvelopedContent, envelopeInbound } from "./envelope";
import { type ChannelType, resolveInbound } from "./identity";
import { extractOtpCode, type OtpConfig, verifyChannelOtp } from "./otp";
import { SystemActionLedger } from "./system-ledger";
import { recordInbound } from "./thread";

// The inbound half of the messaging runtime. One rule shapes it (§10.4):
// inbound handling is DECOUPLED from execution — its only side effects are
// rows and events. The write path, initiation, and sends all run as separate
// workflows the engine dispatches, so a founder reply never blocks, and is
// never blocked by, in-flight execution. Bodies stay in the database
// (§18.5.6): events carry ids, never content.

export const INBOUND_MESSAGE_EVENT = "messaging.inbound-message";
export const UNRECOGNIZED_INBOUND_EVENT = "messaging.unrecognized-inbound";
/** §18.5.7 action type for the one onboarding-link reply per unknown address. */
export const UNRECOGNIZED_REPLY_ACTION = "channel.onboarding-reply";
/** Sent once to an unrecognized sender; overridable per environment (real link). */
export const DEFAULT_ONBOARDING_REPLY =
  "This number isn't linked to a tethr account yet. Start here: https://tethr.to/start";

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
  /** Wired in production: enables the OTP-reply check (Ch 3) and the
   * unrecognized-inbound reply (Ch 10). Absent in unit contexts — the inbound
   * still resolves and drops, it just sends no code-check and no reply. */
  port?: ChannelPort;
  otp?: OtpConfig;
  /** Overrides the onboarding-link reply text (real link per environment). */
  onboardingReplyText?: string;
};

export async function handleInbound(
  deps: InboundDeps,
  message: InboundStreamMessage,
): Promise<void> {
  const resolved = await resolveInbound(deps.sql, message);

  // A known-but-UNVERIFIED channel (Ch 3 amendment, ADR 0012): this inbound is
  // an OTP reply. Extract the code and check it against the live challenge — a
  // match stamps verified_at atomically in the verify_channel_otp definer. The
  // body is NEVER stored (a pre-binding verification artifact, not a thread
  // message) and no unrecognized event fires: this is a known channel, not an
  // unrecognized sender. Without OTP config wired (unit contexts), it just
  // drops — an unverified channel still reaches no founder context (§18.5.2).
  if (resolved.kind === "unverified") {
    if (deps.otp) {
      const code = extractOtpCode(message.body);
      if (code) {
        await verifyChannelOtp(
          deps.sql,
          {
            channelType: message.channelType,
            address: message.address,
            channelIdentityId: resolved.channelIdentityId,
            code,
          },
          deps.otp,
        );
      }
    }
    return;
  }

  // An UNRECOGNIZED sender — no matching channel_identity (§18.5.2). Emit the
  // address-hash event (observability; never the raw address or body leaves the
  // trust boundary via a queue payload — §18.5.6) AND reply once with the
  // onboarding link, then discard: no messages row, no phantom founder (Ch 10
  // amendment). The raw address stays in-process for the reply — it is never
  // put in the event, preserving the ADR 0009 minimization.
  if (resolved.kind === "unknown") {
    await deps.engine.send({
      name: UNRECOGNIZED_INBOUND_EVENT,
      id: `unrecognized/${message.platformMessageId}`,
      data: {
        channelType: message.channelType,
        addressHash: createHash("sha256").update(message.address).digest("hex"),
      },
    });
    await replyToUnrecognized(deps, message);
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

/**
 * One onboarding-link reply per unrecognized address (Ch 10 amendment). §18.5.7
 * audit-before-dispatch and idempotency come from the system (founderless)
 * ledger keyed on the address hash — a repeat sender or a redelivered message
 * finds the claim taken and does not re-reply. No workflow step here, so the
 * ledger claim is the sole double-send guard (ADR 0009's posture). A no-op when
 * no channel port is wired (unit contexts): the event alone fired above.
 */
async function replyToUnrecognized(
  deps: InboundDeps,
  message: InboundStreamMessage,
): Promise<void> {
  if (!deps.port) return;
  const port = deps.port;
  const addressHash = createHash("sha256").update(message.address).digest("hex");
  // outcome "duplicate" (a repeat/redelivered sender) is the intended path — the
  // claim already replied once; runIrreversible short-circuits without a resend.
  await runIrreversible<SendResult>({
    actionType: UNRECOGNIZED_REPLY_ACTION,
    idempotencyKey: `${UNRECOGNIZED_REPLY_ACTION}/${addressHash}`,
    ledger: new SystemActionLedger(deps.sql),
    action: (key) =>
      port.send({
        channelType: message.channelType,
        address: message.address,
        text: deps.onboardingReplyText ?? DEFAULT_ONBOARDING_REPLY,
        idempotencyKey: key,
      }),
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
