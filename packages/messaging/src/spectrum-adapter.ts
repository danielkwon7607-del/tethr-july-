import type { ChannelPort } from "./channel-port";
import type { ChannelType } from "./identity";
import type { InboundStreamMessage } from "./runtime";

// The thin mapping between Spectrum's high-level SDK and our seams. The SDK
// surface used here is deliberately duck-typed (structural interfaces of
// exactly what we call): spectrum-ts is v9-published-this-week and its type
// packages churn; the seam we own must not. The real SDK objects satisfy
// these shapes; the adapter test pins the mapping with fakes; real-wire
// verification waits on a provisioned dedicated line (design premise 3).

type SpectrumSender = { id: string; kind?: string };
type SpectrumInbound = {
  id: string;
  platform: string;
  sender?: SpectrumSender;
  timestamp: Date;
  content: { type: string; text?: string };
};
export type SpectrumApp = {
  messages: AsyncIterable<[unknown, SpectrumInbound]>;
};

type SpectrumUser = unknown;
type SpectrumSpace = { send(text: string): Promise<{ id?: string } | undefined> };
export type SpectrumPlatformHandle = {
  user(address: string): Promise<SpectrumUser>;
  space: { create(user: SpectrumUser, options?: { phone?: string }): Promise<SpectrumSpace> };
  addresses?: {
    get?(address: string): Promise<{ services?: string[] }>;
    isIMessageAvailable?(address: string): Promise<boolean>;
  };
};

const PLATFORM_TO_CHANNEL: Record<string, ChannelType> = {
  imessage: "imessage",
  "whatsapp-business": "whatsapp",
  whatsapp: "whatsapp",
  sms: "sms",
  rcs: "rcs",
};

const normalizePlatform = (platform: string): ChannelType | null =>
  PLATFORM_TO_CHANNEL[platform.toLowerCase()] ?? null;

/** Map app.messages onto our inbound stream; skip our own sends and non-text. */
export async function* spectrumInboundStream(
  app: SpectrumApp,
): AsyncIterable<InboundStreamMessage> {
  for await (const [, message] of app.messages) {
    const channelType = normalizePlatform(message.platform);
    if (!channelType) continue;
    if (!message.sender || message.sender.kind === "agent") continue;
    if (message.content.type !== "text" || typeof message.content.text !== "string") continue;
    yield {
      channelType,
      address: message.sender.id,
      body: message.content.text,
      platformMessageId: message.id,
      timestamp: message.timestamp,
    };
  }
}

/**
 * ChannelPort over platform-narrowed Spectrum handles. The iMessage handle
 * carries sms/rcs too (green-bubble delivery on the same line); dedicated
 * per-founder lines pin conversations via `{ phone }` (§10.2).
 */
export function spectrumChannelPort(
  handles: { imessage?: SpectrumPlatformHandle; whatsapp?: SpectrumPlatformHandle },
  options?: { line?: string },
): ChannelPort {
  const handleFor = (channelType: ChannelType): SpectrumPlatformHandle => {
    const handle = channelType === "whatsapp" ? handles.whatsapp : handles.imessage;
    if (!handle) throw new Error(`no Spectrum provider configured for channel "${channelType}"`);
    return handle;
  };

  return {
    async send(request) {
      const handle = handleFor(request.channelType);
      const user = await handle.user(request.address);
      const space = await handle.space.create(
        user,
        options?.line ? { phone: options.line } : undefined,
      );
      // No clientGuid on the high-level SDK (design premise 4): the ledger
      // claim upstream is the double-send guarantee; the key rides here only
      // for adapters/SDKs that learn to forward it.
      const sent = await space.send(request.text);
      return { channelMessageId: sent?.id ?? null };
    },
    async detectServices(address) {
      const im = handles.imessage;
      if (im?.addresses?.get) {
        const info = await im.addresses.get(address);
        const services = (info.services ?? [])
          .map((service) => normalizePlatform(service))
          .filter((service): service is ChannelType => service !== null);
        if (services.length > 0) return services;
      }
      if (im?.addresses?.isIMessageAvailable) {
        const available = await im.addresses.isIMessageAvailable(address);
        return available ? ["imessage"] : ["sms"];
      }
      // No detection surface: assume the primary channel works and let the
      // ledgered send surface failures (§8.5).
      return ["imessage", "whatsapp", "sms", "rcs"];
    },
  };
}
