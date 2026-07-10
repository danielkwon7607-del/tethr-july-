import { migrateUp, withFounderContext } from "@tethr/db";
import { applyCorrection, recordObservation } from "@tethr/founder-model";
import { InMemoryWorkflowEngine } from "@tethr/orchestration";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerDeliveryScan } from "./delivery";
import { resolveInbound } from "./identity";
import { INITIATION_TRIGGER_EVENT, registerInitiation } from "./initiation";
import { createMemoryChannel } from "./memory-channel";
import { sendFounderMessage } from "./outbound";
import { handleInbound, INBOUND_MESSAGE_EVENT, UNRECOGNIZED_INBOUND_EVENT } from "./runtime";
import { threadFor } from "./thread";

// Build 5 acceptance (ENGINEERING_OS §7, design doc 2026-07-07) against real
// Postgres: one thread across channels; dedup under redelivery; unverified
// identities never reach a founder; ledgered sends that cannot double-fire;
// fallback as a tethr routing decision; policy-driven initiation with the
// burnout veto measurably suppressing; cadence adjustments as trait signals.
// Own database (tethr_msg_test); serialized under TETHR_DATABASE_URL.
const adminUrl = process.env.TETHR_DATABASE_URL;

describe.skipIf(!adminUrl)("messaging substrate (requires TETHR_DATABASE_URL)", () => {
  let sql: Sql;
  let ada: string; // founder with imessage (primary, verified) + sms (verified)
  let zoe: string; // founder with an UNVERIFIED identity
  let bob: string; // founder with ONLY imessage — exercises sibling fallback
  const ADA_PHONE = "+15551230001";
  const ZOE_PHONE = "+15551230002";
  const BOB_PHONE = "+15551230003";
  const UNKNOWN_PHONE = "+15559999999";

  const asFounder = <T>(founderId: string, work: (trx: Sql) => Promise<T>) =>
    withFounderContext(sql, founderId, work);
  const runScoped = <T>(founderId: string, work: (trx: Sql) => Promise<T>) =>
    withFounderContext(sql, founderId, work);

  beforeAll(async () => {
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_msg_test");
    await admin.unsafe("create database tethr_msg_test");
    await admin.end();
    const url = new URL(adminUrl as string);
    url.pathname = "/tethr_msg_test";
    sql = postgres(url.href, { max: 1, onnotice: () => {} });
    await migrateUp(sql);

    const founder = async (name: string) => {
      const [row] = await sql<{ id: string }[]>`
        insert into founders (display_name) values (${name}) returning id`;
      return (row as { id: string }).id;
    };
    ada = await founder("Ada");
    zoe = await founder("Zoe");
    bob = await founder("Bob");
    await sql`insert into channel_identities (founder_id, channel_type, address, verified_at, is_primary)
      values (${ada}, 'imessage', ${ADA_PHONE}, now(), true),
             (${ada}, 'sms', ${ADA_PHONE}, now(), false),
             (${zoe}, 'imessage', ${ZOE_PHONE}, null, true),
             (${bob}, 'imessage', ${BOB_PHONE}, now(), true)`;
  });

  afterAll(async () => {
    await sql?.end();
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_msg_test");
    await admin.end();
  });

  it("the security-definer resolver answers pre-identification lookups; RLS still blinds scoped reads", async () => {
    // tethr_app, NO founder context: the RLS floor hides every identity row…
    const blind = await sql.begin(async (trx) => {
      await trx`set local role tethr_app`;
      return trx<{ id: string }[]>`select id from channel_identities`;
    });
    expect(blind).toHaveLength(0);
    // …but the enumerated resolver answers exactly one (channel, address).
    const resolved = await sql.begin(async (trx) => {
      await trx`set local role tethr_app`;
      return resolveInbound(trx as unknown as Sql, { channelType: "imessage", address: ADA_PHONE });
    });
    expect(resolved).toEqual(expect.objectContaining({ kind: "founder", founderId: ada }));
    const unverified = await sql.begin(async (trx) => {
      await trx`set local role tethr_app`;
      return resolveInbound(trx as unknown as Sql, { channelType: "imessage", address: ZOE_PHONE });
    });
    expect(unverified.kind).toBe("unverified");
    const unknown = await sql.begin(async (trx) => {
      await trx`set local role tethr_app`;
      return resolveInbound(trx as unknown as Sql, { channelType: "sms", address: UNKNOWN_PHONE });
    });
    expect(unknown.kind).toBe("unknown");
  });

  it("a founder moving across channels stays one thread; inbound feeds the memory harness", async () => {
    const engine = new InMemoryWorkflowEngine();
    const seen: string[] = [];
    engine.register({
      id: "test.inbound-listener",
      trigger: { event: INBOUND_MESSAGE_EVENT },
      handler: async (event) => {
        seen.push(event.data.messageId as string);
      },
    });
    const episodeEvents: string[] = [];
    engine.register({
      id: "test.episode-listener",
      trigger: { event: "founder.episode-logged" },
      handler: async (event) => {
        episodeEvents.push(event.data.episodeId as string);
      },
    });

    await handleInbound(
      { sql, engine, runScoped },
      {
        channelType: "imessage",
        address: ADA_PHONE,
        body: "kicking off over iMessage",
        platformMessageId: "pm-1",
        timestamp: new Date(),
      },
    );
    await handleInbound(
      { sql, engine, runScoped },
      {
        channelType: "sms",
        address: ADA_PHONE,
        body: "now replying from SMS",
        platformMessageId: "pm-2",
        timestamp: new Date(),
      },
    );

    const thread = await asFounder(ada, (trx) => threadFor(trx));
    expect(thread).toHaveLength(2);
    expect(thread.map((m) => m.body)).toEqual([
      "kicking off over iMessage",
      "now replying from SMS",
    ]);
    // Two different channel identities, one founder-keyed thread.
    expect(new Set(thread.map((m) => m.channelIdentityId)).size).toBe(2);
    expect(seen).toHaveLength(2);
    // The memory harness got both episodes (§6.5 write path consumes these).
    expect(episodeEvents).toHaveLength(2);
    const [episodes] = await asFounder(
      ada,
      (trx) => trx<{ n: number }[]>`select count(*)::int as n from episodes`,
    );
    expect(episodes?.n).toBe(2);
    // Inbound events carry ids, never bodies (§18.5.6: content stays in the DB).
    // (Enforced structurally: handleInbound emits { founderId, messageId, episodeId }.)
  });

  it("a redelivered platform message lands exactly once, and a crash between commit and emit heals", async () => {
    const engine = new InMemoryWorkflowEngine();
    let inboundEvents = 0;
    engine.register({
      id: "test.dedup-listener",
      trigger: { event: INBOUND_MESSAGE_EVENT },
      handler: async () => {
        inboundEvents += 1;
      },
    });
    const redelivered = {
      channelType: "imessage" as const,
      address: ADA_PHONE,
      body: "kicking off over iMessage",
      platformMessageId: "pm-1", // same platform id as the first test
      timestamp: new Date(),
    };
    // This engine never saw pm-1: the redelivery RE-EMITS with the same
    // stable event id — exactly what heals a crash between the rows
    // committing and the events going out. Delivered once…
    await handleInbound({ sql, engine, runScoped }, redelivered);
    expect(inboundEvents).toBe(1);
    // …and a second redelivery on the same engine dedups by event id.
    await handleInbound({ sql, engine, runScoped }, redelivered);
    expect(inboundEvents).toBe(1);

    const thread = await asFounder(ada, (trx) => threadFor(trx));
    expect(thread).toHaveLength(2); // no duplicate rows, ever
    const [episodes] = await asFounder(
      ada,
      (trx) => trx<{ n: number }[]>`select count(*)::int as n from episodes`,
    );
    expect(episodes?.n).toBe(2);
  });

  it("unverified and unknown addresses never reach a founder's context (§18.5.2)", async () => {
    const engine = new InMemoryWorkflowEngine();
    const unrecognized: { channelType: string; addressHash: string }[] = [];
    engine.register({
      id: "test.unrecognized-listener",
      trigger: { event: UNRECOGNIZED_INBOUND_EVENT },
      handler: async (event) => {
        unrecognized.push({
          channelType: event.data.channelType as string,
          addressHash: event.data.addressHash as string,
        });
        // The event must never carry the body OR the raw address (PII
        // minimization: payloads transit the workflow vendor).
        expect(event.data.body).toBeUndefined();
        expect(event.data.address).toBeUndefined();
        expect(event.data.addressHash).toMatch(/^[0-9a-f]{64}$/);
      },
    });

    await handleInbound(
      { sql, engine, runScoped },
      {
        channelType: "imessage",
        address: ZOE_PHONE, // exists but unverified
        body: "pretend I'm Zoe",
        platformMessageId: "pm-zoe-1",
        timestamp: new Date(),
      },
    );
    await handleInbound(
      { sql, engine, runScoped },
      {
        channelType: "sms",
        address: UNKNOWN_PHONE,
        body: "total stranger",
        platformMessageId: "pm-x-1",
        timestamp: new Date(),
      },
    );

    expect(unrecognized).toHaveLength(2);
    const [zoeMessages] = await asFounder(
      zoe,
      (trx) => trx<{ n: number }[]>`select count(*)::int as n from messages`,
    );
    expect(zoeMessages?.n).toBe(0);
  });

  it("no send without a claimed audit row; redelivery and retry cannot double-send (§18.5.7)", async () => {
    const engine = new InMemoryWorkflowEngine();
    const channel = createMemoryChannel();

    const send = () =>
      engine.send({
        name: "test.send-once",
        data: {},
      });
    let result: unknown;
    engine.register({
      id: "test.sender",
      trigger: { event: "test.send-once" },
      handler: async (_event, step) => {
        result = await sendFounderMessage(
          { step, engine, runScoped, port: channel.port },
          {
            founderId: ada,
            text: "your research verdict just landed",
            initiatingEventId: "evt-100",
          },
        );
      },
    });
    await send();
    expect(result).toEqual(expect.objectContaining({ outcome: "executed" }));
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.channelType).toBe("imessage"); // verified primary

    // The audit row precedes the dispatch and carries the founder linkage.
    const [ledgerRow] = await sql<{ status: string; founder_id: string }[]>`
      select status, founder_id from action_ledger
      where action_type = 'message.send' and idempotency_key like ${"%evt-100"}`;
    expect(ledgerRow?.status).toBe("executed");
    expect(ledgerRow?.founder_id).toBe(ada);

    // Same initiating event again (workflow redelivery): one send, one row.
    await send();
    expect(channel.sent).toHaveLength(1);
    const outbound = await asFounder(
      ada,
      (trx) => trx<{ status: string }[]>`
        select status from messages where direction = 'out'`,
    );
    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.status).toBe("sent");
  });

  it("fallback is tethr's routing decision: sibling identity inherits verification (design premise 1)", async () => {
    const engine = new InMemoryWorkflowEngine();
    // Bob's number is not reachable over iMessage right now — SMS only.
    const channel = createMemoryChannel({ services: { [BOB_PHONE]: ["sms"] } });
    engine.register({
      id: "test.fallback-sender",
      trigger: { event: "test.send-fallback" },
      handler: async (_event, step) => {
        await sendFounderMessage(
          { step, engine, runScoped, port: channel.port },
          { founderId: bob, text: "hello over the fallback", initiatingEventId: "evt-200" },
        );
      },
    });
    await engine.send({ name: "test.send-fallback", data: {} });

    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.channelType).toBe("sms");
    const identities = await asFounder(
      bob,
      (trx) => trx<{ channel_type: string; verified_at: Date | null }[]>`
        select channel_type, verified_at from channel_identities order by created_at`,
    );
    expect(identities).toHaveLength(2);
    expect(identities[1]?.channel_type).toBe("sms");
    expect(identities[1]?.verified_at).not.toBeNull(); // inherited
  });

  it("an ambiguous dispatch degrades to asking; the thread row stays pending (§8.5)", async () => {
    const engine = new InMemoryWorkflowEngine();
    const channel = createMemoryChannel();
    channel.failNext("provider timed out", "ambiguous");
    const reconciliations: string[] = [];
    engine.register({
      id: "test.reconciliation-listener",
      trigger: { event: "action.reconciliation-needed" },
      handler: async (event) => {
        reconciliations.push(event.data.idempotencyKey as string);
      },
    });
    let result: unknown;
    engine.register({
      id: "test.ambiguous-sender",
      trigger: { event: "test.send-ambiguous" },
      handler: async (_event, step) => {
        result = await sendFounderMessage(
          { step, engine, runScoped, port: channel.port },
          { founderId: ada, text: "did this go out?", initiatingEventId: "evt-300" },
        );
      },
    });
    await engine.send({ name: "test.send-ambiguous", data: {} });

    expect(result).toEqual(expect.objectContaining({ outcome: "needs-reconciliation" }));
    expect(reconciliations).toHaveLength(1);
    const pending = await asFounder(
      ada,
      (trx) => trx<{ status: string; body: string }[]>`
        select status, body from messages where direction = 'out' and body = 'did this go out?'`,
    );
    expect(pending[0]?.status).toBe("pending");
  });

  it("the delivery scan surfaces stale pending claims without double-asking", async () => {
    const engine = new InMemoryWorkflowEngine();
    const reconciliations: string[] = [];
    engine.register({
      id: "test.scan-listener",
      trigger: { event: "action.reconciliation-needed" },
      handler: async (event) => {
        reconciliations.push(event.data.idempotencyKey as string);
      },
    });
    // A workflow died mid-send yesterday: the claim is the surviving artifact.
    await sql`insert into action_ledger (founder_id, action_type, idempotency_key, status, created_at)
      values (${ada}, 'message.send', 'message.send/stale-1', 'pending', now() - interval '1 day')`;

    registerDeliveryScan(engine, { serviceSql: sql, olderThanMinutes: 30 });
    await engine.fireCron("messaging.delivery-scan");
    await engine.fireCron("messaging.delivery-scan"); // second sweep: same incident

    // Once, not twice: the reconciliation id is stable per (action, key).
    expect(reconciliations).toEqual(["message.send/stale-1"]);
  });

  it("an outbound nudge's timing, style, and cadence are a function of the intervention policy (§6.12)", async () => {
    // Ada responds to a hard push: corroborated accountability + cadence reads.
    await asFounder(ada, async (trx) => {
      await applyCorrection(trx, {
        family: "motivation_psychology",
        dimension: "accountability_responsiveness",
        estimate: 0.9,
        provenanceEpisodeIds: [],
      });
      await recordObservation(trx, {
        family: "motivation_psychology",
        dimension: "accountability_responsiveness",
        source: "revealed",
        estimate: 0.9,
        provenanceEpisodeIds: [],
      });
      await applyCorrection(trx, {
        family: "communication",
        dimension: "communication_cadence",
        estimate: 0.9,
        provenanceEpisodeIds: [],
      });
      await recordObservation(trx, {
        family: "communication",
        dimension: "communication_cadence",
        source: "revealed",
        estimate: 0.9,
        provenanceEpisodeIds: [],
      });
      // A confident working-rhythm read drives timing (sleep to the window).
      await applyCorrection(trx, {
        family: "capacity",
        dimension: "working_rhythm",
        estimate: 0.8,
        provenanceEpisodeIds: [],
      });
      await recordObservation(trx, {
        family: "capacity",
        dimension: "working_rhythm",
        source: "revealed",
        estimate: 0.8,
        provenanceEpisodeIds: [],
      });
    });

    const engine = new InMemoryWorkflowEngine();
    const channel = createMemoryChannel();
    registerInitiation(engine, {
      runScoped,
      port: channel.port,
      actionThreshold: 0.3,
      compose: async ({ behavior, intensity }) =>
        `[${behavior}/${intensity}] time to book those calls`,
    });

    await engine.send({
      name: INITIATION_TRIGGER_EVENT,
      id: "init-ada-1",
      data: { founderId: ada, reason: "reconciliation", dimension: "customer_contact_avoidance" },
    });

    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.text).toContain("nudge.hard"); // style from the policy
    // Timing came from the working-rhythm read: the workflow slept to the window.
    expect(engine.stepLog.some((step) => step.includes("wait-for-window"))).toBe(true);
    // The decision is instrumented (§6.16).
    const decisions = await asFounder(
      ada,
      (trx) => trx<{ behavior: string; decision: string }[]>`
        select behavior, decision from policy_decisions order by created_at desc limit 1`,
    );
    expect(decisions[0]).toEqual(
      expect.objectContaining({ behavior: "nudge.hard", decision: "act" }),
    );
  });

  it("the burnout veto measurably suppresses initiation under high load (§6.14/§6.15)", async () => {
    // Corroborate a high burnout read past the veto gate.
    await asFounder(ada, async (trx) => {
      await applyCorrection(trx, {
        family: "capacity",
        dimension: "load_burnout",
        estimate: 0.9,
        provenanceEpisodeIds: [],
      });
      await recordObservation(trx, {
        family: "capacity",
        dimension: "load_burnout",
        source: "revealed",
        estimate: 0.9,
        provenanceEpisodeIds: [],
      });
    });

    const engine = new InMemoryWorkflowEngine();
    const channel = createMemoryChannel();
    registerInitiation(engine, {
      runScoped,
      port: channel.port,
      actionThreshold: 0.3,
      compose: async ({ behavior, intensity }) => `[${behavior}/${intensity}] gentle check-in`,
    });
    await engine.send({
      name: INITIATION_TRIGGER_EVENT,
      id: "init-ada-2",
      data: { founderId: ada, reason: "reconciliation", dimension: "customer_contact_avoidance" },
    });

    // The hard, pace-increasing push is suppressed; what lands is gentle.
    const [latest] = await asFounder(
      ada,
      (trx) => trx<{ behavior: string; veto_applied: boolean }[]>`
        select behavior, veto_applied from policy_decisions order by created_at desc limit 1`,
    );
    expect(latest?.veto_applied).toBe(true);
    expect(latest?.behavior).toBe("checkin.gentle");
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.text).toContain("checkin.gentle");
  });

  it("a cadence adjustment in conversation changes subsequent initiation (§4.5)", async () => {
    const engine = new InMemoryWorkflowEngine();
    // The founder says, in words, to ease off — an explicit directive about
    // tethr's own behavior is a CORRECTION (w=1.0), per the design's rule.
    await handleInbound(
      {
        sql,
        engine,
        runScoped,
        cadenceParser: async (content) =>
          content.body.includes("ease off") ? { kind: "correction", estimate: 0.05 } : null,
      },
      {
        channelType: "imessage",
        address: ADA_PHONE,
        body: "please ease off this week, I'm slammed",
        platformMessageId: "pm-ease-1",
        timestamp: new Date(),
      },
    );

    const channel = createMemoryChannel();
    registerInitiation(engine, {
      runScoped,
      port: channel.port,
      actionThreshold: 0.3,
      compose: async ({ behavior, intensity }) => `[${behavior}/${intensity}]`,
    });
    await engine.send({
      name: INITIATION_TRIGGER_EVENT,
      id: "init-ada-3",
      data: { founderId: ada, reason: "reconciliation", dimension: "customer_contact_avoidance" },
    });

    // The cadence correction collapsed the contact scores: tethr holds back.
    expect(channel.sent).toHaveLength(0);
    const [latest] = await asFounder(
      ada,
      (trx) => trx<{ decision: string }[]>`
        select decision from policy_decisions order by created_at desc limit 1`,
    );
    expect(latest?.decision).toBe("ask");
  });

  it("inbound handling is decoupled from execution: it persists and emits, never executes work inline", async () => {
    // §10.4's execution-continuity property, stated structurally: the inbound
    // path's only side effects are rows and events. Downstream work (write
    // path, initiation, sends) happens in separate workflows the engine
    // dispatches — so a founder reply never blocks, and is never blocked by,
    // in-flight execution.
    const engine = new InMemoryWorkflowEngine();
    await handleInbound(
      { sql, engine, runScoped },
      {
        channelType: "imessage",
        address: ADA_PHONE,
        body: "structural decoupling check",
        platformMessageId: "pm-decouple-1",
        timestamp: new Date(),
      },
    );
    // No workflow steps ran inside handleInbound itself — only events queued.
    expect(engine.stepLog).toHaveLength(0);
  });
});

if (!adminUrl) {
  it("messaging suite SKIPPED — set TETHR_DATABASE_URL to run it", () => {
    expect(adminUrl).toBeUndefined();
  });
}
