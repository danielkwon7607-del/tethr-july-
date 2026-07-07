# @tethr/db

The data & memory substrate (handbook Ch 19, Ch 6, §18.5): plain-SQL reversible
migrations, the founder-context client, and the Postgres `ActionLedger`.

## Layout

- `migrations/` — paired `NNNN_name.up.sql` / `.down.sql`, applied in name order,
  one transaction each. The SQL is the spec: RLS policies, triggers, and
  constraints are read off the files.
- `src/migrate.ts` — `migrateUp` / `migrateDown` / `appliedMigrations`.
- `src/client.ts` — `createDbClient`, `withFounderContext` (transaction-local
  `app.founder_id`, which every RLS policy checks).
- `src/action-ledger.ts` — `PgActionLedger`, the §18.5.7 audit-before-dispatch
  ledger implementing `@tethr/core`'s `ActionLedger`.

## Security invariants (handbook §18.5.4)

Every founder-scoped table carries `founder_id` with **forced** RLS checking
`current_founder_id()`. App access runs as the non-superuser `tethr_app` role.
The integration suite proves cross-founder invisibility per table and fails if
a new `founder_id` table lacks a policy. Enumerated exceptions:
`public_knowledge_chunks` (founder-free by construction) and `schema_migrations`.

## Running the integration suite

The suite needs a real Postgres with pgvector, named by `TETHR_DATABASE_URL`.
**It drops and recreates the `public` schema** — point it at a disposable
database only. CI provides `pgvector/pgvector:pg17` as a service container.

Local (Homebrew, isolated scratch cluster — no system service):

```bash
brew install postgresql@17 pgvector
PGBIN=/opt/homebrew/opt/postgresql@17/bin
"$PGBIN/initdb" -D /tmp/tethr-pg -E UTF8 --no-locale -U tethr
"$PGBIN/pg_ctl" -D /tmp/tethr-pg -l /tmp/tethr-pg.log -o "-p 54329 -c unix_socket_directories=''" start
"$PGBIN/psql" -h 127.0.0.1 -p 54329 -U tethr -d postgres -c "create database tethr_test"

TETHR_DATABASE_URL="postgres://tethr@127.0.0.1:54329/tethr_test" npm test
```

Without `TETHR_DATABASE_URL` the suite skips (visible in output), so the
pre-commit hook still runs everywhere; CI is the enforcement gate.

## Applying migrations to a real environment

Staging/production migration runs arrive with the first deployed environment
(Build 2+); until then, `migrateUp`/`migrateDown` are invoked from tests and
scripts. Migrations must stay reversible (Constitution X) — `down` is tested
against `up` in CI on every push.
