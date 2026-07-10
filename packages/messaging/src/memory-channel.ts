import { DefiniteDispatchFailureError } from "@tethr/core";
import type { ChannelPort, SendRequest } from "./channel-port";
import type { ChannelType } from "./identity";

// Deterministic in-memory twin of the Spectrum adapter (design premise 3):
// acceptance tests run against this, not the vendor cloud. Failure injection
// covers the §18.5.7 failure taxonomy — definite (releases the claim) vs
// ambiguous (holds it).

export type MemoryChannel = {
  port: ChannelPort;
  sent: SendRequest[];
  failNext(detail: string, kind: "definite" | "ambiguous"): void;
};

export function createMemoryChannel(options?: {
  /** Per-address reachable services; default: every channel works. */
  services?: Record<string, ChannelType[]>;
}): MemoryChannel {
  const sent: SendRequest[] = [];
  let pendingFailure: { detail: string; kind: "definite" | "ambiguous" } | null = null;

  const port: ChannelPort = {
    async send(request) {
      if (pendingFailure) {
        const failure = pendingFailure;
        pendingFailure = null;
        if (failure.kind === "definite") throw new DefiniteDispatchFailureError(failure.detail);
        throw new Error(failure.detail);
      }
      sent.push(request);
      return { channelMessageId: `mem-${sent.length}` };
    },
    async detectServices(address) {
      return options?.services?.[address] ?? ["imessage", "whatsapp", "sms", "rcs"];
    },
  };

  return {
    port,
    sent,
    failNext(detail, kind) {
      pendingFailure = { detail, kind };
    },
  };
}
