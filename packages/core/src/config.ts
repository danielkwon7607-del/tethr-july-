import { z } from "zod";

// Three environments with boot-time parity (ENGINEERING_OS §6): a process with a
// missing or mis-scoped TETHR_ENV must fail to start, not run with a guess —
// the product takes irreversible real-world actions (Constitution IX, X).
const configSchema = z.object({
  TETHR_ENV: z.enum(["local", "staging", "production"], {
    errorMap: () => ({
      message: "TETHR_ENV must be one of: local, staging, production",
    }),
  }),
});

export type AppEnv = z.infer<typeof configSchema>["TETHR_ENV"];

export type Config = {
  appEnv: AppEnv;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid configuration — refusing to start: ${detail}`);
  }
  return { appEnv: parsed.data.TETHR_ENV };
}
