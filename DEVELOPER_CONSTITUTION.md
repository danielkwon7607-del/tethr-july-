# Developer Constitution

*The immutable engineering principles of tethr. This document is not documentation and not a style guide. It is the set of commitments every engineering session — human or Claude Code — is bound by. It changes rarely, and only by the amendment process in Article XV. Where a lower-level document (ENGINEERING_OS.md, a plan, a comment) conflicts with this one, this one wins.*

The company handbook defines **what** we build. This constitution defines **how** we build, and what we will not do to ship faster.

---

## I. The Handbook is the constitution above this one

The product handbook is the single source of truth for the product. We implement it; we do not author it in code. No requirement, behavior, entity, or rule enters the system unless it exists in the handbook first. When we discover something the product must do that the handbook doesn't specify, that is not permission to invent it — it is a signal to stop and amend the handbook (Article XIV). Product behavior is never born in a pull request.

## II. Confusion halts work

Ambiguity is a stop condition, not a thing to resolve by guessing. When the handbook is unclear, when two readings are possible, or when a decision would commit us to something irreversible, we stop, name exactly what is unclear, present the options with their tradeoffs, and get a resolution before writing code. A silent guess that happens to be wrong is more expensive than the question we didn't ask. This is the most-violated principle under time pressure, which is why it is second.

## III. The best code is the code we never wrote

We delete before we add and we reuse before we build. Every line is a liability someone maintains forever. We do not add abstraction for a single use, configurability nobody asked for, or error handling for impossible states. Before writing new code we ask, in order: does this need to exist at all, can existing code do it, can the platform or standard library do it, is a dependency justified. Simplicity is a feature we ship on purpose — not an accident we settle for. This applies with equal force to the product's own philosophy: tethr succeeds by doing less than a chatbot, not more.

## IV. Maintainability outranks convenience, and compounding quality outranks speed

We optimize for the engineer reading this code in six months, not the one writing it today. The handbook says the company's moat is a model that *compounds* over time; our engineering compounds the same way or it undermines the thesis. A shortcut that saves an hour now and costs a day later is a loss we refuse to book. We would rather ship one build slower and healthier than three builds faster and rotting.

## V. Every build leaves the repository healthier than it found it

Net architectural entropy must not increase on our watch. A change that adds a feature while degrading the structure around it has not succeeded — it has borrowed against the future. If touching a subsystem reveals rot, we either fix it within scope or record it as tracked debt with an owner; we never quietly step around it and leave it worse. We refactor *before* complexity becomes load-bearing, because complexity that ships becomes complexity that's permanent.

## VI. Every architectural decision carries a written rationale

If a decision shapes the system — a new subsystem, a data-model change, a routing policy, a dependency that's hard to remove — it is recorded in the handbook's Decision Log with the reasoning and the alternatives rejected. Strong opinions live in writing where they can be revisited, not buried in code where they can only be reverse-engineered. A future session that can read *why* can safely change *what*; one that can't will either cargo-cult the decision or break it blindly.

## VII. One source of truth for every concept

Each concept is defined once and referenced everywhere else. The handbook defines product concepts; the code defines them structurally in exactly one place; documentation points to both rather than restating them. Duplicated truth is truth that will diverge. This mirrors the product itself, where Founder Memory, the Behavioral Model, and the Memory Harness were deliberately collapsed into one system precisely because three names for one thing is a defect.

## VIII. Documentation and implementation move together or not at all

They are never allowed to diverge. A change to behavior that doesn't update the handbook, or a handbook change not reflected in code, is an unfinished change. Synchronization is part of the work, not cleanup after it. A build is not done because the code runs; it is done when the code, its tests, and the handbook tell the same story.

## IX. Explicitness over magic; determinism over surprise

We prefer systems whose behavior can be read off their surface over clever machinery that acts at a distance. Given a choice between an explicit, boring mechanism and an implicit, impressive one, we choose boring. This matters doubly here because the *product* is an autonomous agent that takes real, irreversible actions in the world — sending messages, placing calls. An engineering culture that tolerates hidden magic will build a product whose autonomy nobody can predict or audit. We hold our own systems to the determinism we demand of tethr's.

## X. Irreversibility is sacred, in the codebase as in the product

The handbook treats real-world actions — send, call, spend — as most-guarded, requiring idempotency and explicit authorization. Engineering extends that same seriousness inward: destructive migrations, production deploys, and data deletions are treated as irreversible acts, made reversible where practical, and gated where not. Every irreversible action, in product or infrastructure, is idempotent and auditable. We do not let a retry become a second real-world event.

## XI. Tests are the specification of behavior

We write the test that defines "correct" before we write the code that satisfies it, and behavior is considered undefined until a test pins it down. Red before green is not ceremony; it is how we prove the code does what we claimed and nothing we didn't. Refactors are safe only against a passing suite held constant on both sides. A feature without a test is a rumor.

## XII. Every subsystem has one owner and clear boundaries

The handbook already assigns exactly one owning system to each product capability; the code honors that partition. Each subsystem exposes a deliberate boundary and hides its internals behind it. Work crosses boundaries through defined seams, never by reaching in. Blurred ownership is how a coherent system becomes a mud-ball no one dares change.

## XIII. Protect the load-bearing boundaries

Some lines in the handbook are structural, and eroding them for engineering convenience is prohibited: tethr builds the company, not the founder's product; the Founder Model is a policy, not a profile; revealed behavior outweighs stated; the burnout veto outranks execution; the founder's decision rights are inviolable. These are not preferences to trade against a deadline. If a technical path requires bending one of them, that is a signal the path is wrong, not that the boundary is negotiable.

## XIV. AI is a force multiplier, not a substitute for judgment

Claude Code does the work; it does not get to skip the discipline. The installed skills exist to make good process *mandatory*, not optional — brainstorming that refuses to code before design, TDD that deletes code written before its test, review that catches complexity. We use them because a capable model left to its defaults rushes to output. Speed of generation is never a reason to bypass clarification, planning, testing, or review. The stronger the model gets, the less we skip these steps, not more.

## XV. This document is stable by design

Amending the constitution is a deliberate act, not a routine one. A change here requires explicit human approval, a recorded rationale in the Decision Log, and a reason that a *principle* — not merely a practice — needed to change. Practices, tools, and file layouts evolve freely in ENGINEERING_OS.md; principles do not. If this document changes often, we have miscategorized a practice as a principle, and that is itself a defect to correct.

---

*Ratified as the founding engineering charter of tethr. Read it at the start of every session. When in doubt, it decides.*
