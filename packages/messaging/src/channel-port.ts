import type { ChannelType } from "./identity";

// The vendor seam. Everything channel-shaped goes through this port: the
// Spectrum adapter implements it for real wires, the in-memory channel for
// tests. Fallback is tethr's routing decision (design premise 1), so service
// detection is part of the port, not hidden inside the vendor SDK.

export type SendRequest = {
  channelType: ChannelType;
  address: string;
  text: string;
  /**
   * The §18.5.7 ledger key. The high-level Spectrum SDK cannot forward it
   * (no clientGuid on Space.send — verified against @spectrum-ts/core@9);
   * adapters that CAN forward it must.
   */
  idempotencyKey: string;
};

export type SendResult = { channelMessageId: string | null };

export type ChannelPort = {
  send(request: SendRequest): Promise<SendResult>;
  /** Which services can reach this address right now (live vendor lookup). */
  detectServices(address: string): Promise<ChannelType[]>;
};

/** Fixed fallback preference, primary excluded by the caller (design D2). */
export const CHANNEL_PREFERENCE: readonly ChannelType[] = ["imessage", "whatsapp", "sms", "rcs"];
