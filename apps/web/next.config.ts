import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (one source of truth, no
  // per-package build step); Next transpiles them.
  transpilePackages: [
    "@tethr/core",
    "@tethr/db",
    "@tethr/founder-model",
    "@tethr/messaging",
    "@tethr/orchestration",
  ],
  // Server-only drivers stay external to the bundle: they use node builtins
  // and runtime file access that bundling would break.
  serverExternalPackages: ["postgres", "inngest"],
};

export default nextConfig;
