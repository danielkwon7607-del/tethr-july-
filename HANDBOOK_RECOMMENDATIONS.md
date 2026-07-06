# Handbook Recommendations — resolve before implementation

*Ten gaps that engineering surfaced while designing the operating protocol. Each should be closed in the handbook before the build it blocks, because building on an unresolved one accrues exactly the debt the Constitution forbids. Ordered by how early they block work.*

**1. Confirm Photon/Spectrum as the messaging layer and price in its risks (blocks Build 5).**
The handbook's iMessage/WhatsApp/SMS-RCS strategy is implementable: Photon's **Spectrum** SDK (`spectrum-ts`, MIT) delivers exactly this — iMessage + WhatsApp + Telegram + automatic SMS/RCS fallback via a managed gRPC stream, no Mac relay, one-line channel addition. This is the intended messaging stack, not a blocker. But three real risks must be recorded in Ch 10/21 before Build 5: Photon is new (~April 2026) and unproven at scale; Apple's ToS on third-party iMessage access is historically aggressive (enforcement risk — need a fallback plan if lines get cut); and the free tier shares numbers, so tethr needs **dedicated Photon lines** for consistent per-founder identity. Voice is a separate vendor (Grok), not Photon.

**2. Pick the workflow-engine and model-router vendors (blocks Build 0).**
The handbook decided these by *class* (managed event-driven workflow; provider-agnostic router) but left the vendor open (§25.3). Bootstrap encodes them, so choose them in Build 0 research and record the choice in Ch 18/20 before writing the abstractions.

**3. Add a Security & Authorization chapter (blocks Build 5–9).**
The product holds highly sensitive founder data and takes real actions on a founder's behalf, but the handbook has no authn/authz model, secrets-management, or data-access-control spec. This must exist before any user-facing or send-capable build. New chapter, referenced by §18–22.

**4. Specify Founder Model privacy, retention, deletion, and export (blocks Build 4).**
§6.14 calls the Founder Model "the most sensitive asset in the system" but there is no retention policy, encryption-at-rest requirement, or deletion/export mechanism — and inspectability/correctability (a stated commitment) needs a concrete surface. Data-subject rights (GDPR/CCPA) apply. Specify before the Founder Model is built.

**5. Define a per-founder cost model and budget guardrails (blocks Build 2/7).**
An autonomous loop making Tier-2 frontier calls and hitting paid research APIs can be expensive per founder. §20 notes cost but sets no ceiling. Define per-founder token/cost budgets and back-pressure — and note the product tie-in: an overloaded founder (burnout veto) and an over-budget founder should both throttle the loop.

**6. Specify research-source quotas, caching, and ToS compliance (blocks Build 7).**
xAI X Search, Serper, and Crunchbase have rate limits, per-call cost, and terms of service that constrain a *live* research loop. Add budgets, a caching/staleness policy, and ToS notes to Ch 11/21 so Build 7 doesn't design around limits it discovers in production.

**7. Specify the Grok voice integration before Build 10.**
Voice is Grok, not Photon (the handbook's "Photon/Spectrum" line conflated the two — Photon is messaging, Grok is voice). Voice is the riskiest integration (realtime S2S + cloning + outbound calling under the strictest autonomy guards). Specify the Grok voice API surface, cloning, and SIP/calling path in Ch 9/21 before the fast-follow. The MVP does not depend on it; keep it that way.

**8. Give §6.15 calibration a data-collection and tuning plan.**
The calibration constants are explicitly v0 and can only be validated with real founders. Build 4 must ship with the instrumentation to learn them, so specify *what* to measure and *how* the constants get tuned. Otherwise "v0" quietly becomes "permanent."

**9. Specify the human-in-the-loop approval UX for irreversible actions (blocks Build 9).**
§5.3 requires explicit authorization for send/call/spend, but there is no product surface defined for granting, viewing, and revoking autonomy or for approving a specific irreversible action. Outreach send (Build 9) needs it. Add to Ch 4/Ch 5.

**10. Add a testing and quality-bar chapter, or cede it explicitly to engineering.**
The handbook is silent on coverage expectations, e2e scope, and the quality bar, while the engineering DoD leans on TDD. Either add a short quality chapter to the handbook or record a decision that ENGINEERING_OS owns it — so there's one source of truth, not a silent gap.

---

*None of these require inventing product behavior — each is a place where the handbook is silent or contradicted by a real-world constraint, which is exactly where the Confusion Protocol says to stop and amend rather than guess.*
