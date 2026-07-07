import postgres, { type Sql } from "postgres";

export type { Sql };

/** Fail fast at the point of use (Constitution IX): no URL, no client. */
export function requireDatabaseUrl(env: Record<string, string | undefined>): string {
  const url = env.TETHR_DATABASE_URL;
  if (!url) {
    throw new Error("TETHR_DATABASE_URL is not set — refusing to construct a database client");
  }
  return url;
}

export function createDbClient(databaseUrl: string, options?: { max?: number }): Sql {
  return postgres(databaseUrl, {
    max: options?.max ?? 10,
    onnotice: () => {},
  });
}

/**
 * Scope a unit of work to one founder: a transaction with app.founder_id set
 * locally, which is what every RLS policy checks (§18.5.4). The setting is
 * transaction-local, so pooled connections cannot leak founder context.
 */
export async function withFounderContext<T>(
  sql: Sql,
  founderId: string,
  work: (trx: Sql) => Promise<T>,
): Promise<T> {
  return (await sql.begin(async (trx) => {
    await trx`select set_config('app.founder_id', ${founderId}, true)`;
    return work(trx as unknown as Sql);
  })) as T;
}
