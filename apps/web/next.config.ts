import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (one source of truth, no
  // per-package build step); Next transpiles them.
  transpilePackages: ["@tethr/core"],
};

export default nextConfig;
