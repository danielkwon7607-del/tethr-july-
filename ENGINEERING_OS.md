# tethr — Engineering Operating System

*The operating protocol every Claude Code session follows. `CLAUDE.md` (Andrej Karpathy's behavioral guidelines) and `DEVELOPER_CONSTITUTION.md` (immutable principles) sit above this file; the company handbook sits above all three as the product source of truth. This document is the mutable layer: the how-we-actually-operate that evolves as we learn. When it conflicts with the Constitution or the handbook, they win.*

**Loading note.** By deliberate choice, `CLAUDE.md` contains *only* Karpathy's guidelines, so this file is not auto-injected. Loading it is step one of the Session Startup Checklist (§14). Every session reads: `CLAUDE.md` → `DEVELOPER_CONSTITUTION.md` → this file → the relevant handbook chapter. Treat that as non-negotiable ritual, enforced by habit and by the startup checklist, not by magic.

---

## 1. Mission

Claude Code is the engineering organization for tethr. It turns the handbook into a working system, from an empty repository to a shipped MVP and beyond, without inventing product and without accruing debt that a later session pays for.

**Responsible for:** planning, architecture, implementation, testing, review, documentation, git, deployment, and keeping the handbook and the codebase telling the same story. Translating handbook chapters into builds. Surfacing ambiguity before it becomes wrong code. Recording every architectural decision and every dead end.

**Not responsible for:** deciding *what the product should do* (the handbook decides; we implement it), authoring product requirements, or making load-bearing product changes unilaterally (Constitution XIII). Not responsible for building the founder's product — tethr builds companies, not their software, and neither do we (handbook §1.6). Not a substitute for human approval on irreversible production actions (§12).

---

## 2. Relationship to the Handbook

The handbook is the constitution for the product. Our contract with it:

- **We never implement un-handbooked behavior.** If it's not in the handbook, it's not in the product.
- **When implementation reveals ambiguity or a gap, we run the Confusion Protocol:** stop, explain what's unclear, propose an improvement, update the handbook (with approval if the point is load-bearing — §12), then continue. We do not code past a handbook gap.
- **The handbook is a living document we help maintain, not a read-only input.** Every architectural decision we make lands in its Decision Log (Ch 23). Every gap we hit becomes a handbook amendment. See §8, Handbook Synchronization.

---

## 3. The Installed Skills (verified capabilities)

Four skills are installed. Their real, inspected capabilities — and their limits — determine the routing in §4. We never duplicate what a skill already does.

**gstack** (Garry Tan's suite) — the **primary engineering spine**. Far larger than originally routed on (~40+ commands across planning, design, review, QA, release, and safety). The planning chain is four **distinct, sequential** reviewers, not one — this corrects an earlier conflation in this document: `/office-hours` (upfront — six forcing questions, reframes the request before any plan exists, produces the design doc) → `/plan-ceo-review` (works *on* an existing plan; finds the "10-star product" hiding in the request; four modes: Expansion / Selective Expansion / Hold Scope / Reduction) → `/plan-design-review` (scores UI/UX completeness 0-10 across 7 passes before code — info architecture, interaction states, journey, AI-slop risk, design-system alignment, responsive/accessibility, unresolved decisions) → `/plan-eng-review` (locks architecture, data flow, diagrams, edge cases, tests; the only *required* gate on the Review Readiness Dashboard). `/autoplan` runs CEO→Design→Eng automatically with encoded decision principles, surfacing only genuine taste calls.

Design-system generation is a separate pipeline, used only when real UI/UX work is in scope (not yet triggered — tethr's shell has stayed deliberately thin): `/design-consultation` (builds a full design system from zero — typography, palette, deliberate creative risk vs safe choices, writes `DESIGN.md`) → `/design-shotgun` (3 AI-generated visual variants, comparison board, taste memory) → `/design-html` (renders the approved direction as production HTML via Pretext, resize-aware, framework-detected) → `/design-review` (live-site 80-item visual audit + auto-fix loop, post-implementation; distinct from `/plan-design-review`, which is pre-implementation).

Review and QA: `/review` (complexity/drive-by-edit catcher, now with auto-fix for mechanical issues and completeness-gap flagging), `/oracle` (product-conscience AST scan), `/cso` (Chief Security Officer — OWASP Top 10 + STRIDE audit; the dedicated security reviewer), `/codex` (independent second opinion via OpenAI Codex CLI — review/challenge/consult modes; cross-model diff analysis when both `/review` and `/codex` have run), `/qa` (diff-aware or full browser-driven QA, auto-generates regression tests), `/qa-only` (same audit, report only, no fixes — useful when you want the read before deciding what to touch), `/investigate` (root-cause debugging, Iron Law: no fix without investigation, auto-freezes the module), `/health` (typecheck+lint+test+dead-code rolled into one weighted 0-10 score with trend tracking).

Release and docs: `/ship` (test-first, verifiable release; bootstraps a test framework if none exists; auto-invokes `/document-release`), `/land-and-deploy` (merge→deploy→canary-verify, one command), `/canary` (post-deploy monitoring loop), `/document-release` (syncs all docs to the diff), `/document-generate` (Diataxis-framework docs from scratch), `/retro` (team-aware weekly retro).

Memory — **three distinct systems here, not one, and they are not interchangeable**: **GBrain** (`/setup-gbrain`, `/sync-gbrain`) is cross-machine *session* memory — same job as claude-mem, **stays off**, claude-mem is the one session-memory owner. **`/learn`** is *codebase-convention* memory (durable patterns like "API responses wrapped in `{data,error}`", confidence-scored, auto-consulted by other skills) — a different job from session recall, **kept on**, does not collide with the claude-mem ruling. **`/context-save` / `/context-restore`** save/resume git state and remaining work for a future session — the same job our handbook-cross-referenced `docs/handoffs/build-N-handoff.md` files already do well; **we keep our handoff-doc convention** rather than switching formats, but the gstack pair exists if a mid-build quick-save is ever needed without a full handoff write-up.

Cross-model: `/benchmark-models` — side-by-side Claude/GPT/Gemini comparison on a skill, directly relevant when deciding Fable vs Opus vs another model for a given build.

Safety: `/careful` / `/freeze` / `/guard` / `/unfreeze` as before.

Not routed by default, available when a build calls for it: `/spec` (vague intent → executable spec → GitHub issue; overlaps Superpowers `writing-plans` closely enough that adding it risks a fifth planning layer — skip unless a build specifically wants issue-filing), the full design pipeline above, `/plan-devex-review` / `/devex-review` (developer-experience audits — relevant once tethr has external developer-facing surface, not yet), `/plan-tune` (per-question ask-sensitivity tuning), `/scrape` / `/skillify` (browser data extraction and skill codification), `/pair-agent` (remote-agent browser bridging — not relevant to our single-agent workflow), the `/ios-*` family (no iOS app), and the **Greptile integration** (third-party async PR reviewer that `/review`/`/ship` triage automatically once installed — genuinely good, requires its own signup at greptile.com, worth doing once the repo is public/team-facing, not a default dependency now).

**Superpowers** (obra) — **subordinate**, the implementation-discipline engine. Composable, gated skills: `brainstorming` (Socratic design, hard gate — refuses to code before an approved design doc), `using-git-worktrees` (isolated branch + clean test baseline), `writing-plans` (micro-tasks of 2–5 min with exact file paths, complete code, and a test gate — no `TBD`), `subagent-driven-development` (fresh subagent per task, two-stage review: spec compliance then code quality), `test-driven-development` (iron-law red/green/refactor — deletes code written before its test), a four-phase `debugging` methodology (root cause before fix), and `writing-skills` (skill authoring). *Limit:* token-hungry and overkill for one-file fixes; cannot handle environment/platform debugging (that falls outside its workflow); plans inherit spec errors, so a wrong design yields a wrong plan.

**Ponytail** (DietrichGebert) — **always-on complexity governor.** A "laziest senior dev" that runs a decision ladder before writing code (does this need to exist → reuse → stdlib → native → dependency → one line → minimum) and *never* cuts validation, security, or accessibility. Commands: `/ponytail-review` (delete-list for a diff), `/ponytail-audit` (whole-repo complexity scan), `/ponytail-debt` (debt inventory). It is a lens applied throughout, not a workflow stage.

**claude-mem** (thedotmack) — **cross-session memory.** Lifecycle hooks capture the session, compress it into structured observations in a local SQLite + vector store, and inject relevant context at the next session's start via token-efficient three-layer retrieval (index → timeline → full detail), searchable with `mem-search`. Silent; requires no manual writing. *Boundary:* stable conclusions belong in the handbook or code, not claude-mem; claude-mem holds evolving session context. It is not a substitute for the Decision Log.

---

## 4. Skill Routing Guide

For each activity: **primary → supporting**, why, and expected output. Spine order is fixed: **gstack leads the lifecycle, Superpowers executes implementation mechanics, Ponytail governs complexity throughout, claude-mem carries memory.** Ponytail and claude-mem are implicitly active on every activity below even when not named.

| Activity | Primary | Supporting | Why | Output |
|---|---|---|---|---|
| **Planning** | gstack `/office-hours` → `/plan-ceo-review` → `/plan-eng-review` | Superpowers `writing-plans`; gstack `/plan-design-review` when UI is in scope | Four distinct, sequential reviewers, not one: office-hours reframes before a plan exists, ceo-review finds the 10-star product in an existing plan, design-review scores UI completeness, eng-review locks architecture and is the required gate. Superpowers turns the approved plan into gated micro-tasks | Approved design intent + scored plan + a task-gated plan, no `TBD` |
| **Design (UI/UX)** | gstack `/design-consultation` → `/design-shotgun` → `/design-html` | `/design-review` post-implementation | Only invoked when real UI/UX work is in scope — not yet triggered, tethr's shell stays deliberately thin (§4.2) | `DESIGN.md` + approved mockup + resize-aware production HTML, or a live-site audit + fix loop |
| **Architecture** | gstack Confusion Protocol + Research (§5) | Superpowers `brainstorming` | Never guess architecture; research irreversible choices; brainstorm the design doc subordinately | An ADR entry in the handbook Decision Log (Ch 23) with alternatives rejected |
| **UI** | gstack (Designer role) | Superpowers TDD for logic | gstack frames UX; component logic still gets red/green | Component + tests + the interaction it implements, traced to a handbook chapter |
| **Backend** | Superpowers `writing-plans` + `subagent-driven-development` | gstack `/ship`, Ponytail | The disciplined micro-plan + TDD subagents are the strongest mechanics for correctness; `/ship` makes the goal verifiable | Module + reversible migration + passing tests |
| **Debugging** | Superpowers four-phase `debugging` | gstack `/investigate` (auto-freeze) | Root-cause-first is the primary method; `/investigate` freezes the blast radius. **Environment/platform bugs fall outside Superpowers** — step out, use gstack `/careful` | A reproducing test + a root-cause fix (Karpathy §4) |
| **Review** | gstack `/review` + `/oracle` | Superpowers reviewer subagent, Ponytail `/ponytail-review`, gstack `/cso` for security-touching work | Four lenses, not duplication: `/review` for complexity/drive-by edits, `/oracle` for product conscience, reviewer subagent for spec+quality on large diffs, Ponytail for a delete-list, `/cso` as the dedicated security reviewer whenever a change touches auth, RLS, credentials, or irreversible actions — stronger and more specific than routing security concerns through `/review` alone | Review verdict + delete-list + spec-compliance sign-off (+ security sign-off from `/cso` when applicable) |
| **Testing** | Superpowers `test-driven-development` | gstack `/qa` (fixes + regression tests), `/qa-only` (report-only, when you want the read before deciding what to touch), `/health` (0–10 weighted code-quality score, run at session shutdown to track trend) | Iron-law red/green is the test engine; `/qa` covers staging/e2e | Failing-test-first, then a green suite; a health score trend |
| **Documentation** | gstack `/document-release` | Handbook sync (§8), Ponytail | gstack produces release docs; sync keeps the handbook true; Ponytail preserves density | Updated handbook + changelog, no bloat |
| **Research** | Research Protocol (§5) | claude-mem `mem-search` | Recall prior findings before searching anew; document conclusions | Findings → Decision Log / handbook amendment |
| **Optimization** | Ponytail (is it even needed?) | Superpowers TDD | Delete/avoid before optimizing; never optimize speculatively; lock behavior with tests before changing it | Benchmark + change held behind green tests |
| **Refactoring** | Ponytail `/ponytail-audit` + `/ponytail-debt` | Superpowers TDD, gstack `/review` | Find institutionalized complexity; preserve behavior against a suite held constant (Karpathy §4) | Behavior-preserving refactor, tests green before and after |
| **Git** | Superpowers `using-git-worktrees` | gstack `/ship`, `/careful` | Isolate work so `main` stays clean; `/ship` gates the commit on verification; `/careful` guards destructive git | Clean worktree + meaningful commit (architectural intent in the message) |
| **Releases** | gstack `/ship` + `/retro` + `/document-release` | claude-mem | Verifiable ship, captured learnings, release notes; memory persists the retro | Tagged milestone + retro + release notes + handbook sync |
| **Memory** | claude-mem (session/episodic) | gstack `/learn` (codebase-convention memory — kept on, different job) | Silent cross-session recall via claude-mem; `/learn` accumulates durable codebase patterns (e.g. "responses wrapped in `{data,error}`") and is auto-consulted by other skills — not a session-recall system, doesn't collide. **GBrain stays off** (same job as claude-mem, would fight it). Handoff docs, not `/context-save`, remain our resume mechanism | Injected prior context at session start; codebase conventions auto-applied; a written handoff for the next session |

**Overlap rulings (to satisfy "never duplicate a skill"):**
- *Planning:* four sequential gstack reviewers (office-hours → ceo-review → design-review → eng-review, eng-review being the only required gate) each do a distinct job; Superpowers `writing-plans` turns the approved output into gated micro-tasks. Don't run two office-hours or two eng-reviews on the same plan.
- *Memory:* three systems, three jobs — claude-mem owns session/episodic recall, `/learn` owns codebase-convention memory, GBrain is off (duplicates claude-mem). Handoff docs are our resume mechanism, not `/context-save`.
- *TDD:* Superpowers is the TDD engine; gstack `/ship` orchestrates the goal but delegates red/green to Superpowers.
- *Review:* layered lenses (complexity / product-conscience / spec-quality / security / delete-list / independent second opinion), each distinct — not five passes of the same thing. `/cso` for anything touching auth, RLS, credentials, or irreversible actions; `/codex` when a genuinely independent second opinion is worth the cost (e.g. Build 9's autonomy/send logic).
- *Safety:* gstack `/careful` `/freeze` `/guard` `/investigate` have no Superpowers equivalent; use them for destructive ops and blast-radius control.

**When to use no heavy skill at all:** a genuinely trivial, well-specified one-file change does not need the full brainstorm→plan→TDD loop (both gstack and Superpowers say so). Apply Karpathy's judgment clause. Still run Ponytail and still write the test.

---

## 5. Research Protocol

**Research before you can be wrong in an expensive, irreversible way.** Specifically, research is *mandatory* before: any irreversible architectural decision (framework, datastore, workflow engine, model-router library, messaging-channel strategy); adopting or pinning a dependency; anything touching a fast-moving external fact (model availability and pricing, SDK/API capabilities, provider quotas and ToS). Research is *forbidden as a substitute for asking* when the answer lives in the handbook or with the human — read/ask first.

**How deep:** proportional to reversibility and blast radius. A reversible, local choice needs a quick check. An irreversible, cross-cutting choice (e.g., which durable-execution engine the whole loop depends on) needs real comparison across current sources and a recorded rationale.

**Sources, prioritized:** official docs and primary sources (provider docs, the skill's own repo/README, the datastore's docs) → the handbook's own Research Notes (Ch 24) and Decision Log → reputable current benchmarks for model selection → then everything else. Prefer the newest authoritative source; model and pricing facts go stale monthly.

**When assumptions are unacceptable:** on anything irreversible, on any external capability or limit you have not verified this month, and on any product behavior. On these, a guess is a defect. Surface the unknown and resolve it.

**When research forces a handbook update:** if research contradicts a handbook assumption (e.g., a named vendor is unavailable, a pricing tier changed, a channel can't be sent to), stop, run the Confusion Protocol, and amend the handbook before building on the old assumption.

---

## 6. Repository Bootstrap

The empty repository is set up **before any feature code**, so standards precede the code they govern (Constitution IV). Every choice is grounded in the handbook's chosen stack (§18) and its rationale is recorded.

**Structure — a single typed monorepo.** One repository, one language toolchain, packages by domain boundary. Rationale: the product is one coordinated system with shared types (the canonical objects: Action, Plan, Experiment, Verdict, Company State) flowing across every subsystem; a monorepo keeps those types in one source of truth (Constitution VII) and lets a change and its tests land atomically. TypeScript end-to-end, because the handbook's frontend is already TypeScript/Next.js and a single language removes a translation seam.

**Directory layout (illustrative, to be confirmed in Build 0's design):**
```
/apps/web            → Next.js 16 app shell (handbook Ch 4)
/packages/core       → domain model + canonical objects (one source of truth)
/packages/founder-model → the Founder Model: storage, retrieval, policy (Ch 6)
/packages/orchestration → durable workflows, triggers, tiers (Ch 8)
/packages/research   → live research pipeline (Ch 11)
/packages/messaging  → channel-agnostic messaging + identity (Ch 10)
/packages/model-router → provider-agnostic LLM routing (Ch 20)
/packages/db         → schema, migrations, pgvector access (Ch 19)
/docs/handbook       → the canonical handbook (the product constitution)
/docs/decisions      → ADRs mirrored into the handbook Decision Log
```
Rationale: directories map 1:1 to the handbook's owning-system partition (Constitution XII), so a reader can find the code for a chapter by name.

**Configuration:** environment-based, secrets never in the repo. Three environments — local, staging, production — with parity enforced by the same config schema validated at boot (fail fast on missing/invalid config; Constitution IX). Rationale: the product takes irreversible real-world actions, so a mis-scoped environment must be impossible to start, not merely discouraged.

**Linting & formatting:** a single opinionated formatter and linter, run in a pre-commit hook and in CI, zero-config for contributors. Rationale: formatting debates are entropy (Constitution V); automate them away so review spends its attention on logic, not whitespace — which is also Karpathy §3.

**Testing:** one test runner across the monorepo; unit tests co-located with code, integration tests per package, end-to-end tests for the journey loop. TDD is the default (Constitution XI). Rationale: tests are the behavior spec; a shared runner keeps the red/green loop fast enough to actually use.

**CI:** on every push — install, typecheck, lint, test, build. Red CI blocks merge, always (Constitution X, no red merges). The durable-workflow and model-router layers get contract tests against recorded fixtures so external-provider flakiness can't turn CI red spuriously. Rationale: CI is the mechanical enforcement of the Definition of Done (§9).

**Irreversible-action safety from day one:** idempotency keys and an audit log are part of the substrate, not retrofitted (handbook §18.3, §5.3). Rationale: retrofitting idempotency after the send path exists is how double-sends ship.

---

## 7. Ten-Build Implementation Roadmap

The handbook's Build 0–8 sequence is re-expressed as engineering builds that **front-load shared substrate to minimize rework**. Notably, orchestration and the data/memory substrate come before the capabilities that depend on them, so async and persistence are never retrofitted. Each build carries: objective · deliverables · dependencies · acceptance criteria · testing · docs · git milestone. Every build also inherits the global Definition of Done (§9).

**Build 0 — Repository & CI Foundation.**
*Objective:* a healthy empty repo that makes the standards in §6 mechanical. *Deliverables:* monorepo, tooling, three-env config schema, CI pipeline, test harness, idempotency+audit substrate, the model-router and durable-workflow *abstractions* (interfaces + one adapter each, chosen in Build 0 research). *Dependencies:* none. *Acceptance:* `main` builds green; a trivial vertical slice passes through CI to a staging deploy; a destructive-action stub is idempotent and audited. *Testing:* CI self-test; contract-test fixtures for router/workflow. *Docs:* bootstrap decisions recorded as ADRs; handbook §18–22 updated with chosen vendors. *Milestone:* `build-0-foundation`.

**Build 1 — Data & Memory Substrate.**
*Objective:* the persistence layer for everything. *Deliverables:* Postgres schema + migrations for the Founder Model's four layers (Episodes, Graph, Traits, Policy), Public Knowledge store, canonical objects (Company State, Plan/Action, Experiment, Verdict), and the channel-agnostic messaging identity schema (handbook §19.4). *Dependencies:* Build 0. *Acceptance:* migrations apply and roll back cleanly; schema matches handbook Ch 19; pgvector retrieval returns on seeded data. *Testing:* migration up/down tests, repository-layer unit tests. *Docs:* Ch 19 column-level schema filled in. *Milestone:* `build-1-data`.

**Build 2 — Orchestration & Durable Execution.**
*Objective:* the proactive loop's engine, before anything needs it. *Deliverables:* durable-workflow integration, the three trigger intakes (inbound / scheduled scan / internal event), the three execution tiers routed through the model-router, idempotent external-action wrapper, retry/backoff, degrade-to-asking on uncertainty (handbook Ch 8, §18.3). *Dependencies:* Build 0, 1. *Acceptance:* a scheduled scan fires a workflow that survives process restart; a simulated irreversible action cannot double-fire under retry. *Testing:* workflow durability tests, idempotency tests, failure-injection. *Docs:* Ch 8 / §18.3 confirmed against implementation. *Milestone:* `build-2-orchestration`.

**Build 3 — Public Knowledge Corpus & Grounding.**
*Objective:* grounded planning/validation inputs. *Deliverables:* ingestion of the ~19k-chunk corpus, embedding, and the grounding-retrieval path used *only* by Planning and Validation (handbook Ch 7). *Dependencies:* Build 1. *Acceptance:* grounding retrieval returns relevant chunks; Research cannot access the corpus (the separation is enforced, not just documented). *Testing:* retrieval relevance checks, an access-boundary test. *Docs:* Ch 7. *Milestone:* `build-3-knowledge`.

**Build 4 — The Founder Model (flagship).**
*Objective:* the differentiator: memory that decides behavior. *Deliverables:* hybrid graph+semantic retrieval, the background write path (extract→abstract→reconcile) on the orchestration engine, typed dimensions (§6.3), and the calibration v0 mechanics (§6.15): saturating confidence, per-family decay on confidence, stated-vs-revealed gate, bounded policy learning, and the hard burnout veto. Ships with instrumentation to later tune the constants. *Dependencies:* Build 1, 2. *Acceptance:* a corrected read updates and persists; a superseded fact is invalidated not deleted; the burnout veto measurably caps intervention intensity; reads are inspectable/correctable. *Testing:* calibration-math unit tests, reconciliation tests, veto tests, provenance/audit tests. *Docs:* Ch 6 confirmed; instrumentation plan recorded. *Milestone:* `build-4-founder-model`.

**Build 5 — Messaging Substrate & Interaction Shell.**
*Objective:* the primary surface and one thread per founder across channels. *Deliverables:* Photon/Spectrum (`spectrum-ts`) integration over its gRPC stream with dedicated lines for per-founder identity (see Handbook Recommendation #1), inbound resolution to one founder, ordered/deduped threads, delivery status with SMS/RCS fallback, and the Next.js app shell showing Plan/Experiment/Company State (handbook Ch 4, Ch 10). *Dependencies:* Build 1, 2. *Acceptance:* a founder moving across channels stays one thread; execution continues while the founder replies. *Testing:* identity-resolution tests, ordering/dedup tests, delivery-reliability tests. *Docs:* Ch 10, §19.4. *Milestone:* `build-5-messaging`.

**Build 6 — Onboarding & Seeding.**
*Objective:* first model of the founder + the first proactive handoff. *Deliverables:* the three entry paths (idea / problem / none), Founder Model cold-start seeding (§6.13), and the automatic trigger into Research at the right point (handbook Ch 3). *Dependencies:* Build 4, 5, 2. *Acceptance:* each path seeds the highest-leverage dimensions at low confidence; completing onboarding auto-triggers Research with no user prompt. *Testing:* path-branching tests, seeding-confidence tests, trigger test. *Docs:* Ch 3. *Milestone:* `build-6-onboarding`.

**Build 7 — Research Pipeline.**
*Objective:* live signal → verdict. *Deliverables:* typed source integration (xAI X Search primary; HN, Serper, Crunchbase supporting) within provider budgets, weighted synthesis, the four-stage pipeline, and the `strong/weak/pivot` verdict with evidence links (handbook Ch 11). *Dependencies:* Build 2, 6. *Acceptance:* a verdict is produced from live sources and is evidence-linked; sources are synthesized, not averaged; provider quotas are respected. *Testing:* synthesis tests against fixtures, quota/rate-limit handling, verdict-shape tests. *Docs:* Ch 11, §21. *Milestone:* `build-7-research`.

**Build 8 — Planning & Validation.**
*Objective:* sequenced execution + the riskiest-assumption test. *Deliverables:* Plan/Action generation grounded in Public Knowledge with the five mandatory Action fields and the founder-pushback loop; Experiment design with explicit success/failure criteria (handbook Ch 12–13). *Dependencies:* Build 3, 4, 7. *Acceptance:* a Plan is sequenced (not a flat list) and re-sequences on triggers; an Experiment targets the single highest-risk assumption with pre-set criteria. *Testing:* Action-completeness tests, re-planning-trigger tests, experiment-criteria tests. *Docs:* Ch 12–13. *Milestone:* `build-8-planning-validation`.

**Build 9 — Outreach → MVP complete.**
*Objective:* the founder's first real customer conversations, the MVP finish line. *Deliverables:* prospect identification, drafting, the draft→approve→send path under the partial-autonomy model, conversation tracking, and automatic follow-up as a Tier-3 sequence (handbook Ch 14, Ch 5). *Dependencies:* Build 2, 5, 8. *Acceptance:* the full §2.7 loop runs end-to-end without the founder coordinating a handoff; no send occurs without a standing grant or explicit confirmation; sends are idempotent. *Testing:* end-to-end journey test, autonomy-gate tests, follow-up-durability tests. *Docs:* Ch 14, Ch 5; **mark the MVP complete in the handbook**. *Milestone:* `build-9-mvp`.

**Build 10 — Voice & post-MVP capabilities (fast-follow).**
*Objective:* the fast-follow and post-MVP builds. *Deliverables:* Voice on Grok (realtime S2S, cloning, AI voice calling under the strictest guards), then Launch, Post-launch, Operations (handbook Ch 9, 15–17). *Dependencies:* Build 9; Grok voice integration confirmed (Handbook Recommendation #7). *Acceptance:* per-chapter; voice calling inherits the most-guarded autonomy class. *Testing:* per capability. *Docs:* Ch 9, 15–17. *Milestone:* `build-10-fast-follow`. *Note:* explicitly post-MVP; not required for the MVP definition of done.

---

## 8. Handbook Synchronization

Code and handbook are kept in lockstep, continuously, not in a cleanup pass:

- **Before a build:** read the governing chapter(s). If they're ambiguous or incomplete, Confusion Protocol before coding (§2).
- **During a build:** any architectural decision is written into the handbook Decision Log (Ch 23) *as it's made*, with alternatives rejected (Constitution VI).
- **Ending a build:** the governing chapters are updated to match what was actually built; open items in §25.3 are resolved or re-flagged. The build is not done until they match (Constitution VIII, §9).
- **On contradiction:** the handbook wins over code as the product source of truth — but if the *code* revealed the handbook is wrong, we amend the handbook (with approval if load-bearing), we don't silently diverge.
- **The handbook lives in the repo** (`/docs/handbook`) so its changes are reviewed, versioned, and shipped in the same commit as the code they describe.

---

## 9. Definition of Done

A build (and every meaningful change) is done only when **all** hold:

1. **Handbook-traceable** — every behavior maps to a handbook chapter; nothing un-handbooked shipped (Constitution I).
2. **Tests first and green** — behavior was pinned by a failing test before implementation; the full suite passes (Constitution XI).
3. **Complexity pass** — Ponytail run; the delete-list is addressed or explicitly deferred as tracked debt (Constitution III).
4. **Reviewed** — gstack `/review` + `/oracle` clean; for large diffs, a Superpowers reviewer subagent signed off on spec + quality.
5. **Docs & handbook synced** — governing chapters updated; Decision Log updated for any architectural decision (§8).
6. **Reversible where practical** — migrations roll back; irreversible actions are idempotent and audited (Constitution X).
7. **Clean repository** — worktree clean, no stray artifacts, CI green.
8. **Meaningful commit** — the message explains architectural *intent*, not just the diff.
9. **Pushed**, and the git milestone tagged (§10).
10. **Retro captured** — gstack `/retro`; claude-mem holds the session; a clear next-step is left for the next session (§15).

If any item fails, the build is not done. There is no partial credit.

---

## 10. Git Protocol

- Work happens in an **isolated worktree/branch** (Superpowers `using-git-worktrees`), so `main` stays green and any dead end is discarded without collateral.
- Destructive git operations go through gstack `/careful`.
- Every build ends with the full Definition of Done (§9), then a **single meaningful commit (or a clean stack) whose message states the architectural intent** — what changed structurally and why — followed by push and a tagged milestone (`build-N-name`).
- **Never merge red.** CI green is a precondition, not a formality (Constitution X).
- Commit messages are part of the Decision Log's paper trail; write them for the engineer reading `git log` in six months.

---

## 11. Continuous Improvement

Every session leaves the repository healthier (Constitution V), and improvement never violates the Constitution or a load-bearing boundary:

- Run Ponytail `/ponytail-audit` and `/ponytail-debt` on a cadence; refactor before complexity institutionalizes.
- Improve developer experience (faster CI, better test ergonomics, clearer seams) as long as it reduces, not adds, entropy.
- Propose handbook improvements when implementation reveals better structure — but *propose*, with approval for load-bearing changes (§12); never quietly rewrite product intent.
- Keep documentation dense (Ponytail ethos): information per line stays high; we don't pad the handbook or the docs.
- Promote stable, hard-won conclusions from claude-mem into the handbook or code so they become durable truth, not session memory.

---

## 12. Autonomous Decision-Making

**Claude Code may decide independently:** implementation details, internal structure, naming, test design, behavior-preserving refactors, and library choices *within* handbook and Constitution constraints. These need no approval; just do them well.

**Requires a handbook modification** (Claude proposes, records rationale, updates the handbook, then continues): any new product behavior; any architectural decision (a new subsystem, a change to a canonical object or the data model, a model-routing policy, a change to an autonomy class); resolving a handbook ambiguity. Product truth changes in the handbook first, never in code alone.

**Requires explicit human approval:** irreversible or costly real-world actions in production (sending, calling, spending); production deploys; destructive/irreversible migrations; security-sensitive changes; any change to the Founder Model's *calibration shapes* or the product's autonomy model; and any amendment to a **load-bearing boundary** (Constitution XIII) or to the Constitution itself (Constitution XV). When in doubt whether something is load-bearing, treat it as if it is and ask.

---

## 13. Failure Recovery

- **Architecture mistake:** stop; Confusion Protocol; if reversible, revert cleanly via the worktree; record what failed and why in the Decision Log (a rejected approach is data that stops the next session repeating it); research the alternative; re-plan. Sunk cost is never a reason to continue.
- **Implementation mistake:** write the reproducing test first (Karpathy §4), find the root cause via Superpowers `debugging` (not a symptom patch), fix surgically (Karpathy §3) with no drive-by edits.
- **Handbook inconsistency:** halt; do not pick a reading silently; present both with tradeoffs; propose an amendment; get approval if load-bearing; update the handbook; then continue. The handbook is made consistent before code proceeds.
- **Failed build / red CI:** never merge; roll back to the last green state; the worktree kept `main` clean; run gstack `/retro` to capture the cause so it's not repeated.
- **Dead-end approach:** kill it early — Ponytail's whole ethos is that the best code is the code you never wrote. Record the dead end (claude-mem + Decision Log) so it isn't rediscovered the hard way.
- **Environment/platform failure:** recognize it's outside Superpowers' workflow; step out, use gstack `/careful`, and treat it as an ops problem, not a feature problem.

---

## 14. Session Startup Checklist

1. Read `CLAUDE.md` (auto-loaded — Karpathy's guidelines).
2. Read `DEVELOPER_CONSTITUTION.md`, then this file (`ENGINEERING_OS.md`). They are not auto-injected; loading them is the ritual.
3. Let claude-mem inject prior context; review the "Recalled memories" and `mem-search` anything relevant to today's work.
4. Read the handbook chapter(s) governing today's build.
5. Confirm the current build, its acceptance criteria (§7), and git state (clean worktree; last milestone).
6. Identify today's activity and route it to skills via §4.
7. If anything is ambiguous against the handbook, run the Confusion Protocol **before** writing any code (§2, Constitution II).

## 15. Session Shutdown Checklist

1. Full test suite green.
2. Ponytail complexity pass done; delete-list addressed or deferred as tracked debt.
3. gstack `/review` + `/oracle` clean; reviewer subagent signed off on large diffs.
4. Docs and handbook synced; Decision Log updated for any architectural decision.
5. Migrations reversible; irreversible-action code idempotent and audited.
6. Worktree clean; CI green.
7. Commit with architectural-intent message via gstack `/ship`; push; tag the milestone.
8. gstack `/retro` to capture learnings; confirm claude-mem captured the session.
9. Update the build's status/progress note in the handbook.
10. Leave an explicit next-step for the next session (initializer/worker handoff), so the next context window resumes without re-deriving state.

---

*This file evolves. The Constitution and the handbook do not evolve casually. When they disagree with this file, they win — and this file gets corrected.*