-- Experiment criteria are set in advance and frozen once the experiment runs
-- (§13.2, Build 8) — so a result can never be rationalized by editing the
-- criteria after the fact. The brief's requirement is structural, not
-- procedural: enforce it at the database (Constitution IX), where no app path,
-- ORM, or ad-hoc query can bypass it.
--
-- The five criteria columns (hypothesis, success_criteria, failure_criteria,
-- duration, sample_size) may change ONLY while the experiment both was and
-- remains 'designed' with no result recorded. That single window admits
-- pre-run editing while designing, and forbids every edit once the experiment
-- has left design or a result exists. Status transitions and the result write
-- itself are untouched — only the criteria freeze.

create function experiment_criteria_immutable() returns trigger
language plpgsql
as $$
begin
  if row(new.hypothesis, new.success_criteria, new.failure_criteria, new.duration, new.sample_size)
     is distinct from
     row(old.hypothesis, old.success_criteria, old.failure_criteria, old.duration, old.sample_size)
  then
    if not (old.status = 'designed' and new.status = 'designed'
            and old.result is null and new.result is null) then
      raise exception
        'experiment criteria are immutable once the experiment leaves design or a result lands (§13.2)';
    end if;
  end if;
  return new;
end $$;

create trigger experiment_criteria_immutable before update on experiments
  for each row execute function experiment_criteria_immutable();

-- One active Plan per verdict, enforced at the database (Constitution IX), not
-- just by Planning's app-level check-before-insert: a landed verdict generates
-- exactly one active Plan, and re-planning supersedes the old (status ->
-- 'superseded') before a new active one exists. Superseded/completed plans
-- coexist freely; only 'active' is unique per verdict.
create unique index plans_one_active_per_verdict on plans (verdict_id)
  where status = 'active';
