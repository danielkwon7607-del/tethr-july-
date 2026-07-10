import { migrateUp, withFounderContext } from "@tethr/db";
import { learnedWeight } from "@tethr/founder-model";
import type { TierRequest, TierRunner } from "@tethr/orchestration";
import { InMemoryWorkflowEngine } from "@tethr/orchestration";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInitiationCompose } from "./compose";
import { registerResponseLearning } from "./response-learning";
import { INBOUND_MESSAGE_EVENT } from "./runtime";
import { recordInbound } from "./thread";

// Build 6 (b): Tier-2 compose replaces the template, and a founder REPLY drives
// policy reweighting (§6.9 — delivery is not efficacy). Own scratch database.
const adminUrl = process.env.TETHR_DATABASE_URL;

describe("Tier-2 initiation compose", () => {
  it("composes through the Tier-2 runner and trims the result", async () => {
    const runner: TierRunner = {
      tier1: async () => ({ provider: "f", model: "t1", text: "" }),
      tier2: async (request: TierRequest) => ({
        provider: "f",
        model: "t2",
        text: `  msg for ${request.prompt.includes("nudge.hard") ? "hard" : "gentle"}  `,
      }),
    };
    const compose = createInitiationCompose(runner);
    expect(await compose({ founderId: "f", behavior: "nudge.hard", intensity: 3 })).toBe(
      "msg for hard",
    );
    expect(await compose({ founderId: "f", behavior: "checkin.gentle", intensity: 1 })).toBe(
      "msg for gentle",
    );
  });
});

describe.skipIf(!adminUrl)("response-driven reweighting (requires TETHR_DATABASE_URL)", () => {
  let sql: Sql;
  const runScoped = <T>(id: string, work: (trx: Sql) => Promise<T>): Promise<T> =>
    withFounderContext(sql, id, work);

  const seedFounder = async (): Promise<{ founderId: string; channelIdentityId: string }> => {
    const [founder] = await sql<{ id: string }[]>`
      insert into founders (display_name) values ('Response Founder') returning id`;
    const founderId = (founder as { id: string }).id;
    const channelIdentityId = await runScoped(founderId, async (trx) => {
      const [identity] = await trx<{ id: string }[]>`
        insert into channel_identities (channel_type, address, verified_at, is_primary)
        values ('imessage', ${`+${Math.random().toString().slice(2, 12)}`}, now(), true)
        returning id`;
      return (identity as { id: string }).id;
    });
    return { founderId, channelIdentityId };
  };

  beforeAll(async () => {
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_rl_test");
    await admin.unsafe("create database tethr_rl_test");
    await admin.end();
    const url = new URL(adminUrl as string);
    url.pathname = "/tethr_rl_test";
    sql = postgres(url.href, { max: 1, onnotice: () => {} });
    await migrateUp(sql);
  });

  afterAll(async () => {
    await sql?.end();
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_rl_test");
    await admin.end();
  });

  const fireReply = async (
    founderId: string,
    channelIdentityId: string,
    messageKey: string,
  ): Promise<void> => {
    const messageId = await runScoped(founderId, async (trx) => {
      const inbound = await recordInbound(trx, {
        channelIdentityId,
        body: "thanks, on it",
        channelMessageId: messageKey,
      });
      return inbound.id as string;
    });
    const engine = new InMemoryWorkflowEngine();
    registerResponseLearning(engine, { runScoped });
    await engine.send({
      name: INBOUND_MESSAGE_EVENT,
      id: messageKey,
      data: { founderId, messageId, episodeId: "e" },
    });
  };

  it("credits the acted initiation the founder replied to (learned weight rises)", async () => {
    const { founderId, channelIdentityId } = await seedFounder();
    // An initiation acted an hour ago AND its outbound was delivered ('sent')
    // 30 min ago — both before the reply, so the reply credits it.
    await runScoped(founderId, async (trx) => {
      await trx`
        insert into policy_decisions
          (behavior, base_fit, confidence_gate, learned_weight, score, decision, veto_applied, created_at)
        values ('checkin.gentle', 0.5, 0.6, 1.0, 0.3, 'act', false, now() - interval '1 hour')`;
      await trx`
        insert into messages (channel_identity_id, direction, body, status, created_at)
        values (${channelIdentityId}, 'out', 'a gentle check-in', 'sent', now() - interval '30 minutes')`;
    });

    await fireReply(founderId, channelIdentityId, "reply-1");

    const weight = await runScoped(founderId, (trx) => learnedWeight(trx, "checkin.gentle"));
    expect(weight).toBeGreaterThan(1.0); // ×1.15 positive
  });

  it("credits nothing when the initiation's send never landed (no delivered outbound)", async () => {
    const { founderId, channelIdentityId } = await seedFounder();
    // The policy acted, but the send failed/ambiguous — no 'sent' outbound row.
    // decideAndRecord logs 'act' BEFORE dispatch, so the act alone must not
    // credit: delivery is a precondition for efficacy (§6.9).
    await runScoped(founderId, async (trx) => {
      await trx`
        insert into policy_decisions
          (behavior, base_fit, confidence_gate, learned_weight, score, decision, veto_applied, created_at)
        values ('checkin.gentle', 0.5, 0.6, 1.0, 0.3, 'act', false, now() - interval '1 hour')`;
      await trx`
        insert into messages (channel_identity_id, direction, body, status, created_at)
        values (${channelIdentityId}, 'out', 'a gentle check-in', 'pending', now() - interval '30 minutes')`;
    });

    await fireReply(founderId, channelIdentityId, "reply-undelivered");

    const weight = await runScoped(founderId, (trx) => learnedWeight(trx, "checkin.gentle"));
    expect(weight).toBe(1.0); // untouched — an undelivered act is not efficacy
  });

  it("credits nothing when the reply follows only a HOLD (ask), not an act", async () => {
    const { founderId, channelIdentityId } = await seedFounder();
    await runScoped(founderId, async (trx) => {
      await trx`
        insert into policy_decisions
          (behavior, base_fit, confidence_gate, learned_weight, score, decision, veto_applied, created_at)
        values ('nudge.hard', 0.5, 0.1, 1.0, 0.05, 'ask', false, now() - interval '1 hour')`;
    });

    await fireReply(founderId, channelIdentityId, "reply-2");

    const weight = await runScoped(founderId, (trx) => learnedWeight(trx, "nudge.hard"));
    expect(weight).toBe(1.0); // untouched — a hold is not an efficacy signal
  });
});
