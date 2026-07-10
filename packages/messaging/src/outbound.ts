import type { ActionLedger } from "@tethr/core";
import { PgActionLedger } from "@tethr/db";
import {
  type ExternalActionResult,
  runExternalAction,
  type WorkflowEngine,
  type WorkflowStep,
} from "@tethr/orchestration";
import { CHANNEL_PREFERENCE, type ChannelPort } from "./channel-port";
import type { ChannelType } from "./identity";
import type { FounderScopedRunner } from "./runtime";
import { recordOutbound } from "./thread";

// Outbound sends, three durable steps (design D2, reviewed 3×):
//   1. select-channel — BEFORE any claim, so a flaky service-detection
//      lookup can never masquerade as an ambiguous send.
//   2. send — runExternalAction: claim + intent audit row precede dispatch
//      (§18.5.7); ambiguous outcomes hold the claim and degrade to asking.
//   3. record-thread-row — the founder-visible message row, written from the
//      memoized action result; `failed` is dormant vocabulary (the ledger's
//      failure row is the failure record).

export type OutboundDeps = {
  step: WorkflowStep;
  engine: WorkflowEngine;
  runScoped: FounderScopedRunner;
  port: ChannelPort;
  /** Test seam; production default is the founder-scoped Postgres ledger. */
  ledger?: ActionLedger;
};

export type OutboundRequest = {
  founderId: string;
  text: string;
  /**
   * Dedup id of the event that caused this send. The §18.5.7 key derives
   * from it, so workflow retries and event redelivery converge on one key.
   */
  initiatingEventId: string;
};

type ChannelSelection = {
  channelIdentityId: string;
  channelType: ChannelType;
  address: string;
};

export type SendOutcome = ExternalActionResult<{ channelMessageId: string | null }> & {
  messageId: string | null;
};

export async function sendFounderMessage(
  deps: OutboundDeps,
  request: OutboundRequest,
): Promise<SendOutcome> {
  const { step, engine, runScoped, port } = deps;
  const { founderId, text, initiatingEventId } = request;
  const idempotencyKey = `message.send/${founderId}/${initiatingEventId}`;

  // Ledger writes run under the founder's scope so the audit row carries its
  // founder linkage (§5.4); each call is one atomic scoped transaction.
  const ledger: ActionLedger = deps.ledger ?? {
    claimIntent: (actionType, key) =>
      runScoped(founderId, (trx) => new PgActionLedger(trx).claimIntent(actionType, key)),
    recordOutcome: (actionType, key, status, detail) =>
      runScoped(founderId, (trx) =>
        new PgActionLedger(trx).recordOutcome(actionType, key, status, detail),
      ),
    list: () => runScoped(founderId, (trx) => new PgActionLedger(trx).list()),
  };

  const selection = await step.run(`select-channel:${idempotencyKey}`, async () => {
    return runScoped(founderId, async (trx): Promise<ChannelSelection> => {
      const identities = await trx<
        { id: string; channel_type: ChannelType; address: string }[]
      >`select id, channel_type, address from channel_identities
        where verified_at is not null
        order by is_primary desc, created_at asc`;
      const primary = identities[0];
      if (!primary) throw new Error(`founder ${founderId} has no verified channel identity`);

      const services = await port.detectServices(primary.address);
      if (services.includes(primary.channel_type)) {
        return {
          channelIdentityId: primary.id,
          channelType: primary.channel_type,
          address: primary.address,
        };
      }

      // Fallback is tethr's routing decision (premise 1): remaining channels
      // in fixed preference order, excluding primary. A sibling identity on
      // an already-verified address inherits its verification (the
      // verification-inheritance rule, ADR 0009).
      for (const channelType of CHANNEL_PREFERENCE) {
        if (channelType === primary.channel_type || !services.includes(channelType)) continue;
        const sibling = identities.find(
          (identity) =>
            identity.channel_type === channelType && identity.address === primary.address,
        );
        if (sibling) {
          return { channelIdentityId: sibling.id, channelType, address: sibling.address };
        }
        const [created] = await trx<{ id: string }[]>`
          insert into channel_identities (channel_type, address, verified_at, is_primary)
          select ${channelType}, address, verified_at, false
          from channel_identities where id = ${primary.id}
          returning id`;
        return {
          channelIdentityId: (created as { id: string }).id,
          channelType,
          address: primary.address,
        };
      }
      throw new Error(
        `no reachable channel for founder ${founderId} (services: ${services.join(", ") || "none"})`,
      );
    });
  });

  const result = await runExternalAction<{ channelMessageId: string | null }>({
    step,
    ledger,
    engine,
    actionType: "message.send",
    idempotencyKey,
    dispatch: async (key) => {
      const sent = await port.send({
        channelType: selection.channelType,
        address: selection.address,
        text,
        idempotencyKey: key,
      });
      return { channelMessageId: sent.channelMessageId };
    },
  });

  // Duplicate = a prior run already sent AND already recorded its row; only
  // fresh outcomes write. Replay-after-crash memoizes into "executed" and
  // the on-conflict dedup makes the row write idempotent anyway.
  const messageId = await step.run(`record-thread-row:${idempotencyKey}`, async () => {
    if (result.outcome === "duplicate") return null;
    return runScoped(founderId, async (trx) => {
      const row = await recordOutbound(trx, {
        channelIdentityId: selection.channelIdentityId,
        body: text,
        status: result.outcome === "executed" ? "sent" : "pending",
        channelMessageId: result.outcome === "executed" ? result.value.channelMessageId : null,
      });
      return row.id;
    });
  });

  return { ...result, messageId };
}
