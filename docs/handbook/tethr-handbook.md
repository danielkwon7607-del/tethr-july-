# tethr — Company Handbook

**This document is authoritative.** Engineering docs, product specs, roadmaps, and every future AI working session derive from this handbook; the handbook does not derive from them. Where a downstream document disagrees with this one, this one wins until it is explicitly amended here.

**Version:** 0.4 · **Last edited:** 2026-07-06 · **Greenfield: nothing is built yet** — the stack and architecture in this handbook are decisions, not descriptions of an existing system.
**Written so far:** All 25 chapters drafted. The v0.3 engineering open items are now resolved at design level — Founder Model calibration (§6.15), durable execution (§18.3), model routing (Ch 20), messaging identity (§19.4). What genuinely remains is in §25.3.

---

## How to read this

- **One chapter, one question.** Each chapter answers a single question stated in its heading. If a chapter starts answering a second question, that content belongs in another chapter.
- **Chapters are self-contained.** A capability's product surface and its internals live together, not split across a "product" tree and a "systems" tree. Shared UI substrate is the one exception and lives in Chapter 4.
- **Derivation direction is one-way.** Terminology defined in §1.9 is binding everywhere downstream.

---

## Table of Contents

**Part I — Foundation**
1. **Product Constitution** — *What is tethr, and why does it exist?* ✅
2. **MVP Specification** — *What are we shipping, and when is it done?* ✅

**Part II — Product & Interaction**
3. **Onboarding & Founder Seeding** — *How does tethr build its first model of a founder?* ✅
4. **Interaction Model & Product Shell** — *How do founder and tethr communicate?* ✅
5. **Trust, Autonomy & Control** — *Where is the line between "confirm" and "execute"?* ✅ *(partial-autonomy model; see §1.7, §1.9)*

**Part III — Substrate Systems**
6. **The Founder Model** — *How does tethr know the founder, and how does that knowledge decide what tethr does?* ✅ *(flagship; Founder Memory + Behavioral Model + Memory Harness unified; derives from Ch 24)*
7. **Public Knowledge & Grounding** — *What canonical startup knowledge grounds planning and validation?* ✅
8. **Agent Orchestration & Execution Model** — *What makes tethr agentic rather than reactive?* ✅
9. **Voice System** — ✅
10. **Messaging System** — ✅

**Part IV — The Journey Pipeline** *(each chapter: founder-facing surface + internals, end to end)*
11. **Research** — ✅
12. **Planning** — ✅
13. **Validation** — ✅
14. **Outreach** — ✅
15. **Launch** — ✅
16. **Post-launch Iteration** — ✅
17. **Operations & Company State** — ✅

**Part V — Engineering**
18. **System Architecture** — ✅
19. **Data Model & Schemas** — ✅
20. **Model Routing** — ✅
21. **External Integrations & APIs** — ✅
22. **Infrastructure, Deployment & Observability** — ✅

**Part VI — Reference**
23. **Decision Log** — ✅
24. **Research Notes** — *What does the state of the art in agent memory get right and wrong, and what does tethr take from it?* ✅
25. **Roadmap** — ✅

> **Structural note.** The original source material described "two separate memory systems" (Public Knowledge and Founder Memory) and, separately, a "Behavioral Model / Memory Harness." Per founder decision (2026-07-06), **Founder Memory, the Behavioral Model, and the Memory Harness are one system**, named the **Founder Model** (Chapter 6). Public Knowledge remains a distinct system (Chapter 7). This is now canonical terminology and is not to be re-split.

---
---

# Chapter 1 — Product Constitution
### *What is tethr, and why does it exist?*

## 1.1 Definition

tethr is an agentic AI cofounder for first-time founders. Precisely: a persistent software system that occupies the **cofounder role** for one founder — or a team of at most two — executing the operational work of building an early-stage technology company, while the founder supplies decisions, direction, and the approvals for anything irreversible.

The category is "cofounder," not "assistant," and the difference is not marketing. An assistant is prompt-bound and stateless by default: it responds when addressed and forgets between sessions. tethr is defined by the inverse of both properties. Three properties constitute the category:

1. **Initiative.** tethr acts without being asked. Work is triggered by events (onboarding completing, a research verdict landing, an outreach thread going quiet, a competitor moving), not solely by founder prompts. A tethr that only ever responds is broken, not merely underused.
2. **Persistence.** There is one continuous relationship and one continuously-updated model of the founder — not a series of independent chats. The unit of state is the company and the founder, not the conversation.
3. **Compounding.** Marginal value rises with tenure. Because the Founder Model (Ch 6) deepens with every interaction, the same request produces a better-fitted result in month six than in week one. A product that is equally good on day 1 and day 100 is not tethr.

**Division of labor (canonical).** The founder owns decisions, direction, and irreversible approvals. tethr owns the execution of everything it reasonably can, plus the job of surfacing — clearly and at the right moment — the decisions only the founder can make. When in doubt about ownership: if it is reversible and mechanical, tethr does it; if it commits the company to something, the founder decides.

**Scope.** The full arc of building an early-stage company: idea → research → planning → validation → customer outreach → launch → post-launch iteration → ongoing operations. tethr is present at every stage, and the same Founder Model carries across all of them. It does not hand the founder off to a different tool at each stage; being the through-line is the point (§1.4).

## 1.2 Why it exists

First-time founders do not fail for lack of advice. Advice is abundant, free, and mostly correct — Paul Graham's essays, Steve Blank, a thousand YouTube teardowns. They fail at **execution continuity**: knowing the single next right action, doing the unglamorous version of it, and holding momentum across the weeks between an insight and its outcome. The bottleneck is not knowledge; it is sequencing, initiation, and follow-through under uncertainty and alone.

Existing AI tools worsen exactly this bottleneck even as they help with everything else. They generate advice on demand and forget the company between sessions, which pushes all of the coordination, memory, and sequencing back onto the founder — the precise labor the founder is worst equipped to sustain solo. Every session starts by re-explaining the company. Nothing accrues.

tethr exists to close execution continuity: hold the company state, decide the next action, do the reversible part, and bring back only the decision. The wager is that a founder's real scarce resource is not intelligence or information but a second entity that remembers everything, never loses the thread, and keeps moving.

## 1.3 Product philosophy

Four axes. Each is a deliberate trade, stated with what it gives up.

- **Execution over advice.** tethr does the work rather than describing it. Trade: less exhaustive coverage of options, in exchange for things actually getting done. A correct recommendation the founder never acts on scores zero.
- **Initiation over waiting.** tethr reaches out when the company needs it to, rather than waiting to be addressed. Trade: risk of being intrusive, in exchange for momentum the founder would not self-generate. Managed by the autonomy model (Ch 5) and intervention policy (Ch 6), not by staying silent.
- **Compounding over isolated.** Every interaction feeds one growing model. Trade: heavier state, privacy surface, and cold-start cost, in exchange for personalization that no stateless competitor can match.
- **Persistence over sessions.** The relationship is the product; the chat is an event within it. Trade: architectural weight, in exchange for a founder who never starts over.

Three **invariants** follow from these and are non-negotiable:

1. **The founder never re-explains their company.** If tethr asks for something it already knows, or could reconstruct from the Founder Model, that is a bug.
2. **Personalization is monotonic.** More use produces more fit, never a reset. Behavior may be corrected and superseded, but understanding does not silently regress.
3. **The ratchet.** Every interaction leaves the company in a strictly better state than before — a decision recorded, an action advanced, a risk retired, or the model sharpened. An interaction that leaves nothing behind violates the constitution.

## 1.4 Positioning

**tethr is the coordinator, not another tool.** Existing AI products are isolated capabilities the founder must orchestrate by hand. tethr owns the orchestration: it holds the company's state and the sequencing, and it calls other capabilities (research sources, messaging channels, voice, connected apps) as instruments. The founder works with tethr the way they would work with an experienced cofounder — by talking — not the way they operate software, by navigating it.

Core external framing: **starting a real company should feel as easy as texting a friend.** This is not a tagline to reproduce in the product; it is a design constraint. It commits the interaction model to conversation (Ch 4), the primary channel to messaging (Ch 10), and the burden of structure to tethr rather than the founder.

What "coordinator" commits us to architecturally: tethr must own the canonical graph of company state and the authority to sequence work. Anything that reduces tethr to a feature invoked by some other hub violates the positioning.

## 1.5 Target user (and the non-user)

**Primary users:** first-time founders, roughly 18–30, building early-stage technology companies — solo, or teams of two.

The age and experience skew is a design input, not a demographic footnote. These founders are typically **execution-capable but process-naive**: they can build, ship, and hustle, but they do not yet hold the *sequence* of company-building in their heads, and they underweight the unglamorous steps (talking to customers, validating before building). Consequences that propagate through the whole product:

- tethr's value concentrates in **sequencing, initiation, and accountability** more than in raw generative capability. The founder can write the cold email; what they lack is knowing it's the right week to send it, and being made to.
- Interventions (Ch 6) skew toward *countering predictable first-time-founder failure modes* — building before validating, avoiding customer conversations, mistaking motion for progress.
- Onboarding (Ch 3) must handle founders with no idea, only a problem, or a fixed idea, because that variance is the norm in this segment.

**Explicit non-users** (who tethr is *not* built for, so we do not distort the product to serve them): experienced repeat founders who already carry the model internally — tethr's compounding advantage is smaller for them; non-technical founders and later-stage operators whose needs (hiring, finance ops, scaling) are out of current scope. Serving the non-user well is not a goal and should never justify a feature.

## 1.6 Non-goals

Each non-goal names the boundary it protects. tethr is **not**:

- **A generic chatbot.** It is stateful and initiating; open-ended conversation with no company state behind it is not the product.
- **A note-taking app or wiki.** It does not passively store what the founder writes; it maintains a structured, reasoned model and acts on it.
- **A CRM.** It tracks customer conversations as a means to validation and iteration, not as a system of record to be administered.
- **A meeting recorder.** Capture is not the job; execution is.
- **A coding agent or no-code builder.** *tethr builds the company, not the product.* This is the load-bearing boundary of the entire company (restated in Ch 15). tethr coordinates research, planning, validation, outreach, launch, and operations; it does not write the founder's application. Crossing this line turns tethr into a crowded, capital-intensive category and dilutes the cofounder role into a dev tool.
- **A replacement for the founder.** Decision rights stay with the human. This is simultaneously a product stance (the founder must own their company) and a safety stance (tethr does not unilaterally commit the company). The autonomy model (Ch 5) exists to make this precise, not to erode it.

## 1.7 Product principles

Operational and testable — each with the check that reveals a violation.

- **Conversation-first.** The primary interface is talking (text or voice), not navigating UI. *Test:* if a core action requires the founder to find a screen rather than say a sentence, the principle is violated.
- **Memory-first.** Every interaction reads from and writes to the Founder Model. *Test:* if tethr asks for something it already knows, fail.
- **Execution-first.** Default to doing the reversible work, not proposing it. *Test:* if a response is advice where action was possible and safe, fail.
- **Confirm-then-execute, with standing autonomy.** For actions the founder has not pre-authorized, the founder's confirmation is what triggers autonomous execution. For actions the founder *has* pre-authorized (Ch 5), tethr executes without per-instance confirmation. *Test:* an irreversible action taken without either standing authorization or explicit confirmation is a serious fault.
- **Knowledge compounds.** No interaction is discarded; each sharpens the model. *Test:* if repeated corrections don't change future behavior, the write path is broken (Ch 6).
- **Natural, not robotic.** Automation should read as an attentive cofounder, not a notification engine. *Test:* if a message could have come from a cron job, rewrite it.

## 1.8 Competitive philosophy

tethr does not compete on model quality or feature count. Frontier models are a rented, rapidly-commoditizing input; feature lists are copied in a quarter. tethr competes on the one asset that **compounds and cannot be cloned**: the **Founder Model** (Ch 6) — a private, per-founder, continuously-updated model of how *this* person builds companies, earned only through tenure.

The moat is therefore two-sided: the accumulated private model that a competitor starting today cannot reproduce for an existing founder, and the switching cost of walking away from a system that already knows everything. Every strategic decision is evaluated against whether it deepens that model or merely adds surface area. Surface area is not the business.

## 1.9 Canonical terminology

Binding definitions. Used exactly this way everywhere downstream.

- **tethr** — always lowercase. The product and the agent; not "Tethr," not "the app."
- **Founder** — the primary human user. Singular even for a two-person team; the second member is a *collaborator* on the same company.
- **Founder Model** — the unified system that (a) stores what tethr knows about the founder and their company and (b) decides what tethr does. **Founder Memory, the Behavioral Model, and the Memory Harness are three names for this one system and must not be treated as separate.** It has a storage/retrieval layer and a decision/policy layer, but it is one system. Detailed in Chapter 6.
- **Public Knowledge** — the separate, read-only grounding corpus of canonical startup knowledge (~19k embedded chunks; Paul Graham, Steve Blank, SaaStr, First Round Review). Used only for Planning and Validation, never Research. Distinct from the Founder Model. Chapter 7.
- **Company State** — tethr's structured, current representation of the company (idea, stage, decisions, open risks, customers, milestones). Maintained continuously; the thing the "ratchet" invariant improves.
- **Signal** — a research finding about the market/world, typed by source and strength. Aggregated into a **Verdict**.
- **Verdict** — the output of the research pipeline for an idea: `strong signal`, `weak signal`, or `pivot`.
- **Action** — the atomic unit of a Plan. Not a task. Every Action carries: the action itself, the founder requirement, the definition of done, an estimated time, and a status. Chapter 12.
- **Plan** — an ordered, dependency-aware sequence of Actions. Never a flat task list.
- **Experiment** — a validation design targeting the single highest-risk assumption, carrying: hypothesis, success criteria, failure criteria, duration, and sample size. Chapter 13.
- **Proactive loop** — the mechanism by which tethr initiates work from triggers rather than prompts. Chapter 8.
- **Trigger** — an event that can start autonomous work (e.g., verdict landed, thread idle, competitor move).
- **Autonomy grant** — a founder's standing authorization for tethr to perform a specific *class* of action without per-instance confirmation. The unit of the partial-autonomy model. Chapter 5.
- **Intervention** — a tethr-initiated contact with the founder (nudge, accountability check, surfaced decision), governed by the Founder Model's intervention policy.
- **Execution tier** — one of three routing tiers for work: **Tier 1** fast/low-judgment (search, classification, summaries), **Tier 2** high-judgment generation (planning, validation, synthesis, drafting), **Tier 3** long-running autonomous sequences (follow-up chains, voice outreach, background execution). Chapter 20.

---
---

# Chapter 2 — MVP Specification
### *What are we shipping, and when is it done?*

> This chapter is the canonical definition of the MVP. Where any other document, session, or plan implies a different MVP scope, this chapter governs. Its purpose is to make the MVP unambiguous enough that no future working session can misunderstand what the product is at launch.

## 2.1 What the MVP must prove

The MVP exists to validate one claim: **a first-time founder can take a company from nothing to their first real customer conversations entirely through tethr, and the system gets more useful across that arc rather than resetting.** If a founder completes the loop below and tethr felt like a cofounder that remembered and executed — not a chatbot they had to re-brief — the thesis holds. Everything in scope serves that proof; everything that doesn't is deferred.

Concretely, the MVP proves three things at once: that the proactive execution loop works end to end, that the Founder Model (Ch 6) meaningfully personalizes behavior over a single founder's journey, and that messaging-first interaction is enough to feel like a relationship rather than a tool.

## 2.2 Scope

**In scope** — five capabilities plus the substrate they run on:

- **Onboarding** (Ch 3) — seeds the Founder Model, handles the idea / problem-only / no-idea entry paths.
- **Research** (Ch 11) — runs automatically after onboarding; produces a verdict.
- **Planning** (Ch 12) — generates the sequenced plan of Actions.
- **Validation** (Ch 13) — designs one experiment against the highest-risk assumption.
- **Outreach** (Ch 14) — identifies customers, drafts, sends on approval, tracks, follows up.
- **Substrate:** the **Founder Model** (Ch 6), **Messaging** (Ch 10), and enough **Orchestration** (Ch 8) to run the proactive loop.

**Out of scope for the MVP** — deferred to post-MVP builds, not cut from the product:

- **Launch coordination** (Ch 15), **Post-launch iteration** (Ch 16), **Operations** (Ch 17) — Builds 6–8. The MVP stops at first outreach.
- **Voice** (Ch 9) as a launch requirement. The MVP ships **messaging-first**; voice is a **named fast-follow inside the MVP effort** — planned and specced, but the loop must be provable without it. AI voice calling for outreach (Ch 14) is part of that fast-follow, not the launch bar.

The boundary that never moves, MVP or otherwise: tethr builds the company, not the founder's product (§1.6, Ch 15).

## 2.3 The canonical end-to-end journey

This is the loop the MVP must deliver, in order. Each arrow is a handoff the system performs on its own; the founder supplies decisions, not coordination.

1. **Onboarding.** The founder arrives with an idea, only a problem space, or nothing. tethr runs the matching onboarding path, and in doing so seeds the Founder Model's highest-leverage dimensions (capacity, process sophistication, customer-contact disposition; §6.13).
2. **Research (automatic).** Immediately triggered as onboarding establishes enough to work with. tethr runs the pipeline — idea stress-test → competitor landscape → market-signal synthesis → **verdict** (`strong signal` / `weak signal` / `pivot`). The founder did not ask for this; tethr initiated it. This is the first proof of the proactive loop.
3. **Plan.** From the verdict and Company State, tethr generates a sequenced **Plan** of **Actions** (each with action, founder requirement, definition of done, estimate, status — §1.9, Ch 12), grounded in Public Knowledge (Ch 7). The founder can push back on any Action.
4. **Validation.** tethr designs one **Experiment** targeting the single highest-risk assumption (hypothesis, success/failure criteria, duration, sample size — Ch 13).
5. **First outreach.** tethr identifies potential customers, drafts outreach, sends on the founder's approval (or under a standing autonomy grant, Ch 5), tracks replies, and follows up automatically (Ch 14).

Across all five, the Founder Model reads and writes continuously, so step 5 is executed by a system that understands the founder better than it did at step 1. That delta *is* the MVP's product.

## 2.4 Feature ownership

Each capability has one owning system. Ambiguity about ownership is what produces duplicated, drifting implementations; this matrix is the authority.

- **Founder understanding, personalization, all behavioral decisions** → Founder Model (Ch 6). No other system models the founder.
- **Startup-knowledge grounding for plans and experiments** → Public Knowledge (Ch 7). Used by Planning and Validation only; never by Research.
- **Initiation, triggers, scheduling, the proactive loop** → Orchestration (Ch 8).
- **Founder-facing conversation and initiated contact** → Messaging (Ch 10).
- **Market/world signal and verdicts** → Research (Ch 11).
- **The Plan and its Actions** → Planning (Ch 12).
- **The Experiment** → Validation (Ch 13).
- **Prospects, drafts, sending, tracking, follow-up** → Outreach (Ch 14).

## 2.5 Cross-system dependencies

The build order (Ch 25) follows from these; they are stated here so the MVP's critical path is explicit.

- Everything depends on the **Founder Model** and **Messaging** existing first — they are the substrate every capability reads and speaks through. This is why they sit in Build 1 alongside onboarding.
- **Research** depends on onboarding having seeded enough Company State to have something to research.
- **Planning** depends on a **verdict** to sequence against, and on **Public Knowledge** to ground against.
- **Validation** depends on a Plan (to know the highest-risk assumption) and Public Knowledge.
- **Outreach** depends on Validation having identified who the customer is.
- The **proactive loop** (Orchestration) is a dependency of the *feel* of every step — without it, Research doesn't auto-trigger and the product reverts to a chatbot.

## 2.6 Launch requirements

The MVP ships when all of the following are true:

- The full §2.3 loop runs end to end for a single founder without the founder having to coordinate handoffs.
- Research auto-triggers from onboarding (the proactive loop is demonstrably real, not a button).
- The Founder Model persists across the entire loop and visibly personalizes at least the plan pace and the intervention style to the founder's capacity and tendencies (Ch 6).
- Messaging supports real bidirectional, event-triggered conversation on at least one primary channel (Ch 10), with the founder able to respond naturally while tethr continues executing.
- Outreach can draft, send on approval, track, and auto-follow-up.
- The autonomy model (Ch 5) is in place at least to the extent that no irreversible action (sending, later calling) occurs without either a standing grant or explicit confirmation.

Voice is explicitly *not* on this list.

## 2.7 Definition of "MVP complete"

**The MVP is complete when a single first-time founder can, entirely through tethr and without coordinating any handoff themselves, go from onboarding to their first real customer outreach — passing through an auto-triggered research verdict, a sequenced plan, and one validation experiment — with the Founder Model persisting and personalizing across the whole arc, over messaging, without voice.**

Reaching launch (Ch 15) is not required. Building the founder's product is never required. Anything past first outreach is post-MVP. Anything short of the sentence above is pre-MVP.

---
---

# Chapter 3 — Onboarding & Founder Seeding
### *How does tethr build its first model of a founder?*

## 3.1 What onboarding is for

Onboarding has two jobs that run at once: establish enough **Company State** to start working, and seed the **Founder Model** (Ch 6) so tethr's behavior is personalized from the first real interaction. It is not a form and not a tutorial. It is the first conversation with a cofounder, and it is the moment the "founder never re-explains their company" invariant (§1.7) starts being kept.

Everything onboarding gathers is a means to the auto-triggered research that follows (§3.4). It collects what Research needs and what the Founder Model needs at cold start (§6.13), and nothing else — a founder made to answer questions that don't change tethr's behavior is a violated principle.

## 3.2 Three entry paths

Founders in this segment (§1.5) arrive in one of three states, and onboarding branches on which:

- **Has an idea.** tethr captures the idea precisely enough to stress-test it, then moves fast to Research. The risk here is a founder over-attached to an unvalidated idea; onboarding records the idea as a hypothesis, not a fact.
- **Has a problem space only.** tethr works with the founder to frame the problem sharply enough that Research can look for signal around it and Planning can sequence toward an idea. No idea is invented on the founder's behalf; the problem is made researchable.
- **Has nothing yet.** tethr helps surface a starting direction from the founder's interests, frustrations, and context — enough to enter the problem-space path. It does not hand the founder a business; it gives them a place to start.

The path taken is itself an early Founder Model signal (about process sophistication and conviction), and it sets the shape of the first plan.

## 3.3 What onboarding seeds

Into **Company State**: the idea or problem, the stage, and any people/context the founder names.

Into the **Founder Model**, initial low-confidence reads (§6.13) on the highest-leverage dimensions — deliberately the ones that most change early behavior:

- **Capacity & availability** (family A) — how much time the founder actually has, their life context. This alone reshapes the entire first plan's pace and sizing.
- **Process sophistication** (family G) — how much of the build sequence they already hold, which sets how much scaffolding and how narrow a surface tethr starts with (§6.10).
- **Customer-contact disposition** (family D) — the earliest read on the segment's defining failure mode, gathered gently.
- **Communication preference** (family F) — channel, cadence, tone, so the very first messages already fit.

These are seeded from what the founder *says*; the revealed reads (§6.7) accumulate only once they start acting. So onboarding produces a stated-heavy, low-confidence model — correct behavior for cold start, and the reason tethr's early policy is conservative (§6.13).

## 3.4 Handoff to Research

The instant onboarding establishes enough to research, tethr **triggers Research on its own** — the founder does not ask. This is the product's first proof that it initiates rather than waits (§1.1, Ch 8), and the first handoff the founder didn't have to coordinate. Onboarding therefore ends not with a summary screen but with tethr already at work, telling the founder what it's doing.

---
---

# Chapter 4 — Interaction Model & Product Shell
### *How do founder and tethr communicate?*

## 4.1 Three surfaces, one relationship

tethr is reached through three surfaces, but they are windows onto one continuous relationship and one Founder Model — not three products.

- **Messaging (primary).** The default surface and the one the MVP ships on (Ch 2, Ch 10). "As easy as texting a friend" (§1.4) is literal: most of the relationship happens here, in real bidirectional conversation on the founder's own channel.
- **Voice (fast-follow).** A first-class conversational surface (Ch 9), not a launch requirement. Designed to feel like talking to a cofounder, not dictating to software.
- **App / dashboard (support).** Where the structured objects live — the Plan, the current Experiment, Company State — for when the founder wants to *see* the company rather than talk about it. It supports the conversation; it is not where the work is driven from. A founder who never opens it should still be able to run their company through messaging alone.

## 4.2 The shell

The app shell is deliberately thin and adaptive. Its permanent anchors are the **current Plan** (Ch 12), the **active Experiment** (Ch 13), the **outreach threads** (Ch 14), and **Company State** (§1.9) — the founder's view of where the company is. What is visible beyond those anchors is governed by capability routing (§6.10): the shell simplifies for novice, low-capacity founders and expands for sophisticated, high-capacity ones, with no settings screen doing the work. The interface is an output of the Founder Model, not a fixed layout.

## 4.3 Canonical objects, as the founder sees them

The founder interacts with the same canonical objects defined in §1.9, presented consistently everywhere:

- An **Action** always shows its definition of done, what it needs from the founder, and its status — so "what do you want me to do" is always answerable.
- A **Plan** is shown as a sequence with dependencies, never a flat checklist, so the founder sees *why this next*.
- An **Experiment** shows its hypothesis and its success/failure criteria up front, so the founder knows what would count as learning.
- A **Verdict** shows its signal strength and the evidence behind it.
- **Company State** is the always-current answer to "where is my company," maintained by the ratchet invariant (§1.7).

## 4.4 Confirmation and approval

Because tethr executes, the moments where it hands a decision back must be crisp. A confirmation request states plainly what tethr will do, why now, and what happens on approval — and for anything irreversible, approval is explicit (Ch 5). Confirmation is the trigger for execution on non-granted actions (§1.7); the UX therefore treats "approve" as "go," not "acknowledged." Approvals are frictionless for reversible work and deliberate for irreversible work.

## 4.5 The cadence surface

tethr-initiated contact (nudges, accountability, surfaced decisions) is not a notification stream. It arrives as messages, timed and paced by the intervention policy (§6.12) — reaching the founder when they can act, backing off when they're overloaded. The founder can always adjust cadence in words ("ease off this week"), and that adjustment is a Founder Model signal, not a buried setting.

---
---

# Chapter 5 — Trust, Autonomy & Control
### *Where is the line between "confirm" and "execute"?*

## 5.1 The model: partial, founder-set autonomy

tethr executes by default, but the founder controls *which* executions require their sign-off. The mechanism is **partial autonomy set per action-class**: during use, tethr asks the founder which classes of action they want to grant standing autonomy for; those the founder grants, tethr performs without per-instance confirmation. Everything else requires confirmation, and **that confirmation is what triggers execution** (§1.7). The founder can grant, narrow, or revoke any class at any time, in words.

This is the concrete form of "founder confirms, tethr executes" (§1.6): it is neither full autonomy (which would violate the founder's decision rights) nor confirm-everything (which would reduce tethr to a chatbot that drafts). The founder chooses their own line and can move it as trust builds.

## 5.2 Autonomy grants

An **autonomy grant** (§1.9) is a standing authorization for a class of action, not a blanket setting. Grants are scoped — a founder might grant "run research and draft outreach freely" while withholding "send outreach" and "place voice calls." Two properties keep grants safe:

- **Grants are legible.** The founder can always see what they've authorized and what still requires confirmation; nothing is autonomous that the founder didn't knowingly make autonomous.
- **Grants are revocable and adjustable in conversation.** "Stop sending without checking me" narrows a grant immediately, and is recorded as a Founder Model signal (about reversibility comfort and deference, family C).

The Founder Model's **deference** read (§6.3) calibrates how tethr *proposes* grants — a founder who consistently approves outreach may be offered a grant for it — but the model never grants autonomy to itself. A confident read is not consent (§6.9).

## 5.3 Irreversible actions

Some actions are hard or impossible to undo, and these get extra guarding regardless of grants:

- **Sending** anything to a real third party (outreach messages).
- **Calling** — AI voice outreach (fast-follow), which is both irreversible and high-stakes for the company's reputation.
- **Spending**, if and when tethr can incur cost on the founder's behalf.

For these classes, the default is confirmation, and a standing grant must be given *deliberately and explicitly* — the founder cannot drift into autonomous irreversible action. Even under a grant, tethr surfaces what it did promptly, so autonomy never means invisibility.

## 5.4 Auditability

Every action tethr takes — autonomous or confirmed — is recorded and reviewable: what it did, when, under which grant or confirmation, and why. This is what makes autonomy safe to extend: the founder can always reconstruct what their cofounder did on their behalf. Auditability also feeds the Founder Model's policy-reweighting (§6.9) and is the backing for the Decision Log (Ch 23) at the company level.

---
---

# Chapter 6 — The Founder Model
### *How does tethr know the founder, and how does that knowledge decide what tethr does?*

> Derives from Chapter 24 (§24.11). This chapter turns those design commitments into mechanism. Where a value or rule is marked **(v0, to calibrate)**, it is a starting proposal to be tuned empirically, not a frozen constant.

## 6.1 One system, two jobs

The Founder Model is a single system with two jobs. Its **memory job** is to hold everything tethr knows about the founder and their company. Its **policy job** is to convert that knowledge into tethr's actual behavior — what to do next, when to reach out, what to show, how hard to push. Founder Memory, the Behavioral Model, and the Memory Harness (source-material names) are all this one system; they are not components that can be built or reasoned about separately.

This is the design choice that separates tethr from every system surveyed in Chapter 24. Those systems stop at the memory job: they store facts and retrieve them, trusting the model to "honor" what it reads. The Founder Model does not stop there. **It is a policy, not a profile.** Its output is not "here is what I know about this founder" but "given what I know, here is what tethr should do right now." Everything in this chapter serves that conversion.

## 6.2 Four layers

The model is organized as four layers, each an abstraction over the one below — the hierarchical-abstraction idea from GraphRAG (§24.9), applied to a person rather than a corpus. Reads for behavior happen at the top; writes enter at the bottom and propagate up in the background.

1. **Episodes** — the raw, append-only log of what happened: messages, actions taken, approvals, deadlines set and met or missed, outreach sent and answered, features used or ignored. Nothing is deleted here; this is the ground truth everything else is derived from and can be re-derived from.
2. **Graph** — entities and typed relationships extracted from episodes: the founder, their companies, ideas, decisions, commitments, fears, milestones, people, and the relationships among them. This is the *company and life* content — relational, queryable, provenance-linked back to the episodes that produced each fact. Facts here are bi-temporal (§6.4) and invalidated rather than deleted when superseded.
3. **Traits** — the typed **behavioral dimensions**: the model of *how this founder builds* (§6.3). Each is an estimate abstracted from many episodes and graph facts, carrying confidence, temporality, provenance, and a stated-vs-revealed split. This is the layer that makes the model behavioral rather than merely factual.
4. **Policy** — the decision functions that read Traits + Graph + Company State + live triggers and emit tethr's behavior: next action, intervention, feature exposure, app recommendation, plan adaptation, communication style (§6.9–6.12). The policy is itself learned — it reweights based on what worked for this founder (§6.9).

A useful test of the separation: a question like "what is this founder's company called?" is answered at the Graph layer; "should tethr push this founder to book customer calls this week, and how hard?" is answered at the Policy layer using the Traits layer. Only the second kind is unique to tethr.

## 6.3 The dimension taxonomy

Traits are **typed and opinionated** — a fixed, extensible set of named dimensions, not open-ended facts. Being domain-scoped to exactly one question (*how does this founder build companies?*) is what licenses the opinionation: we can enumerate the axes that matter and refuse the ones that don't.

The set below is organized into seven families. It is deliberately larger than a personality profile and is **explicitly extensible** — new dimensions are added as we learn which reads change behavior. A dimension earns its place only if some Policy decision (§6.9–6.12) actually consumes it; a dimension no policy reads is dead weight and is not added.

**A. Capacity & availability** *(mostly state-like — short half-lives, §6.6)*
- Available time per week — the hours the founder can realistically spend. Gates plan pace, action sizing, and intervention frequency; a plan the founder has no time to execute is a broken plan.
- Working rhythm — when in the day/week they actually act (drives intervention timing).
- Session length / attention — how long they sustain focus (drives how much tethr surfaces at once).
- Current load & burnout risk — how close to overextended they are right now. **A safety-bearing dimension** (§6.14): it can veto intervention intensity regardless of what execution would otherwise call for.
- Life context — job alongside, school, other commitments that bound everything above.

**B. Execution**
- Velocity — how fast they move from decision to done.
- Follow-through — completion rate on committed actions.
- Action-vs-analysis bias — do they ship or do they deliberate.
- Cadence consistency — regular progress vs bursts and stalls.

**C. Risk & decision**
- Risk appetite.
- Decisiveness — speed and stability of decisions.
- Reversibility comfort — willingness to make hard-to-undo calls (informs which approvals to even ask for, and the autonomy model, Ch 5).
- Deference — how much they follow tethr's recommendations vs override them (calibrates how directive tethr should be).

**D. Market & customer orientation**
- Customer-contact avoidance — the single highest-leverage first-time-founder failure mode (§1.5); tracked explicitly.
- Build-first vs validate-first tendency.
- Rejection tolerance — comfort with outreach and being told no.

**E. Motivation & psychology**
- Motivation drivers — what actually energizes them (visible progress, competition, recognition, autonomy, mission). Selects the motivational strategy (§6.12).
- Accountability responsiveness — do they respond to a hard push or a soft nudge (selects accountability style).
- Confidence stability — how setbacks affect them (drives whether tethr steadies or challenges).
- Avoidance points — specific work they flinch from (prime intervention targets, especially where stated ≠ revealed).

**F. Communication**
- Preferred channel and cadence.
- Tone and directness preference.
- Verbosity preference — how much detail they want back.
- Response latency — how fast they typically reply (informs follow-up timing, not judgment).

**G. Skill & sophistication**
- Technical vs non-technical strengths.
- Process sophistication — how much of the company-building sequence they already hold (a repeat-ish founder needs less scaffolding; §1.5).
- Skill gaps — where tethr must do more, or teach.

Families A and E are the ones the surveyed systems have no analogue for and where most of tethr's behavioral leverage lives.

## 6.4 Anatomy of a dimension

Every Trait is not a value but a small record:

- **Estimate** — the current read (a scalar, a category, or a range).
- **Confidence** ∈ [0,1] — how much tethr should trust this read (§6.6).
- **Valid-time / ingestion-time** — bi-temporal, from Zep/Graphiti (§24.6): when the read holds true of the founder, and when tethr learned it. Superseded reads are **invalidated, not deleted**, so tethr never silently contradicts itself and can explain how its read changed.
- **Provenance** — links down to the episodes/facts that produced the read; every trait is auditable to its evidence.
- **Stated estimate vs revealed estimate** — two parallel reads: what the founder *says* about themselves, and what their *behavior* shows (§6.7). Kept separate on purpose; their divergence is signal, not noise.
- **Half-life** — the dimension-specific decay rate (§6.6).

## 6.5 Learning: how the model updates

**Hot-path read, background write** (from LangMem's two-mode writing, Mem0's async pipeline, OpenAI's Dreaming; §24.11). During a live interaction, tethr *reads* the model — retrieval must be cheap and fast, so nothing expensive happens on the critical path. The *writing* — extraction, abstraction, reconciliation — runs asynchronously after the turn and on schedules/triggers, so it can be as expensive as it needs to be without slowing the founder down.

The write path, bottom-up:
1. **Log.** Every interaction and outcome appends to Episodes verbatim.
2. **Extract.** A background pass pulls entities, facts, and relationships into the Graph (invalidating superseded facts, not deleting).
3. **Abstract.** A background pass rolls episodes and facts up into Trait updates — e.g., "set a deadline, missed it" and three prior similar episodes abstract into a downward revision of Follow-through and a note on Cadence consistency. This is the GraphRAG-style consolidation that turns many small events into a durable higher-order read no single episode contains.
4. **Reconcile.** Stated and revealed estimates are updated separately; divergences past threshold are flagged (§6.7).
5. **Reweight policy.** Outcomes of past tethr behavior feed back into the Policy layer (§6.9) — the memify idea from Cognee (§24.8) applied to decisions, not just graph edges.

**Corrections are first-class, high-weight signals.** When the founder tells tethr it's wrong about them ("I'm not avoiding customers, I've just been slammed"), that correction updates the model strongly and immediately, and is preserved with provenance. The "knowledge compounds" invariant (§1.7) means a correction that doesn't change future behavior is a bug.

## 6.6 Confidence and decay

**Confidence** rises with corroborating observations, weighted by recency and by source, and falls when observations conflict. Revealed observations carry more weight than stated ones; direct founder corrections carry the most. A single episode never produces a high-confidence trait; corroboration is required, which protects against over-fitting to noise. **(v0, to calibrate.)**

**Decay** pulls an unreinforced estimate back toward a neutral prior over time, at a **dimension-specific half-life**, because different traits are stable to different degrees:
- State-like dimensions decay fast — *available time*, *current load/burnout*, *working rhythm* can change week to week, so a read that isn't refreshed should lose confidence quickly rather than act on stale life-context (the exact failure OpenAI's Dreaming fixes for facts, §24.3).
- Trait-like dimensions decay slowly — *risk appetite*, *motivation drivers*, *process sophistication* are comparatively stable; reads persist.

Decay acts on **confidence**, not the estimate: tethr doesn't flip its guess about a founder when it hasn't heard lately, it becomes less sure and its policy grows more conservative (§6.9). **(v0: half-lives per dimension to be set empirically.)**

## 6.7 Stated vs revealed reconciliation

The most behaviorally important rule in the model. For any dimension where it applies, tethr holds two estimates and **never silently overwrites stated with revealed**.

- For **action policy**, revealed behavior wins. If the founder says they'll do customer calls but never does, tethr plans and pushes based on the avoidance it observes, not the intention it was told.
- The **divergence itself is a primary signal**. A large stated-vs-revealed gap on customer-contact avoidance is not a data-quality problem to resolve away — it is exactly the diagnostic that selects an intervention (§6.12): the founder who *wants* to talk to customers but *avoids* it needs a different push than one who neither wants to nor does.
- The gap is **surfaced to the founder** when it's relevant and useful, never weaponized. tethr names the pattern kindly and in service of the company, consistent with the natural-not-robotic principle (§1.7) and the wellbeing guardrails (§6.14).

## 6.8 Retrieval

The Policy layer reads the model through a **hybrid of graph traversal and semantic retrieval** (convergent across Zep, Mem0g, Cognee; §24.11), fused: graph traversal for relational and behavioral reasoning ("what has this founder committed to and not done, and how does that relate to their available time?"), semantic retrieval for recall ("have we discussed pricing before?"). Retrieval is scoped and cheap by construction because the expensive abstraction already happened on the write path — at read time the Traits are already computed.

## 6.9 From model to behavior: the action policy

The policy is a function from **(Company State, Traits, Graph, live triggers)** to tethr's decisions. It is not a black box and not a single prompt; it is a set of decision procedures, each reading specific dimensions, each producing a specific kind of behavior. The five behavior families follow in §6.9–6.12. Common properties across all of them:

- **Confidence-gated.** Low confidence in the relevant dimensions makes the policy conservative — tethr defaults to asking rather than assuming, and to gentler, less frequent action. High confidence licenses more decisive, more proactive behavior. This is how the model avoids acting boldly on guesses.
- **Self-improving.** Each decision's outcome is fed back: an intervention that worked, a recommended feature the founder adopted, a nudge that was ignored. The policy reweights toward what works *for this founder* (memify-style, §24.8). What motivates or lands is discovered, not assumed.
- **Subordinate to the founder's decision rights.** The policy shapes what tethr *does and surfaces*; it never overrides the founder's authority over decisions or the autonomy boundaries of Chapter 5 (§1.6). A confident read is not consent.

The most direct output is **next-action selection**: given the plan (Ch 12), the company's highest-risk open question, and the founder's current capacity and tendencies, which Action does tethr surface, do, or hold. A founder with two available hours this week and low follow-through gets a different next step than the same company with a high-capacity, high-velocity founder.

## 6.10 Capability routing and feature recommendations

Features are not all visible at once. **Capability routing** exposes a feature when the model shows the founder is ready for it and would benefit — gated on stage, demonstrated need, and capacity — and keeps it out of the way otherwise. This is *interface simplification as a policy output*, not a static settings screen.

- Voice outreach (Ch 9, 14) surfaces after the founder has done text outreach, not before.
- Operations monitoring (Ch 17) is irrelevant pre-launch and stays hidden.
- A novice, low-capacity founder sees a deliberately narrow surface; a sophisticated, high-capacity one sees more. (Process sophistication and capacity dimensions drive this.)

The point is that the product's apparent complexity adapts to the founder without any manual configuration — the personalization the source material asked for, produced by the model rather than by settings.

## 6.11 Connected-app recommendations

tethr recommends connecting an external app when the model detects **demonstrated need plus capacity to adopt** — never speculatively. The trigger is behavioral: the founder is repeatedly doing work an integration would carry, and they have the slack to onboard it. A recommendation fired on a guess, or dumped on an overloaded founder, is a policy failure. Adoption outcomes feed back into the policy like any other decision (§6.9).

## 6.12 Intervention strategy

An **intervention** is any tethr-initiated contact (nudge, accountability check, surfaced decision). The intervention policy reads the model to decide four things:

- **Timing** — driven by *available time* and *working rhythm* (reach the founder when they can actually act), by momentum (nudge when the model detects a stall in *cadence consistency*), and by trigger events. Bad timing burns trust faster than almost anything.
- **Cadence** — matched to *communication preference* and *current load*; tethr backs off when the founder is overloaded and leans in when they're idle and stalling. Frequency is a dial the model sets, not a fixed schedule.
- **Accountability style** — matched to *accountability responsiveness* and aimed by *stated-vs-revealed gaps*: tethr pushes hardest exactly where the founder says they'll do something and doesn't. Hard push for those who respond to it, soft nudge for those who don't.
- **Motivational strategy** — matched to *motivation drivers*: frame progress for the progress-driven, a target to beat for the competitive, recognition for the recognition-driven, control for the autonomy-driven.

**Interface adaptation** is the quiet fifth output: the model simplifies or expands what the founder sees (§6.10), and adjusts message length and directness to *verbosity* and *tone* preferences, so the whole product's texture matches the person.

## 6.13 Cold start

Before tethr knows the founder, the model is seeded by onboarding (Ch 3), which is designed to populate initial reads on the highest-leverage dimensions (capacity, process sophistication, idea/problem/none state, customer-contact disposition). At cold start every dimension is **wide prior, low confidence**, so the policy is conservative by construction: tethr asks more, assumes less, pushes gently, and exposes a narrow surface, then earns the right to be more proactive as confidence accrues. The failure to avoid is a confident, wrong read on day one; low initial confidence is the safeguard.

## 6.14 Failure modes and safeguards

- **Wrong reads.** The model is **inspectable and correctable** by the founder (Anthropic's transparency posture over ChatGPT's invisible profiling; §24.2–24.3). The founder can see what tethr believes about them and correct it; corrections are the highest-weight signal (§6.5).
- **Over-fitting to noise.** Required corroboration, confidence gating, and decay prevent a single odd episode from reshaping behavior (§6.6).
- **Harmful reinforcement — the central safety risk.** A model that optimized purely for execution would push a burning-out founder toward more work. It must not. *Current load / burnout risk* (family A) can **veto** intervention intensity regardless of what execution would call for; tethr protects the founder's wellbeing over the company's velocity when they conflict. The model never reinforces self-destructive patterns even if they'd move the company forward.
- **Gaming.** A founder could try to shape tethr's beliefs by what they say; revealed-over-stated weighting (§6.7) limits this naturally.
- **Autonomy erosion.** The model informs behavior but never overrides the founder's decision rights or Chapter 5's autonomy boundaries (§6.9, §1.6). It makes tethr a better cofounder, not a controlling one.
- **Privacy.** The model is the most sensitive asset in the system; it is inspectable, correctable, and deletable by the founder, and it is the reason the moat exists (§1.8) — which raises, not lowers, the bar on handling it.

## 6.15 Calibration (v0)

These are concrete starting values, chosen to be reasonable and internally consistent, to be tuned against real founder data. They are *specified*, not left open — implementation has a definite target. "v0" means "the first values we measure against," not "guess later." The **shapes** below are design commitments and don't change without a recorded decision (Ch 23); the **constants** are expected to move.

**Evidence and source weights.** Each observation contributes evidence weight `w = source_weight × recency_factor`. Source weights (v0): direct founder correction 1.0; revealed behavior 0.7; behavioral proxy (e.g. PostHog usage) 0.5; stated self-report 0.4. `recency_factor` is the decay term (below) at the observation's age. Corrections dominate and revealed beats stated, by design (§6.5, §6.7).

**Confidence** (saturating). `net_evidence = Σ w(corroborating) − Σ w(conflicting)`, floored at 0. `confidence = 1 − exp(−k · net_evidence)`, `k = 0.5` (v0): ~3 corroborating revealed observations (~2.1 net) → ~0.65; a lone correction → ~0.39 and climbs fast with any corroboration. Confidence never reaches 1.0 — no read is certain.

**Decay half-lives** (v0), acting on **confidence**, not the estimate (§6.6): `confidence(t) = confidence · 2^(−Δt / half_life)` since last reinforcement. By family:
- Capacity/availability — load & burnout **1 wk**, available time **2 wk**, working rhythm **3 wk**, life context **4 wk** (state-like; a stale capacity read must not drive action).
- Execution **6 wk** · Market/customer orientation **6 wk** · Communication **8 wk**.
- Risk & decision **12 wk** · Motivation & psychology **14 wk** (most stable).
- Skill & sophistication — skill gaps **6 wk** (they close), process sophistication **16 wk** (grows slowly).

**Stated-vs-revealed reconciliation.** Both estimates normalized to [0,1]; `divergence = |stated − revealed|`. A reconciliation event fires when `divergence > 0.3` **and** revealed-confidence `> 0.5` (v0). Below that, hold both silently. On fire: revealed governs action policy, the gap becomes a candidate intervention (§6.12), and it's surfaced to the founder when useful (§6.7). The gate stops tethr acting on noisy early revealed reads.

**Policy scoring.** Each candidate behavior scores `base_fit(relevant dimensions) × confidence_gate × learned_weight`.
- `confidence_gate` = mean confidence of the dimensions the candidate reads — low confidence suppresses aggressive behavior, producing the conservative cold-start posture (§6.13).
- `learned_weight` starts at 1.0, updates multiplicatively by outcome (v0: ×1.15 positive, ×0.85 ignored/negative), bounded [0.5, 2.0], decaying toward 1.0 with a 10-week half-life so stale learning fades (memify-style, §6.9).
- The top-scoring behavior is taken only if it clears an action threshold; otherwise tethr asks rather than acts (degrade-to-asking, §8.5).

**Burnout veto** (hard gate, not a weight). When load & burnout confidence `> 0.5` and its estimate is in the top band, intervention intensity is capped and pace-increasing actions are suppressed regardless of scoring (§6.14). Wellbeing outranks velocity.

**Still open:** empirical tuning of every constant above (that's what v0 means), and the extensible dimension set beyond §6.3, added only as a policy consumes each new dimension.

---
---

# Chapter 7 — Public Knowledge & Grounding
### *What canonical startup knowledge grounds planning and validation?*

## 7.1 What it is

Public Knowledge is a read-only corpus of canonical startup knowledge — roughly nineteen thousand embedded chunks drawn from sources such as Paul Graham, Steve Blank, SaaStr, and First Round Review. It is the received wisdom of how companies get built, made retrievable. It is **not** part of the Founder Model, holds nothing about any individual founder, and is never written to during use.

## 7.2 What it grounds — and what it doesn't

Public Knowledge is used by exactly two capabilities: **Planning** (Ch 12) and **Validation** (Ch 13). When tethr sequences a plan or designs an experiment, it grounds those against this corpus so the advice embedded in tethr's execution reflects known practice rather than improvisation.

It is deliberately **not used by Research** (Ch 11). Research is about the live state of a specific market — current demand, present competitors, real complaints — and received wisdom is the wrong input for that; it would bias a live read toward the general and the stale. The separation is a correctness decision: Planning/Validation want durable principles, Research wants current signal, and mixing them degrades both. This is why the corpus and the live research sources are kept apart in the architecture (Ch 21).

## 7.3 How grounding works

At plan or experiment generation, the relevant Public Knowledge chunks are retrieved semantically and supplied as grounding context to the Tier-2 generation (Ch 20). The corpus informs *how* to sequence and *how* to design experiments; it never dictates the specific company. The founder's own situation — from the Founder Model and Company State — always takes precedence over the general principle when they conflict; grounding is a floor of competence, not an override of context.

## 7.4 Why it's a separate system

Keeping Public Knowledge distinct from the Founder Model matters for three reasons: it is shared across all founders (the Founder Model is private to one), it is static and curated (the Founder Model is live and earned), and it must never leak into the personal model or vice versa. One is the library; the other is the relationship. Chapter 6 is the moat; this chapter is table stakes tethr simply must have to give competent plans.

---
---

# Chapter 8 — Agent Orchestration & Execution Model
### *What makes tethr agentic rather than reactive?*

## 8.1 The proactive loop

The single mechanism that makes tethr a cofounder rather than a chatbot is the **proactive loop**: tethr initiates work from events, not only from founder prompts. A tethr that only responds is broken (§1.1). The loop runs continuously — watching for triggers, deciding via the Founder Model's policy (§6.9) whether and how to act, executing the reversible part, and surfacing only what needs the founder.

Two things start execution: a **trigger** firing (below), or the **founder's confirmation** of a proposed action (§1.7). For action-classes under a standing autonomy grant (Ch 5), the trigger alone is sufficient; for everything else, the loop pauses at confirmation and the founder's approval is what releases it.

## 8.2 Trigger taxonomy

Triggers are the events the loop watches. The MVP-relevant classes:

- **Stage transitions** — onboarding establishing enough to research auto-starts Research (§3.4); a verdict landing prompts Planning; a plan forming prompts the first Validation design.
- **Founder events** — a reply, a pushback on an Action, a correction to the model, a change in stated capacity.
- **Time / momentum events** — an Action stalling past its estimate, a deadline arriving, an outreach thread going quiet, a founder going idle mid-plan. These drive interventions (§6.12).
- **World events** (post-MVP, Operations) — competitor moves, market shifts, new customer feedback (Ch 17).

Whether a fired trigger becomes an action, and how forceful that action is, is decided by the Founder Model's policy — the same trigger produces a hard nudge for one founder and silence for an overloaded one (§6.12). Orchestration owns *detecting* triggers; the Founder Model owns *deciding* the response.

## 8.3 The three execution tiers

Work routes to one of three tiers (§1.9; model routing in Ch 20):

- **Tier 1 — fast, low-judgment:** search, classification, summarization. Cheap, frequent, latency-sensitive.
- **Tier 2 — high-judgment generation:** planning, validation design, research synthesis, outreach drafting. The reasoning-heavy work where quality matters more than speed.
- **Tier 3 — long-running autonomous sequences:** follow-up chains, voice outreach (fast-follow), background execution that spans time. These run detached from any single interaction and report back through Messaging.

A single loop iteration may touch all three: a Tier-1 classification of an incoming reply, a Tier-2 decision about next action, a Tier-3 scheduled follow-up.

## 8.4 Scheduling and long-running work

Because tethr initiates and because much of its value is follow-through over time, orchestration includes durable scheduling and background execution — work that persists across sessions and continues while the founder is away. Tier-3 sequences (chasing an unanswered outreach thread over days, running an experiment's duration) are the clearest case. The design requirement is that a long-running sequence survives the founder closing the app and resumes correctly — continuity is the product (§1.3).

## 8.5 Failure handling

Autonomous, long-running work fails in ways a request-response chatbot doesn't, so the loop is built to fail safely: transient failures retry with backoff; repeated failure surfaces to the founder rather than silently dropping; and no irreversible action is retried blindly (a failed send is confirmed, not re-fired, to avoid double-contact). Every action's outcome — success or failure — is recorded for auditability (§5.4) and feeds policy reweighting (§6.9). The governing rule: when uncertain, tethr degrades toward asking the founder, never toward acting harder.

---
---

# Chapter 9 — Voice System
### *How does tethr talk and listen in real time?*

> Voice is a first-class interface but a **fast-follow**, not an MVP launch requirement (Ch 2). This chapter specifies it; the MVP loop must be provable without it.

## 9.1 Posture

Voice should feel **conversational, not transactional** — talking with a cofounder, not issuing commands to software. That posture drives every choice below: low latency over feature count, natural turn-taking over rigid prompt-response, continuity with the same Founder Model and Company State that messaging uses. Voice is another window onto the one relationship (§4.1), not a separate assistant.

## 9.2 Capabilities

- **Realtime speech-to-speech.** Full duplex conversation over a WebSocket transport (Ch 21), fast enough that the founder talks rather than waits. Built on Photon / the Spectrum SDK (engineering detail in Ch 21).
- **Mid-conversation web search.** tethr can pull live information into a spoken conversation without breaking flow — the founder asks about a competitor and tethr answers from a fresh look, mid-sentence.
- **Voice cloning.** Supports cloned voices, which is what makes AI voice calling viable as a founder-representative channel rather than an obviously-synthetic one.
- **AI voice calling for outreach.** Outbound calls to prospects on the founder's behalf (Ch 14). This is the highest-stakes voice capability and the reason voice inherits strict autonomy treatment.

## 9.3 Autonomy and stakes

Placing a voice call to a real person is **irreversible and reputation-bearing for the company**, so it sits in the most-guarded action class (§5.3): explicit, deliberate authorization required, never drifted into, and always surfaced promptly after. Voice cloning raises the bar further — a cloned-voice call made without clear authorization is exactly the kind of action the autonomy model exists to prevent. Voice's power is why its guardrails are the tightest in the product.

---
---

# Chapter 10 — Messaging System
### *How does tethr hold a real, ongoing conversation with the founder?*

## 10.1 First-class, not notifications

Messaging is the primary surface (§4.1) and the channel the MVP ships on. The defining stance: these are **real conversations, not notifications**. A notification is a one-way ping the founder dismisses; a tethr message is a turn in an ongoing relationship the founder can answer, and answering continues the work. Anything that reduces messaging to alerts violates the "as easy as texting a friend" constraint (§1.4).

Three properties define it:

- **Bidirectional.** The founder responds naturally, in their own words, and tethr understands and acts. There is no command syntax.
- **Event-triggered.** Messages originate from the proactive loop's triggers (Ch 8) and the intervention policy's timing (§6.12), not from a fixed schedule or only from founder prompts.
- **Persistent.** The thread is continuous and backed by the Founder Model, so the conversation never resets and the founder never re-explains (§1.7).

## 10.2 Channels

- **Primary:** iMessage and WhatsApp — the channels these founders already live in, which is the point: tethr meets them where they are rather than making them come to an app.
- **Fallback:** SMS / RCS, for reach when a primary channel isn't available.

The founder's channel and cadence preferences are Founder Model reads (family F, §6.3), so which channel and how often are personalization outputs, not global settings.

## 10.3 Delivery, routing, identity

Messaging must route the right message to the right channel for the right founder and keep one coherent thread across channels — a founder who moves from WhatsApp to SMS is still in one conversation with one model behind it. Identity and thread continuity across channels are the core engineering requirements (schemas in Ch 19, channel integrations in Ch 21). Delivery is reliable and ordered; a dropped or duplicated tethr-initiated message erodes the cofounder feel quickly.

## 10.4 Execution continuity

The property that makes messaging feel like a cofounder rather than a chat app: **the founder can respond naturally while tethr keeps executing.** A reply is not a blocking request-response — it is input to work that is already underway. The founder answers a question about pricing and tethr folds it into the plan without stopping; the founder goes quiet and tethr keeps running the Tier-3 sequences (Ch 8) and surfaces results when they land. The conversation and the execution run in parallel, which is the whole difference from a chatbot.

---
---

# Chapter 11 — Research
### *How does tethr judge whether an idea has signal?*

## 11.1 Live, not static

Research reads the current state of a specific market, so its inputs are live signal sources, never the received wisdom of Public Knowledge (Ch 7). The distinction is load-bearing: a plan should reflect durable principles, but a verdict on an idea must reflect what is true in the market *now* — present demand, present competitors, present complaints. Mixing the two degrades the verdict. Research is the first proof of the proactive loop, because it auto-triggers from onboarding without the founder asking (§3.4, Ch 8).

## 11.2 Sources, typed by signal

Sources are not equal and are not treated equally:

- **Primary: xAI X Search** — real-time public conversation, the freshest read on demand, sentiment, and emerging complaints.
- **Supporting: Hacker News** — technical-audience reaction and early-adopter signal.
- **Supporting: Serper** — general web/search-result presence, competitor surface, and market framing.
- **Supporting: Crunchbase** — funded competitors, funding momentum, market maturity.

Each source carries a different *type* of signal (live sentiment vs funded competition vs technical reception). Research **synthesizes** across them rather than averaging them — a funded competitor from Crunchbase and a wave of complaints from X are different evidence that must be weighed differently, not summed (Ch 20, Tier-2 synthesis).

## 11.3 The pipeline

Four stages, in order:

1. **Idea stress-test** — pressure the idea's core assumptions before spending signal-gathering effort.
2. **Competitor landscape** — who already does this, how funded, how entrenched.
3. **Market-signal synthesis** — fuse the typed sources into a coherent read of demand, competition, pricing, and complaint themes.
4. **Verdict.**

## 11.4 Outputs

The headline output is a **Verdict** (§1.9): `strong signal`, `weak signal`, or `pivot`. Alongside it, Research produces the substance Planning and later stages consume: market demand, competitor landscape, pricing signal, complaint themes, market opportunities, and — when the verdict is `pivot` — concrete pivot suggestions. Every output is evidence-linked so the founder can see *why* the verdict is what it is (§4.3). A `pivot` verdict routes back into the loop rather than ending it: it reshapes Company State and re-enters at Planning.

---
---

# Chapter 12 — Planning
### *How does tethr decide what the founder should do next?*

## 12.1 A sequenced plan, not a task list

Planning produces an ordered, dependency-aware **Plan** of **Actions** — never a flat checklist. The difference is the product: a first-time founder's core deficit is knowing *what next and why now* (§1.5), so a plan that doesn't encode sequence and dependency has failed at its only job. The Plan is generated automatically from the verdict and Company State, and re-sequenced as reality changes (§12.4).

## 12.2 The Action

Every **Action** (§1.9) carries five fields, and all five are mandatory:

- **Action** — what is to be done.
- **Founder requirement** — what tethr needs from the founder to proceed (often nothing; tethr does the reversible part itself).
- **Definition of done** — the concrete condition that closes it, so "done" is never subjective.
- **Estimated time** — sized against the founder's *available time* read (family A, §6.3), so the plan fits the founder's actual capacity.
- **Status.**

An Action missing any field is malformed. The founder can push back on any Action, and pushback is both re-planning input and a Founder Model signal (deference, conviction; §6.3).

## 12.3 Grounding and personalization

Plans are grounded in Public Knowledge (Ch 7) so sequencing reflects known practice, and personalized by the Founder Model so pace, action sizing, and next-step selection fit this founder (§6.9). The two combine as floor-plus-fit: Public Knowledge sets a competent baseline, the Founder Model adapts it. Where they conflict, the founder's real situation wins (§7.3).

## 12.4 Re-planning

The Plan is live. It re-sequences on triggers (Ch 8): a stalled Action, a founder capacity change, a validation result, a pivot verdict. Re-planning is not starting over — it is the ratchet (§1.7) applied to sequence, preserving what's done and re-ordering what remains. A plan that goes stale because reality moved and tethr didn't re-sequence is a failure of the proactive loop.

---
---

# Chapter 13 — Validation
### *How does tethr test the riskiest thing before the founder builds?*

## 13.1 Highest-risk-assumption targeting

Validation designs an **Experiment** against the *single highest-risk assumption* in the plan — the one whose failure would most cheaply kill the idea. It does not test everything; it tests the thing most worth knowing first. This directly counters the segment's defining failure mode (§1.5): building before validating. tethr's job here is to make the founder learn before they invest, and to make the unglamorous customer-facing test the obvious next step.

## 13.2 The Experiment

An **Experiment** (§1.9) carries: a **hypothesis**, **success criteria**, **failure criteria**, a **duration**, and a **sample size**. Success and failure criteria are both explicit and set in advance, so the result is interpretable rather than rationalized after the fact — the founder knows before running it what outcome would count as learning, and what would count as a kill or pivot signal.

## 13.3 Grounding and reading results

Experiments are grounded in Public Knowledge (Ch 7) for sound design. When results land, tethr reads them against the pre-set criteria and routes the outcome back into the loop: a pass advances the plan, a fail feeds re-planning or a pivot (Ch 12, Ch 11). Validation is also where Outreach begins, because the highest-risk assumption is usually about the customer — which means the experiment often *is* the first customer contact (Ch 14).

---
---

# Chapter 14 — Outreach
### *How does tethr get the founder in front of real customers?*

## 14.1 The MVP's finish line

Outreach is where the MVP loop ends (Ch 2): the founder's first real customer conversations. It is also where the segment's avoidance shows up most, so the intervention policy (§6.12) pushes hardest exactly here, aimed by the customer-contact-avoidance dimension and any stated-vs-revealed gap (§6.7).

## 14.2 The flow

1. **Identify** potential customers.
2. **Draft** outreach, personalized per prospect.
3. **Send on approval** — or under a standing autonomy grant (Ch 5). Sending to a real person is irreversible and therefore in the most-guarded action class (§5.3): explicit authorization, never drifted into, always surfaced after.
4. **Track** conversations across threads.
5. **Follow up automatically** — a Tier-3 long-running sequence (Ch 8) that chases quiet threads over days without the founder managing it.

## 14.3 Voice calling

AI voice calling (Ch 9, fast-follow) extends outreach from text to calls. It inherits the tightest guardrails in the product — irreversible, reputation-bearing, cloned-voice — and is never a launch-bar capability. Text outreach must fully work first; capability routing (§6.10) won't even surface voice outreach until the founder has done text outreach.

## 14.4 Continuity

Outreach state lives in Company State and the Founder Model, not a separate CRM (§1.6): tethr tracks conversations as a means to validation and iteration, not as a system of record to administer. A reply is input to work already underway (§10.4) — tethr reads it, updates the model, and advances the loop.

---
---

# Chapter 15 — Launch
### *What does tethr coordinate at launch, and what does it refuse to do?*

> Post-MVP (Build 6). Specced here for completeness; not part of the MVP loop (Ch 2).

## 15.1 The hard line

tethr coordinates launch execution. **tethr does not build the founder's software.** This is the load-bearing boundary of the entire company (§1.6): tethr is a cofounder for the company, not a coding agent or no-code builder for the product. Everything in this chapter sits on the coordination side of that line, and nothing crosses it.

## 15.2 Scope

Launch coordination means orchestrating the sequence of things that make a launch happen around the product the founder built — the checklist, the timing, the dependencies, the outreach and announcement work that tethr *can* own — and surfacing to the founder the pieces only they can do. It is the same Plan/Action machinery (Ch 12) pointed at a launch, grounded and personalized the same way, run through the same proactive loop. The founder ships their product; tethr makes the launch around it happen.

---
---

# Chapter 16 — Post-launch Iteration
### *How does tethr turn what happens after launch into the next move?*

> Post-MVP (Build 7).

Post-launch, tethr does three things in a loop: **capture feedback** from customers and usage, **synthesize patterns** across that feedback rather than reacting to individual points, and **maintain an iteration backlog** that feeds back into Planning (Ch 12). The synthesis step is the value — a first-time founder drowns in scattered feedback; tethr's job is to abstract it into "here is the pattern and here is the next Action," the same consolidation move the Founder Model makes on behavioral signal (§6.5). The backlog is not a static list; it re-enters the plan through the ratchet (§1.7).

---
---

# Chapter 17 — Operations & Company State
### *How does tethr keep the company's picture current over time?*

> Post-MVP (Build 8).

## 17.1 Continuous monitoring

Operations is tethr running in the background over the long term, watching what changes around the company: competitors, market shifts, and incoming customer feedback. These are world-event triggers (§8.2) that can start work or interventions on their own — the proactive loop applied not to a single journey but to the ongoing life of the company.

## 17.2 Company State as the through-line

The artifact Operations maintains is **Company State** (§1.9) — tethr's always-current model of where the company is, kept true over time by the ratchet invariant (§1.7). Every stage in the handbook reads from and writes to it; Operations is the stage that keeps it alive after the initial journey completes. It is the reason a founder returning after weeks away finds tethr already current rather than needing to be re-briefed — the same "never re-explain" invariant (§1.7), extended across the company's whole lifespan.

---
---

# Chapter 18 — System Architecture
### *How do the pieces fit together?*

## 18.1 Shape

tethr is a proactive-loop system, not a request-response app. At the center is the **Orchestration loop** (Ch 8) reading triggers and driving work through the **Founder Model** (Ch 6), which decides behavior, against **Company State**. Work executes across three tiers (Ch 20) and reaches the founder through **Messaging** (Ch 10) and, fast-follow, **Voice** (Ch 9). The capability stages (Research, Planning, Validation, Outreach, and post-MVP Launch/Post-launch/Operations) are consumers of that substrate, not independent apps.

## 18.2 Stack (chosen — greenfield)

Nothing is built yet; this is the selected stack, not a description of a running system.

- **Frontend / app shell:** Next.js 16, TypeScript, Tailwind CSS v4, deployed on Vercel.
- **Backend / data:** Supabase (PostgreSQL) with pgvector for embeddings.
- **Model layer:** provider-agnostic routing across tiers (Ch 20).
- **Durable execution:** a managed event-driven workflow layer, separate from Vercel (§18.3).
- **Voice:** Photon / Spectrum SDK over WebSocket (Ch 9, Ch 21).
- **Email/outreach delivery:** Resend.
- **Live research sources:** xAI X Search, Serper, Crunchbase (Ch 11, Ch 21).
- **Observability:** PostHog, Sentry (Ch 22).

Next.js 16 and Tailwind v4 are current selections; the source's GPT-4o model pin is discarded (Ch 20).

## 18.3 Durable execution (the core engineering decision)

tethr initiates and runs long-horizon work (Ch 8), so it cannot be a request-scoped app. Vercel functions serve the synchronous surface — app shell, inbound webhooks, API — but the proactive loop, Tier-3 sequences, scheduled memory consolidation, and multi-day follow-up chains need durable background execution that survives the founder closing the app and survives process restarts. This is the primary engineering build-out beyond standard app plumbing.

**Decision:** a dedicated, event-driven durable-workflow layer, separate from the Vercel request path. For an early-stage team, use a managed durable-execution service (Inngest / Trigger.dev class — event triggers, step-level retries, and `sleep until <time>` for day-spanning waits, without hand-rolling cron-plus-state). Temporal is the heavier escape hatch if durability needs outgrow that; it is not the starting choice.

**The proactive loop** is realized as three trigger intakes (§8.2), each firing a durable workflow: inbound events (channel webhooks, founder replies), scheduled scans (a periodic sweep for time/momentum triggers — stalls, idle threads, arriving deadlines), and internal events (verdict landed → plan, plan formed → validation). Execution state lives in the workflow engine; company/founder state lives in Postgres; the two join by ID.

**Idempotency is mandatory** on every external action (send, call, spend): each carries an idempotency key so a retry after partial failure cannot double-act (§8.5, §5.3). This is the rule that makes durable retries safe next to irreversible actions — without it, "retry" and "irreversible" are incompatible.

The Founder Model's **background write path** (§6.5) runs on this layer too: consolidation, abstraction, and reconciliation jobs are scheduled per founder and also triggered after interactions, kept off the hot read path.

---
---

# Chapter 19 — Data Model & Schemas
### *What is stored, and how is it shaped?*

> Storage lives in Supabase/PostgreSQL with pgvector. This chapter fixes the conceptual shape; concrete column-level schemas are to be specified against it and are an open item.

## 19.1 The Founder Model store

The four layers of Chapter 6 map to storage as follows:

- **Episodes** — append-only event log; the immutable ground truth. Never updated in place.
- **Graph** — entities (founder, companies, ideas, decisions, commitments, fears, milestones, people) and typed, bi-temporal relationships (§6.4): each edge carries valid-time and ingestion-time and is invalidated, not deleted, on supersession. Represented in Postgres (adjacency/edge tables) rather than a separate graph database unless scale forces otherwise (open item).
- **Traits** — the typed behavioral dimensions (§6.3), each a record with estimate, confidence, valid/ingestion time, provenance links to episodes, and separate stated/revealed estimates (§6.4).
- **Policy** — decision procedures with per-founder reweighting state (§6.9).

Semantic retrieval across Graph and Episodes uses pgvector embeddings; graph traversal uses the relational edges. Retrieval is the hybrid of the two (§6.8).

## 19.2 Public Knowledge store

Roughly 19k embedded chunks in pgvector, read-only, entirely separate from the Founder Model store (Ch 7), queried only by Planning and Validation.

## 19.3 Company and workflow objects

Canonical objects (§1.9) are first-class rows: **Company State**, **Plans** and their **Actions** (with the five mandatory Action fields, §12.2), **Experiments** (§13.2), **Verdicts** and their evidence, and **outreach threads**. Each links back to the founder and into the Founder Model's provenance.

## 19.4 Messaging and identity (concrete)

One founder must present as one continuous thread across channels. Schema:

- `founders(id, …)`.
- `channel_identities(id, founder_id → founders, channel_type ∈ {imessage, whatsapp, sms, rcs}, address, verified_at, is_primary)`. A founder has many; each is one address on one channel.
- `messages(id, founder_id, channel_identity_id, direction ∈ {in, out}, body, channel_message_id, status, created_at)`. The logical thread is `messages` filtered by `founder_id`, ordered by `created_at` — channel-agnostic by construction.

**Inbound resolution:** a webhook's `(channel_type, address)` resolves to a `channel_identity`, hence a `founder`; unrecognized addresses route to onboarding linkage (Ch 3). Ordering and dedup use `channel_message_id` + `created_at`; `status` tracks delivery for reliability (§10.3).

The same phone number across iMessage / SMS / WhatsApp yields distinct `channel_identities` under one `founder`, so cross-channel continuity is automatic (§10.3). This is the schema most likely to bite if deferred, so it is fixed here rather than left open.

---
---

# Chapter 20 — Model Routing
### *Which model does which work?*

## 20.1 Provider-agnostic by construction

Every model call goes through one internal routing abstraction (an adapter over providers — LiteLLM / OpenRouter-style, or a thin in-house router), never direct provider SDK calls scattered through the codebase. Swapping a model is then a config change, not a migration (§1.8). This is non-negotiable: the frontier moves monthly, and pinning is exactly how a build accrues migration debt. The source's **GPT-4o pin is discarded.**

## 20.2 Tier-to-model (v0 candidates, mid-2026)

Route by *judgment required and latency tolerance*, not by task name. The names below are current-generation and **illustrative** — the router benchmarks and swaps them; no single name is canonical.

- **Tier 1 — fast, cheap** (classify, extract, summarize, route): a small fast model — Claude Haiku 4.5, Gemini 3.5 Flash / Flash-Lite, or a GPT-5.4-mini-class model; open models (DeepSeek V4, GLM-5.x) where cost dominates and self-hosting is viable. Optimize time-to-first-token, not benchmark peak.
- **Tier 2 — high judgment** (planning, validation design, research synthesis, outreach drafting): a frontier model — Claude Opus 4.8, GPT-5.5, or Gemini 3.1 Pro (these cluster within a few points on the Artificial Analysis Intelligence Index; Gemini 3.1 Pro is notably cheaper per token). A mid model (Claude Sonnet 5, GPT-5.4) is the cost-optimized default for lighter Tier-2 work, reserving the frontier for the hardest generations.
- **Tier 3 — long-running sequences:** orchestrates Tier-1/2 calls; model choice is per-step, not per-sequence.

Because research already depends on xAI (X Search, Ch 21), Grok 4.x is a natural candidate for research-adjacent synthesis if consolidating that provider is useful.

## 20.3 Fallback

Each tier has a primary and a **cross-provider** fallback (e.g. Opus 4.8 → GPT-5.5), so a single provider's outage or rate-limit doesn't halt the loop. The hard rule: an irreversible action (Ch 5) is **never** auto-retried across a fallback without its idempotency key (§18.3) — failover must not cause double-contact. The specific fallback vendors and the router library are a class-decided, vendor-open item (§25.3).

---
---

# Chapter 21 — External Integrations & APIs
### *What does tethr connect to, and why?*

- **xAI X Search** — primary live research signal (§11.2): real-time demand, sentiment, complaints.
- **Serper** — web/search-result presence and competitor surface (supporting research signal).
- **Crunchbase** — funded-competitor and funding-momentum signal (supporting research signal).
- **Resend** — outbound email delivery for outreach (Ch 14).
- **Photon / Spectrum SDK** — realtime speech-to-speech and voice cloning over WebSocket (Ch 9); the fast-follow voice stack.
- **Messaging channels** — iMessage, WhatsApp, SMS/RCS providers (Ch 10); the primary founder-facing surface and the integration set with the hardest identity/continuity requirements (§19.4).

Each research source contributes a *different type* of signal and is synthesized, not averaged (§11.2). Integrations that touch real third parties (Resend sending, messaging channels, voice calling) are the ones bound by the autonomy model (Ch 5).

---
---

# Chapter 22 — Infrastructure, Deployment & Observability
### *How is it run and watched?*

- **Deployment:** Vercel (Next.js frontend and serverless functions). Durable background/scheduled execution for the proactive loop and Tier-3 sequences is the piece that exceeds a stock Vercel request model and needs explicit provisioning (open item, §18.3, Ch 25).
- **Data:** Supabase (managed Postgres + pgvector).
- **Product analytics:** PostHog — founder behavior and funnel through the journey loop; also a source of revealed-behavior signal that can feed the Founder Model (§6.5).
- **Error monitoring:** Sentry — with particular importance for autonomous, long-running work, where silent failures (Ch 8) are the dangerous kind and must surface.

The observability priority specific to tethr: because the system acts on its own, monitoring must make *autonomous* actions and their outcomes visible and auditable (§5.4), not just track errors.

---
---

# Chapter 23 — Decision Log
### *What has been decided, and why?*

Canonical decisions to date. Each is binding until amended here; the reasoning is recorded so future sessions don't relitigate settled questions or silently reverse them.

- **Founder Memory, Behavioral Model, and Memory Harness are one system — the Founder Model** (2026-07-06). They share storage and policy; splitting them produces duplicated, drifting designs. Public Knowledge remains separate. (§1.9, Ch 6)
- **The Founder Model is a policy, not a profile** (2026-07-06). Its output is tethr's behavior, not a description of the founder — the differentiator no surveyed system provides. (§6.1, §24.10–24.11)
- **MVP ends at first customer outreach** (2026-07-06, founder-approved). Launch, post-launch, and operations (Builds 6–8) are post-MVP. (Ch 2)
- **Messaging-first; voice is a fast-follow inside the MVP effort** (2026-07-06, founder-approved). The loop must be provable over text without voice. (Ch 2, Ch 9)
- **Partial, founder-set autonomy per action-class; confirmation triggers execution** (2026-07-06). Neither full autonomy nor confirm-everything; the founder sets their own line. Irreversible actions (send, call, spend) are most-guarded. (Ch 5)
- **Public Knowledge grounds Planning and Validation only, never Research** (from source). Research needs live signal; grounding it in received wisdom would bias the verdict. (Ch 7, Ch 11)
- **Positioning is coordinator, not tool** (from source). tethr owns company state and sequencing and calls other capabilities as instruments. (§1.4)
- **tethr builds the company, not the founder's product** (from source). The load-bearing boundary; crossing it turns tethr into a dev tool. (§1.6, Ch 15)
- **Research sources are typed and synthesized, not averaged** (from source). Different sources carry different signal types. (§11.2)
- **The model layer is provider-agnostic; the GPT-4o pin is treated as stale** (2026-07-06). Route each tier to the current-best model; model quality is a rented input, not the moat. (Ch 20, §1.8)
- **Greenfield: nothing is built; the source stack is chosen, not existing** (2026-07-06). Supabase/Postgres/pgvector, Next.js 16, Tailwind v4, Vercel are the selected stack; all "as built" language is a plan. (Ch 18)
- **Durable execution via a managed event-driven workflow layer** (2026-07-06), separate from Vercel's request path; idempotency keys mandatory on all irreversible actions. (§18.3)
- **Founder Model calibration v0 committed** (2026-07-06): saturating confidence, exponential decay on confidence with per-family half-lives, stated-vs-revealed gate (0.3 / 0.5), multiplicative bounded policy learning, hard burnout veto. The shapes are decisions; the constants are tunable. (§6.15)
- **Messaging identity is channel-agnostic** (2026-07-06): one founder, many `channel_identities`, one thread. (§19.4)

Open decisions carried forward: empirical tuning of the §6.15 calibration constants; the specific workflow service and model-router library (class decided, vendor open); column-level schemas beyond messaging identity (Ch 19); the extensible dimension set as new policies are defined (§6.3).

---
---

# Chapter 24 — Research Notes
### *What does the state of the art in agent memory get right and wrong, and what does tethr take from it?*

**Why this chapter exists.** The Founder Model (Ch 6) is tethr's differentiator and its least-specified system. Before designing it, we studied the current landscape of agent-memory and long-term-memory systems. The objective is *not* to copy any of them. It is to locate the mechanisms worth borrowing and — more importantly — the modeling gaps that these systems share, because those gaps are where tethr's proprietary advantage lives. Chapter 6 is built on the synthesis at the end of this chapter (§24.10–24.11).

External systems are described in our own words from their papers, docs, and engineering posts (dated where relevant); nothing here is a canonical tethr commitment except §24.11.

## 24.1 A working taxonomy

The literature — including the December 2025 survey *Memory in the Age of AI Agents* — converges on a few orthogonal axes. We use them to place each system and, later, to place tethr.

- **Content type.** *Semantic* (facts and preferences), *episodic* (specific past interactions/events), *procedural* (rules and behaviors that shape how the agent acts). LangMem makes this trichotomy explicit; most others implement a subset.
- **Structure.** *Flat* (a list/store of memory items) vs *graph* (entities and typed relationships) vs *hierarchical* (communities/abstractions over the graph).
- **Temporality.** *Static* (facts assumed permanently true) vs *temporal* (facts carry validity intervals and can be invalidated as the world changes).
- **Write timing.** *Hot-path* (memory updated inline during the turn) vs *background* (memory synthesized asynchronously after the turn, or on a schedule).
- **Who governs memory.** *LLM-governed* (the model decides what to store/update via tool calls) vs *mechanical/pipeline* (a fixed extract→consolidate→store pipeline) vs *hybrid*.

The single most important observation for tethr: **every system below models memory as information to retrieve. None models the user as a decision policy** — i.e., they answer "what is true about the user," but not "therefore what should the system *do*." That gap is §24.10.

## 24.2 Anthropic — memory tool + context management

*Source: Claude Platform docs; "Effective harnesses for long-running agents," "Building agents with the Claude Agent SDK" (Sept 2025).*

A file-system-metaphor memory: the agent creates, reads, updates, and deletes files in a persistent `/memory` directory that survives sessions. It operates **client-side** — the model requests file operations; the application executes them — so the developer controls storage and can inspect exactly what is written (a transparency advantage over invisible background profiling). It pairs with **context editing** (clearing stale tool results from the active window) and **compaction** (server-side summarization near the context limit). Anthropic reports large gains in long-horizon tasks from combining memory with context editing.

The load-bearing pattern is the **initializer/worker split** for long-running work: the first session sets up durable artifacts (a progress log, a checklist, a reference file); each later session resumes from the state the last one recorded, treating memory as a *recovery mechanism* across context windows.

- **Strength.** Transparent, inspectable, developer-controlled; the just-in-time discipline (record what you learn, read it back on demand) keeps active context focused. The initializer/worker pattern is directly relevant to tethr's need for continuity across sessions.
- **What it misses for tethr.** Memory is unstructured files; there is no native entity/relationship model, no temporal validity, and — crucially — no coupling between memory and *product behavior*. It is a substrate for building memory, not an opinionated model of a person.

## 24.3 OpenAI / ChatGPT — saved memories + "Dreaming"

*Source: OpenAI "Memory and new controls" (2025), "Dreaming: better memory" (June 2026); OpenAI Help Center.*

Two mechanisms. **Saved memories** are discrete facts, either explicitly requested ("remember I'm vegetarian") or auto-detected, injected into every conversation and user-editable. **Chat-history reference** — internally the **"Dreaming"** system — synthesizes a *profile* from past conversations in the **background**, rather than storing a hand-edited list. Dreaming explicitly handles **temporal staleness**: it revises "you're going to Singapore in July" into "you went to Singapore in July" once the trip passes, so recommendations don't act on expired context.

- **Strength.** The background-synthesis-into-a-profile idea, and the explicit treatment of memory going stale over time, are both directly on-point for a system that models an evolving founder. The two-track split (explicit facts vs synthesized profile) is a clean pattern.
- **What it misses for tethr.** The profile is *descriptive personalization* ("tailor responses"), not a *policy* that drives actions, feature exposure, or interventions. It is largely invisible and non-inspectable (a repeated user complaint), and it is general-purpose, so it cannot be opinionated about a specific domain.

## 24.4 LangGraph / LangMem

*Source: LangChain docs; LangMem launch post; DeepLearning.AI course.*

LangGraph separates **short-term** (thread-scoped session state via a checkpointer) from **long-term** (cross-thread, namespaced via a `BaseStore`). **LangMem** layers the explicit **semantic / episodic / procedural** trichotomy on top, with an LLM-driven Memory Manager that decides what to store, update, or delete, and supports both **hot-path and background** writing. Its genuinely differentiated idea is **procedural memory as a self-editing system prompt**: the agent rewrites its own operating instructions based on accumulated experience — no equivalent in Mem0 or Zep.

- **Strength.** The clearest content-type taxonomy in production, and procedural-memory-as-self-editing-policy is the closest existing analogue to what tethr's decision layer must do.
- **What it misses for tethr.** Procedural memory here edits a prompt; it does not drive structured product behavior (which feature to surface, when to intervene, which app to recommend). Still general-purpose and ecosystem-bound; early/unstable API.

## 24.5 MemGPT / Letta

*Source: MemGPT paper (Packer et al., 2023); Letta docs and engineering blog.*

The originating idea: treat the LLM as a process on a memory-constrained OS. Context window = RAM; the model **manages its own memory via tool calls** across three tiers — **core memory** (small, in-context, editable blocks), **recall** (searchable conversation history), and **archival** (unbounded external store, queried by tool). Letta productized this into a full stateful-agent runtime where *persistence is the default* — the agent has to actively *not* call the memory tools to forget.

- **Strength.** Persistence-by-default and the memory-block abstraction (structured, functional, model-editable units of context) are elegant and battle-tested. The OS framing clarifies how information should flow in and out of the working set.
- **What it misses for tethr.** Consolidation is agent-driven and the open-source path lacks write-side dedup/temporal primitives; it is a general agent runtime, not a model of a person's behavior. "Adopt Letta" means adopting an entire platform, not a memory of the founder.

## 24.6 Zep / Graphiti

*Source: Zep paper (Rasmussen et al., 2025); Graphiti docs (Neo4j/Zep).*

A **temporal knowledge graph** for agent memory. Graphiti ingests conversation and structured data into an entity-relationship graph where the defining feature is **bi-temporal modeling**: every edge (fact) carries both *valid time* (when it was true in the world) and *ingestion/transaction time* (when the system learned it). When new information contradicts an old fact, Graphiti **invalidates rather than deletes** — it closes the old fact's validity window and records the new one, preserving history and avoiding self-contradiction. Retrieval fuses semantic, keyword, and graph search. Outperforms MemGPT on the DMR benchmark and holds up on the harder LongMemEval.

- **Strength.** This is the right answer to "the truth about a person changes over time, and you must not contradict yourself." Bi-temporality, edge invalidation (not deletion), and provenance back to source episodes are all directly needed by tethr.
- **What it misses for tethr.** It is a graph of *facts*. It has no notion of behavioral traits, confidence in a trait, decay of a preference, or the gap between what a user *says* and what they *do* — and, again, no coupling from graph to action.

## 24.7 Mem0 / Mem0g

*Source: Mem0 paper (Chhikara et al., 2025); Mem0 docs, v3 evaluation (Apr 2026).*

A production memory layer built as a **two-phase pipeline**: *extract* salient facts from each user/assistant exchange, then *update* against similar existing memories, where an LLM chooses ADD / UPDATE / DELETE / NOOP. Optimized hard for cost and latency (reported ~90% token savings, ~91% lower p95 vs full-context). **Mem0g** adds a graph variant (entities as nodes, relationships as labeled edges) with conflict detection that marks relationships invalid rather than deleting, for temporal reasoning. The v3 (2026) design shifted to **ADD-only extraction** — new facts stored alongside old, nothing overwritten — with parallel retrieval scoring across semantic, keyword (BM25), entity, and temporal signals.

- **Strength.** The clearest, cheapest production extract→consolidate loop; ADD-only + invalidate-don't-delete preserves temporal context; multi-signal fused retrieval is a good template.
- **What it misses for tethr.** Purpose-built for conversational fact recall. No behavioral abstraction, no hierarchical structure over memories, no action policy. Deliberately thin — a memory layer, not a model of a person.

## 24.8 Cognee

*Source: Cognee docs and blog (2026); Cognee paper (arXiv 2505.24478).*

Graph-native memory built on an **ECL pipeline — Extract, Cognify, Load**: ingest heterogeneous sources; `cognify` runs a multi-stage LLM pipeline (classify, chunk with cross-document coreference, extract entities/relationships, summarize, embed) into a hybrid graph+vector store; optional **RDF/OWL ontology validation** grounds extracted entities in a formal schema (additive — falls back to LLM-only if absent). Its differentiated layer is **`memify`**: a self-improvement pass that prunes stale nodes, reweights edges by usage signals, and derives new facts — feedback loops make the graph sharper with use rather than a passive store.

- **Strength.** Ontology-grounding (impose a *schema* on extraction, don't accept open-ended facts) and `memify` (memory as a self-improving structure, edges reweighted by feedback) are both directly applicable to a domain-specific, opinionated founder model.
- **What it misses for tethr.** General document-knowledge orientation; no behavioral bi-temporality, no intervention/routing layer. Self-improvement operates on graph quality, not on a policy over actions.

## 24.9 Microsoft GraphRAG

*Source: "From Local to Global" (Edge et al., 2024); Microsoft Research blog; GraphRAG docs.*

Not a personal-memory system — a retrieval architecture — but it contributes the mechanism the personal-memory systems all lack. GraphRAG extracts an entity graph from a corpus, runs **Leiden community detection** to cluster related entities **hierarchically**, and pre-generates an LLM **summary ("community report") for each community at each level**, with higher-level summaries built from lower-level ones. Queries route through **Local search** (fan out from specific entities), **Global search** (map-reduce over community summaries for corpus-wide "what are the themes" questions), or **DRIFT** (a hybrid). It beats naive vector RAG substantially on holistic questions.

- **Strength.** Hierarchical abstraction over a graph is exactly how you turn *many episodes* into *higher-order traits*. "Summarize this founder's whole behavior" is a global-search question; no personal-memory system above answers it, because none builds abstractions above the fact level.
- **What it misses for tethr.** Batch and static (no temporality, no incremental update); corpus retrieval, not a live evolving model of a person; expensive to index. We take the *idea*, not the pipeline.

## 24.10 The shared gap

Placed on the taxonomy (§24.1), the field clusters tightly: fact-oriented, retrieval-oriented, general-purpose. Four gaps are shared by nearly all of them, and together they define tethr's opening.

1. **Profile, not policy.** Every system answers "what is true about the user." None answers "therefore what should the system *do* — which action to surface, whether to intervene now, which app to recommend, how hard to push." Memory is decoupled from behavior; the LLM is merely trusted to "honor" retrieved memory once it is in context (and persona-drift research shows it often doesn't).
2. **No behavioral temporality or confidence.** Zep/Graphiti and Mem0g handle temporal *facts* well (valid-time, invalidation). None models a *behavioral trait* with a confidence level, a decay rate, or a principled way to reconcile **stated vs revealed** behavior — what the founder *says* they'll do versus what they repeatedly *do*.
3. **No behavioral abstraction.** GraphRAG builds hierarchical abstractions over a corpus; personal-memory systems stay at the fact/episode level. None consolidates "declined 3 customer calls, shipped 4 features unprompted, missed 2 self-set deadlines" into a durable higher-order trait like *builds fast, avoids customer contact, over-commits on timelines*.
4. **Domain-blind, therefore un-opinionated.** All are general. A memory scoped to exactly one domain — *how this founder builds companies* — can be **typed and opinionated**: fixed behavioral dimensions, a fixed action vocabulary, and an ontology (à la Cognee) instead of open-ended facts.

## 24.11 Design commitments for the Founder Model

What tethr borrows, and the decisions Chapter 6 will implement. *(These are canonical direction; Chapter 6 specifies mechanism.)*

- **The Founder Model is a policy, not a profile.** Its output is not "facts about the founder" but *decisions*: which action to surface, whether/when to intervene, which feature or app to expose, how to adapt the plan and the communication style. This is the deliberate answer to gap #1 and the core of tethr's differentiation. *(from the gap in every system; procedural-memory-as-policy from LangMem, taken further into structured product behavior)*
- **Typed behavioral dimensions with confidence and decay.** Not open-ended facts — a fixed, opinionated set of dimensions (e.g., execution speed, customer-contact avoidance, follow-through, risk appetite, accountability responsiveness), each carrying a confidence level and a decay so that stale reads fade unless reinforced. *(answers gap #2; ontology discipline from Cognee)*
- **Bi-temporal, invalidate-don't-delete.** Behavioral reads carry valid-time and ingestion-time; superseded reads are invalidated and preserved, never deleted, so tethr never contradicts itself and can explain how its read of the founder changed. *(directly from Zep/Graphiti)*
- **Stated-vs-revealed reconciliation.** The model explicitly tracks the divergence between what the founder declares and what they do, and weights revealed behavior — this is the raw material for accountability strategy. *(fills gap #2)*
- **Hierarchical behavioral abstraction.** Background consolidation rolls episodes up into higher-order traits, GraphRAG-style, so tethr can reason about the founder globally, not just recall isolated facts. *(from GraphRAG; answers gap #3)*
- **Hot-path read, background write.** Retrieval on the critical path stays cheap and typed; the expensive synthesis, abstraction, and reconciliation run in the background, on a schedule and on triggers. *(from LangMem's two-mode writing, Mem0's async pipeline, OpenAI's Dreaming)*
- **Hybrid graph + semantic retrieval.** Graph traversal for relational/behavioral reasoning, semantic for recall, fused — as the source material already specified for Founder Memory. *(convergent across Zep, Mem0g, Cognee)*
- **Inspectable and correctable.** Following Anthropic's transparency posture over ChatGPT's invisible profiling: the founder can see and correct what tethr believes about them, and corrections propagate (the "knowledge compounds" invariant, §1.7).
- **Self-improving policy, not just self-improving graph.** Cognee's `memify` reweights graph edges by feedback; tethr extends the idea to the *decision layer* — intervention timing, routing, and recommendations reweight based on what actually worked for this founder.

*Open question carried into Chapter 6:* the exact dimension set, the confidence/decay formulation, and the contradiction-resolution rule between stated and revealed behavior are not yet fixed and are the first things Chapter 6 must specify.

---
---

# Chapter 25 — Roadmap
### *In what order is tethr built, and where does it stand?*

## 25.1 Build sequence

The build order follows the dependencies in §2.5: substrate first, then the journey in the order a founder travels it.

- **Build 0 — Knowledge corpus.** The ~19k-chunk Public Knowledge store (Ch 7). Prerequisite for grounded Planning and Validation.
- **Build 1 — Substrate + entry.** Onboarding (Ch 3), Messaging (Ch 10), the Founder Model (Ch 6), and the behavioral layer. This is the largest and most important build: everything downstream reads the Founder Model and speaks through Messaging, and the Founder Model is the moat (§1.8). Cold-start seeding (§6.13) ships here.
- **Build 2 — Research** (Ch 11). First proof of the proactive loop via auto-trigger from onboarding.
- **Build 3 — Planning** (Ch 12).
- **Build 4 — Validation** (Ch 13).
- **Build 5 — Outreach** (Ch 14). **Completing Build 5 completes the MVP** (Ch 2).
- **Build 6 — Launch** (Ch 15). *Post-MVP.*
- **Build 7 — Post-launch iteration** (Ch 16). *Post-MVP.*
- **Build 8 — Operations** (Ch 17). *Post-MVP.*

The voice fast-follow (Ch 9) is sequenced against the MVP effort but off the critical path — after Build 1's messaging substrate, and not gating any build.

## 25.2 Dependencies that constrain the order

- Build 1 must precede everything (substrate).
- Build 2 (Research) needs onboarding's seeded Company State.
- Build 3 (Planning) needs a verdict (Build 2) and Public Knowledge (Build 0).
- Build 4 (Validation) needs a Plan (Build 3).
- Build 5 (Outreach) needs Validation's customer identification (Build 4).
- The proactive loop / durable background execution (Ch 8, §18.3) is a cross-cutting prerequisite for the *feel* of Builds 2–8 and is the main non-app-plumbing engineering investment.

## 25.3 Current state and open items

Greenfield: nothing is built yet; the sequence above is the plan. The design-level open items flagged in v0.3 are now **resolved at design level**:

- Founder Model calibration → §6.15 (v0 constants committed).
- Durable background execution → §18.3 (managed event-driven workflow layer, idempotency mandatory).
- Messaging identity schema → §19.4 (channel-agnostic; concrete).
- Model re-selection + fallback → Ch 20 (provider-agnostic router, per-tier candidates, cross-provider fallback; GPT-4o discarded).

**Genuinely open, to resolve during build:**

- Empirical tuning of the §6.15 constants against real founder data — they are v0 by definition, and the whole calibration is meant to be measured, not assumed.
- The specific workflow service (Inngest / Trigger.dev / Temporal) and model-router library — class decided, vendor not.
- Column-level schemas for the rest of §19 beyond messaging identity.
- The extensible dimension list beyond §6.3, added as each new policy that consumes a dimension is defined.

These are the questions the first weeks of building should close; they are the right place for the next design work.

---

*End of handbook v0.4. All 25 chapters drafted; the v0.3 engineering open items are resolved at design level (§6.15, §18.3, §19.4, Ch 20). Subsequent revision should empirically tune the §6.15 calibration constants, pick the workflow and router vendors, flesh out remaining column-level schemas (Ch 19), and update the Decision Log (Ch 23) as new decisions are made.*
