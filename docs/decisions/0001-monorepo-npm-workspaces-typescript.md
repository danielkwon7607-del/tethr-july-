# ADR-0001 — Single TypeScript monorepo on npm workspaces

**Date:** 2026-07-06 · **Status:** accepted · **Build:** 0

## Decision
One repository, npm workspaces, TypeScript end-to-end, packages by owning-system
boundary (`apps/web`, `packages/{core,model-router,orchestration}`, growing to the
ENGINEERING_OS §6 layout as builds land). Workspace packages export TypeScript
source directly (`main: ./src/index.ts`); Next transpiles them via
`transpilePackages`, Vitest consumes them natively, so there is no per-package
build step. Module resolution is `bundler` with extensionless relative imports,
because every consumer (Next/Turbopack, Vitest) is a bundler-class resolver —
NodeNext `.js`-suffixed imports broke Turbopack transpilation of source packages.

## Rationale
Canonical objects flow across every subsystem; a monorepo keeps them in one
source of truth (Constitution VII) and lands a change and its tests atomically.
npm workspaces over pnpm: npm is already the installed toolchain — no new tool
for the same capability (Constitution III).

## Rejected
- pnpm/turborepo: added tooling without a present need; revisit if install/build
  times hurt.
- Per-package `dist` builds: a build step and version skew for zero current
  benefit.
