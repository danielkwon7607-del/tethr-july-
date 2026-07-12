drop index if exists plans_one_active_per_verdict;
drop trigger if exists experiment_criteria_immutable on experiments;
drop function if exists experiment_criteria_immutable();
