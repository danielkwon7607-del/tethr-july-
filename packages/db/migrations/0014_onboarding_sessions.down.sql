-- Reverse of 0014. The founders table (0004) is otherwise untouched.
alter table founders drop column if exists onboarding_session_id;
drop table if exists onboarding_sessions;
