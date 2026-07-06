# EXECUTION.md

*The first file every Claude Code session reads. Assume no memory: this file re-establishes context from scratch, every time. It orchestrates the governing documents — it does not repeat them. Read it fully, then follow the Startup Sequence in order. Do not touch code before the sequence completes.*

---

## Document Authority

Highest wins. When two disagree, defer upward and, if the conflict is real, stop and escalate rather than guess.

```
CEO (human)                  ← final authority; only they amend load-bearing product/eng boundaries
  ↓
Company Handbook             ← product source of truth (WHAT we build). /docs/handbook
  ↓
Developer Constitution       ← immutable engineering principles (HOW we build). Never violate.
  ↓
CLAUDE.md                    ← per-change coding behavior (Karpathy: think first, simplest, surgical, goal-driven)
  ↓
Implementation Roadmap       ← the ten-build plan. ENGINEERING_OS.md §7
  ↓
EXECUTION.md (this file)     ← the bootloader: initialize, plan, execute, shut down
  ↓
Claude Code session          ← you
```

**Conflict rules.** Product question → Handbook wins. Engineering-principle question → Constitution wins. "How should this code behave in the small" → CLAUDE.md. If the Handbook and Constitution appear to genuinely conflict, that is a stop condition: run the Confusion Protocol (below) and escalate to the CEO. This file never overrides anything above it; it only sequences them.

**Operating protocol.** All engineering rules, skill routing, bootstrap details, Definition of Done, and decision boundaries live in `ENGINEERING_OS.md`. This file references it; it does not restate it.

---

## First-Session Bootstrap (run once, only if the repo is not yet initialized)

If `git status` errors (no repo yet), the folder already contains the four governing docs and the handbook but no git history. Initialize it, then proceed to Build 0.

```bash
# 1. Confirm you're in the project root with the governing docs present
ls CLAUDE.md DEVELOPER_CONSTITUTION.md ENGINEERING_OS.md EXECUTION.md HANDBOOK_RECOMMENDATIONS.md

# 2. Move the handbook into its canonical location (one source of truth)
mkdir -p docs/handbook
[ -f tethr-handbook.md ] && git mv tethr-handbook.md docs/handbook/ 2>/dev/null || mv tethr-handbook.md docs/handbook/ 2>/dev/null || true

# 3. Initialize the repository
git init
printf "node_modules/\n.env*\n.DS_Store\ndist/\nbuild/\n.next/\ncoverage/\n*.log\n" > .gitignore

# 4. First commit: the governing constitution of the company, before any code
git add CLAUDE.md DEVELOPER_CONSTITUTION.md ENGINEERING_OS.md EXECUTION.md HANDBOOK_RECOMMENDATIONS.md docs/ .gitignore
git commit -m "chore: establish governing documents (handbook, constitution, engineering OS, execution)

The company's product and engineering constitution before any application code.
All future builds derive from these. Next: Build 0 — Repository & CI Foundation (ENGINEERING_OS.md §7)."

# 5. Set the default branch name
git branch -M main
```

Then **stop and address `HANDBOOK_RECOMMENDATIONS.md` with the CEO** — several items (messaging risks, security chapter, vendor picks) block early builds. Once cleared, begin **Build 0**. Every later session skips this block entirely and follows the Startup Sequence below.

---

## Startup Sequence (deterministic — every session, in order)

1. **Read this file** (`EXECUTION.md`) fully.
2. **Read the Company Handbook** — at minimum the chapter(s) governing the current build; skim the Decision Log (Ch 23) and open items (§25.3). `/docs/handbook`.
3. **Read `DEVELOPER_CONSTITUTION.md`** completely. It is short and binding.
4. **Read `CLAUDE.md`** — your per-change behavior.
5. **Read `ENGINEERING_OS.md`** — routing (§4), roadmap (§7), DoD (§9), decision boundaries (§12). This is your operating manual; hold it for the session.
6. **Let claude-mem inject prior context**; review "Recalled memories" and `mem-search` the current build's topic. (gstack memory-sync stays disabled — claude-mem owns memory.)
7. **Inspect the repository** — structure, and whether it matches the Handbook's owning-system partition.
8. **Inspect git** — `git status`, current branch, last milestone tag, uncommitted work.
9. **Run the Repository Audit** (below).
10. **Determine the current build** from the roadmap (§7) and the last milestone tag; read its acceptance criteria.
11. **Verify Handbook ↔ implementation are synchronized** (§8). If drifted, that is the session's first work item, not something to code past.
12. **Write a Session Plan** (below) and confirm it before implementing.
13. **Begin work** through the skill routing (§4).

Steps 1–11 are context-gathering and must complete before step 12. Never begin implementing at step 7.

---

## Session Initialization — understand before touching code

By the end of the Startup Sequence you can state, in one short paragraph: the **current product state** (what's built vs. the MVP definition, Handbook §2.7), the **current engineering milestone** (which build, its acceptance criteria), **repository health** (tests green? CI green? clean tree?), **unresolved Handbook issues** (open items in §25.3, anything in `HANDBOOK_RECOMMENDATIONS.md` still blocking), **architectural risks** in play, **pending research** (§5), and **open decisions** awaiting the CEO. If you cannot state these, you have not finished initializing.

---

## Repository Audit (lightweight, every session)

Determine and note: the **current build** and what in it is **incomplete**; **failing tests** or red CI; **documentation drift** (code without matching docs); **Handbook drift** (behavior not reflected in the Handbook, or vice versa); **architectural inconsistencies** (violations of the owning-system boundaries); **unnecessary complexity** (a quick Ponytail read); and one or two **improvement opportunities**. Findings feed the Session Plan. Fixing drift and red state comes before new features (Constitution V).

---

## Session Plan (written, before any implementation)

Never implement immediately. Produce a short plan first, stating: **objectives** (tied to the current build's acceptance criteria); **dependencies** (what must exist first); **risks** (what could go wrong, what's irreversible); **expected outputs** (files, tests, docs, migrations); and the **Definition of Done** for this session (ENGINEERING_OS §9). For multi-step work, use CLAUDE.md's plan format (step → verify). Route each objective to skills via §4. If any objective is ambiguous against the Handbook, resolve it via the Confusion Protocol before planning further.

---

## During Development (cadence)

Continually compare implementation to the Handbook — it is the spec. **Stop the moment requirements become ambiguous** (Confusion Protocol, below), rather than guessing. Update documentation and the Handbook alongside the code, not after (Constitution VIII). Maintain architectural consistency with the owning-system boundaries (Constitution XII). Keep work in an isolated worktree so `main` stays green. Reassess the plan when reality diverges from it; a stale plan followed blindly is how drift ships. Run Ponytail as you go, not just at the end.

**The Confusion Protocol** (the single most important habit): when the Handbook is unclear, two readings exist, or a decision is irreversible — stop, name exactly what's unclear, present the options with tradeoffs, propose an improvement, get resolution (CEO approval if load-bearing, ENGINEERING_OS §12), amend the Handbook, then continue. A silent wrong guess costs more than the question.

---

## End-of-Session Protocol

Finish so that any next session resumes instantly. Complete the full Definition of Done (ENGINEERING_OS §9): verify the build's **acceptance criteria**; **tests green**; **Ponytail** complexity pass; **review** clean (gstack `/review` + `/oracle`); **docs and Handbook updated**, Decision Log written for any architectural decision; **roadmap status updated**; migrations reversible and irreversible actions idempotent; **clean repository**; a **commit whose message states architectural intent**, via gstack `/ship`; **push** and tag the milestone; gstack `/retro` to capture learnings (claude-mem persists them); and a **written next-step** naming the recommended next session. If any item fails, the session isn't done.

---

## Long-Term Thinking

Every decision is one future engineers must live with. Optimize for maintainability, consistency, readability, extensibility, and production quality — never for finishing quickly (Constitution IV). When speed and quality conflict, quality wins and the slower path is the right one. The company's moat is a system that compounds; build so the codebase compounds with it.

---

*Read before every session. If you remember nothing else: read the Handbook, obey the Constitution, plan before you code, stop when confused, and leave the repo healthier than you found it.*
