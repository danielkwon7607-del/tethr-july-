import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";

// Reversible migrations (Constitution X, ENGINEERING_OS §9): paired
// NNNN_name.up.sql / NNNN_name.down.sql files, applied in name order, each in
// its own transaction. Plain SQL because the schema IS the spec — RLS
// policies, triggers, and constraints read off the file (Constitution IX).

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

const ensureMigrationsTable = (sql: Sql) =>
  sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;

async function migrationNames(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  return files
    .filter((file) => file.endsWith(".up.sql"))
    .map((file) => file.replace(/\.up\.sql$/, ""))
    .sort();
}

export async function appliedMigrations(sql: Sql): Promise<string[]> {
  await ensureMigrationsTable(sql);
  const rows = await sql<{ name: string }[]>`select name from schema_migrations order by name`;
  return rows.map((row) => row.name);
}

/** Apply all unapplied migrations, in order. Returns the names applied. */
export async function migrateUp(sql: Sql, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const applied = new Set(await appliedMigrations(sql));
  const pending = (await migrationNames(dir)).filter((name) => !applied.has(name));
  for (const name of pending) {
    const content = await readFile(join(dir, `${name}.up.sql`), "utf8");
    await sql.begin(async (trx) => {
      await trx.unsafe(content);
      await trx`insert into schema_migrations (name) values (${name})`;
    });
  }
  return pending;
}

/** Roll back the most recent `steps` migrations. Returns the names rolled back. */
export async function migrateDown(
  sql: Sql,
  steps = 1,
  dir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const applied = await appliedMigrations(sql);
  const toRevert = applied.slice(-steps).reverse();
  for (const name of toRevert) {
    const content = await readFile(join(dir, `${name}.down.sql`), "utf8");
    await sql.begin(async (trx) => {
      await trx.unsafe(content);
      await trx`delete from schema_migrations where name = ${name}`;
    });
  }
  return toRevert;
}
