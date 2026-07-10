import type { Sql } from "postgres";

// Shell auth resolution (§18.5.2): map a Supabase Auth user id to its founder.
// Onboarding links the two (founders.auth_user_id); this is the read the shell
// uses to replace the TETHR_DEV_FOUNDER_ID binding with the authenticated
// session's founder. Runs as service role — the lookup precedes the founder
// scope (the same bootstrap shape as inbound resolution, ADR 0009): a founder
// cannot be identified from inside their own RLS scope before identification.

export async function founderIdForAuthUser(sql: Sql, authUserId: string): Promise<string | null> {
  const [row] = await sql<{ id: string }[]>`
    select id from founders
    where auth_user_id = ${authUserId} and tombstoned_at is null`;
  return row?.id ?? null;
}
