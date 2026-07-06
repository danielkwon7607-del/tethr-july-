# tethr

The agentic AI cofounder. This repository is governed by written documents —
read them before touching code:

1. [EXECUTION.md](EXECUTION.md) — the bootloader every session starts from.
2. [docs/handbook/tethr-handbook.md](docs/handbook/tethr-handbook.md) — the product source of truth.
3. [DEVELOPER_CONSTITUTION.md](DEVELOPER_CONSTITUTION.md) — immutable engineering principles.
4. [CLAUDE.md](CLAUDE.md) — per-change coding behavior.
5. [ENGINEERING_OS.md](ENGINEERING_OS.md) — the operating manual: skills, roadmap, Definition of Done.

## Layout

- `apps/web` — Next.js 16 app shell (handbook Ch 4)
- `packages/core` — config schema + irreversible-action substrate (§18.3, Ch 5)
- `packages/model-router` — provider-agnostic LLM routing (Ch 20)
- `packages/orchestration` — durable-workflow abstraction, Inngest adapter (Ch 8, §18.3)
- `docs/decisions` — ADRs, mirrored into the handbook Decision Log (Ch 23)

## Commands

`npm install` (also wires the pre-commit hook) · `npm run ci` — typecheck,
lint, test, build (set `TETHR_ENV=local`) · `npm run dev -w @tethr/web`
