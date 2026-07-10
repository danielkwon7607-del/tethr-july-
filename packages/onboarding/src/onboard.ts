import { recordObservation } from "@tethr/founder-model";
import { sendInternal, type WorkflowEngine } from "@tethr/orchestration";
import type { Sql } from "postgres";
import { founderIdForAuthUser } from "./auth";
import { companyStateSeed, type OnboardingInput, seedProfile } from "./entry-paths";
import { ONBOARDING_COMPLETED_EVENT } from "./research-trigger";

// The onboarding orchestrator (§3): create the founder, seed Company State and
// the cold-start Founder Model, then auto-trigger Research (§3.4). It is the
// first writer of real episodes, which is why the write-path extractors
// (Build 4, deferred) arrive alongside it. Two privilege scopes are in play in
// ONE transaction: creating the founder precedes any founder scope (the
// `founders` table has no insert policy — §18.5.4), so the tx inserts it as
// owner, then drops to tethr_app and scopes to the new founder for every seed.

export type OnboardingDeps = {
  /** Service-role client (owner): creates the founder, then self-drops to
   * tethr_app inside one transaction so creation + seeding are atomic. */
  sql: Sql;
  engine: WorkflowEngine;
};

export type OnboardingResult = { founderId: string };

export async function runOnboarding(
  deps: OnboardingDeps,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  // Idempotent resume: an auth-linked retry (the natural response to a thrown
  // error, or a redelivered request) returns the existing founder instead of
  // colliding on the unique auth_user_id. Onboarding for a given identity runs
  // once; a second call is a no-op that re-emits nothing.
  if (input.authUserId) {
    const existing = await founderIdForAuthUser(deps.sql, input.authUserId);
    if (existing) return { founderId: existing };
  }

  const seeds = seedProfile(input);
  const company = companyStateSeed(input);

  // Founder creation and seeding are ONE transaction: creation is a service-
  // role write (the `founders` table has no insert policy — §18.5.4), so the
  // tx inserts the founder as owner, THEN drops to tethr_app and scopes to the
  // new founder for every seeded write. Either the whole model lands or none of
  // it does — no orphaned, half-seeded founder survives a mid-onboarding
  // failure. (This is why we don't reuse runScoped, which switches role first.)
  const founderId = await deps.sql.begin(async (tx) => {
    const [created] = await tx<{ id: string }[]>`
      insert into founders (display_name, auth_user_id)
      values (${input.displayName ?? null}, ${input.authUserId ?? null})
      returning id`;
    const id = (created as { id: string }).id;

    await tx`set local role tethr_app`;
    await tx`select set_config('app.founder_id', ${id}, true)`;
    const trx = tx as unknown as Sql;

    // The founder's own channel is created UNVERIFIED. Onboarding proves no
    // ownership of the address — stamping verified_at here would let a caller
    // claim someone else's number (§18.5.2: unverified identities never reach a
    // founder's context, and the first outbound refuses an unverified channel).
    // The verification mechanism (OTP / proven inbound) is a handbook gap owed
    // by the entry boundary; onboarding sets verified_at once handed proof.
    await trx`
      insert into channel_identities (channel_type, address, is_primary)
      values (${input.channel.channelType}, ${input.channel.address}, true)`;

    await trx`
      insert into company_state (company_name, stage, state)
      values (${company.companyName ?? null}, ${company.stage}, ${trx.json(company.state)})`;

    // The onboarding episode is the first ground-truth (§6.2); every seed
    // traces to it (provenance, §6.4), so the reads are auditable from day one.
    const [row] = await trx<{ id: string }[]>`
      insert into episodes (kind, content, occurred_at)
      values ('onboarding', ${trx.json({ entryPath: input.path })}, now())
      returning id`;
    const episodeId = (row as { id: string }).id;

    // §6.13 cold start: stated, low-confidence reads on the highest-leverage
    // dimensions. A single stated observation is low-confidence by the §6.15
    // math, which is exactly why early policy is conservative (§6.9).
    for (const seed of seeds) {
      await recordObservation(trx, {
        family: seed.family,
        dimension: seed.dimension,
        source: "stated",
        estimate: seed.estimate,
        provenanceEpisodeIds: [episodeId],
      });
    }
    return id;
  });

  // §3.4: the instant onboarding establishes enough, tethr triggers Research on
  // its own — no founder prompt. Emitted AFTER the write phase commits, so a
  // downstream handler failure can never roll back (or masquerade as) a
  // successful onboarding; an auth-linked retry resumes idempotently above.
  await sendInternal(deps.engine, {
    name: ONBOARDING_COMPLETED_EVENT,
    id: `onboarding/${founderId}`,
    data: { founderId, entryPath: input.path },
  });

  return { founderId };
}
