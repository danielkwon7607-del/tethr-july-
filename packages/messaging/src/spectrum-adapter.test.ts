import { describe, expect, it } from "vitest";
import { loadMessagingConfig } from "./config";
import type { InboundStreamMessage } from "./runtime";
import { type SpectrumApp, spectrumChannelPort, spectrumInboundStream } from "./spectrum-adapter";

// Pins the SDK↔seam mapping with fakes (design premise 3): platform
// normalization, own-send filtering, non-text filtering, line pinning, and
// service detection. Real-wire behavior waits on a provisioned line.

const inbound = (overrides: Record<string, unknown>) => ({
  id: "m-1",
  platform: "iMessage",
  sender: { id: "+15550001111" },
  timestamp: new Date("2026-07-08T12:00:00Z"),
  content: { type: "text", text: "hello" },
  ...overrides,
});

const appOf = (messages: ReturnType<typeof inbound>[]): SpectrumApp =>
  ({
    messages: (async function* () {
      for (const message of messages) yield [null, message];
    })(),
  }) as unknown as SpectrumApp;

const collect = async (app: SpectrumApp) => {
  const out: InboundStreamMessage[] = [];
  for await (const message of spectrumInboundStream(app)) out.push(message);
  return out;
};

describe("spectrum adapter", () => {
  it("maps platforms, skips agent echoes and non-text content", async () => {
    const app = appOf([
      inbound({}),
      inbound({ id: "m-2", platform: "whatsapp-business" }),
      inbound({ id: "m-3", sender: { id: "line", kind: "agent" } }), // our own send
      inbound({ id: "m-4", content: { type: "attachment" } }),
      inbound({ id: "m-5", platform: "slack" }), // channel outside §19.4
    ]);
    const messages = await collect(app);
    expect(messages.map((m) => [m.platformMessageId, m.channelType])).toEqual([
      ["m-1", "imessage"],
      ["m-2", "whatsapp"],
    ]);
    expect(messages[0]?.address).toBe("+15550001111");
  });

  it("sends through the platform handle, pinning the dedicated line", async () => {
    const calls: unknown[] = [];
    const port = spectrumChannelPort(
      {
        imessage: {
          user: async (address) => ({ address }),
          space: {
            create: async (_user, options) => {
              calls.push(options);
              return { send: async (text) => ({ id: `sent:${text}` }) };
            },
          },
        },
      },
      { line: "+15559990000" },
    );
    const result = await port.send({
      channelType: "sms",
      address: "+15550001111",
      text: "hi",
      idempotencyKey: "k-1",
    });
    expect(result.channelMessageId).toBe("sent:hi");
    expect(calls[0]).toEqual({ phone: "+15559990000" }); // per-founder line (§10.2)
  });

  it("detects services via addresses.get, falling back to the availability probe", async () => {
    const rich = spectrumChannelPort({
      imessage: {
        user: async () => ({}),
        space: { create: async () => ({ send: async () => undefined }) },
        addresses: { get: async () => ({ services: ["iMessage", "SMS"] }) },
      },
    });
    expect(await rich.detectServices("+1555")).toEqual(["imessage", "sms"]);

    const probeOnly = spectrumChannelPort({
      imessage: {
        user: async () => ({}),
        space: { create: async () => ({ send: async () => undefined }) },
        addresses: { isIMessageAvailable: async () => false },
      },
    });
    expect(await probeOnly.detectServices("+1555")).toEqual(["sms"]);
  });
});

describe("messaging config (§18.5.5 fail-fast)", () => {
  it("reads exactly PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET", () => {
    const config = loadMessagingConfig({
      PHOTON_PROJECT_ID: "proj_123",
      PHOTON_PROJECT_SECRET: "sec_456",
    });
    expect(config).toEqual({ projectId: "proj_123", projectSecret: "sec_456" });
  });

  it("refuses to start when either credential is missing", () => {
    expect(() => loadMessagingConfig({ PHOTON_PROJECT_ID: "proj_123" })).toThrow(
      /PHOTON_PROJECT_SECRET/,
    );
    expect(() => loadMessagingConfig({})).toThrow(/refusing to start/);
  });
});
