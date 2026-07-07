import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    // Integration suites share one Postgres cluster (db.test.ts recreates the
    // public schema; grounding.test.ts manages its own database but grants to
    // the cluster-global tethr_app role) — interleaving them races. Unit-only
    // runs stay parallel.
    fileParallelism: !process.env.TETHR_DATABASE_URL,
  },
});
