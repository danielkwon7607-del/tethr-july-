-- Reverse of 0011. Drop the verification/system-action surface; the base
-- action_ledger and channel_identities tables (0005/0006) are untouched.
drop function if exists record_system_action_outcome(text, text, text, text);
drop function if exists claim_system_action(text, text);
drop index if exists action_ledger_system_claim;
drop function if exists verify_channel_otp(text, text, text);
drop table if exists channel_verifications;
