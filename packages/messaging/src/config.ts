import { z } from "zod";

// Photon issues a project ID and a project secret — not a single API key.
// The names below are exact (CEO instruction, Build 5); the runner fails
// fast on absence (§18.5.5) instead of starting half-configured.

const messagingConfigSchema = z.object({
  PHOTON_PROJECT_ID: z.string().min(1, "PHOTON_PROJECT_ID is required"),
  PHOTON_PROJECT_SECRET: z.string().min(1, "PHOTON_PROJECT_SECRET is required"),
});

export type MessagingConfig = { projectId: string; projectSecret: string };

export function loadMessagingConfig(env: Record<string, string | undefined>): MessagingConfig {
  const parsed = messagingConfigSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid messaging configuration — refusing to start: ${detail}`);
  }
  return {
    projectId: parsed.data.PHOTON_PROJECT_ID,
    projectSecret: parsed.data.PHOTON_PROJECT_SECRET,
  };
}
