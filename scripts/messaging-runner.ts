import { Spectrum } from "@spectrum-ts/core";
import { imessage } from "@spectrum-ts/imessage";
import { loadConfig } from "@tethr/core";
import { createDbClient, requireDatabaseUrl, type Sql, withFounderContext } from "@tethr/db";
import {
  createMessagingRuntime,
  loadMessagingConfig,
  registerDeliveryScan,
  registerInitiation,
  registerResponseLearning,
  type SpectrumApp,
  type SpectrumPlatformHandle,
  spectrumChannelPort,
  spectrumInboundStream,
} from "@tethr/messaging";
import { InngestWorkflowEngine } from "@tethr/orchestration";
import { Inngest } from "inngest";

// The messaging runner (Build 5, design premise 2): the Spectrum gRPC stream
// is a long-lived connection, so inbound consumption is a persistent process
// — NOT a Vercel function, NOT an Inngest invocation. It fails fast on
// missing config (§18.5.5) and does exactly one job: consume the stream,
// persist + emit, let workflows do everything else.
//
// Run (node 22, no native TS — same receipt as verify-build-3):
//   npx esbuild scripts/messaging-runner.ts --bundle --platform=node \
//     --format=esm --packages=external \
//     --outfile=node_modules/.tethr/messaging-runner.mjs \
//   && node node_modules/.tethr/messaging-runner.mjs
//
// Deployment note (recorded ops open item): the initiation and delivery-scan
// WORKFLOWS registered here execute wherever the Inngest functions are
// served; this process emits their triggering events. Production placement
// joins the deploy-staging conversation.

async function main(): Promise<void> {
  loadConfig(process.env);
  const photon = loadMessagingConfig(process.env);
  const sql = createDbClient(requireDatabaseUrl(process.env));
  const runScoped = <T>(founderId: string, work: (trx: Sql) => Promise<T>): Promise<T> =>
    withFounderContext(sql, founderId, work);

  const app = (await Spectrum({
    projectId: photon.projectId,
    projectSecret: photon.projectSecret,
    providers: [imessage.config()],
  })) as unknown as SpectrumApp;
  const im = imessage(app as never) as unknown as SpectrumPlatformHandle;
  const port = spectrumChannelPort(
    { imessage: im },
    process.env.TETHR_PHOTON_LINE ? { line: process.env.TETHR_PHOTON_LINE } : undefined,
  );

  const engine = new InngestWorkflowEngine(new Inngest({ id: "tethr" }));
  registerDeliveryScan(engine, { serviceSql: sql });
  // §6.9: a founder reply credits the initiation it answered, so the policy
  // learns what lands (delivery is not efficacy). Pure DB work — no model.
  registerResponseLearning(engine, { runScoped });
  registerInitiation(engine, {
    runScoped,
    port,
    actionThreshold: Number(process.env.TETHR_ACTION_THRESHOLD ?? "0.3"),
    // Build 6 shipped Tier-2 `createInitiationCompose(tierRunner)` and the
    // model-backed write-path extractors `createModelExtractors(...)`, both
    // tested against fakes. Wiring a LIVE ModelRouter here needs a concrete AI
    // SDK provider binding (@ai-sdk/*) + keys and can only be exercised on a
    // deployed line — it joins the deploy-staging production-placement item
    // (ADR 0009). Until then the runner keeps the template compose.
    compose: async ({ behavior }) =>
      behavior === "nudge.hard"
        ? "You said customer calls were this week's priority — want me to line two up for tomorrow?"
        : "Quick check-in: anything blocking you that I can take off your plate?",
  });

  const runtime = createMessagingRuntime({
    sql,
    engine,
    runScoped,
    stream: spectrumInboundStream(app),
    onError: (error, message) => {
      console.error("inbound handling failed", {
        platformMessageId: message.platformMessageId,
        channelType: message.channelType,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
  await runtime.start();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
