# ADR-0004 — Biome (format+lint) and Vitest (single test runner)

**Date:** 2026-07-06 · **Status:** accepted · **Build:** 0

## Decision
Biome is the single opinionated formatter and linter; Vitest is the one test
runner across the monorepo. Both run in the versioned pre-commit hook
(`scripts/githooks`, wired by `npm run prepare` → `core.hooksPath`) and in CI.

## Rationale
ENGINEERING_OS §6 requires one zero-config formatter+linter so review attention
goes to logic, not whitespace; Biome is one dependency where ESLint+Prettier
are two-plus-glue. One test runner keeps the red/green loop fast and uniform
(Constitution XI). The hook lives in the repo, not in `.git/hooks`, so the gate
is versioned and needs no husky dependency.

## Rejected
- ESLint + Prettier: two tools and config surface for the same outcome.
- husky/lint-staged: a dependency to do what `core.hooksPath` does natively.
