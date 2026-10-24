# Backup, restore and reset: local rehearsal

**Scope: the LOCAL Supabase stack only.** This proves the application schema and data can be dumped and rebuilt on a scratch database on the same machine. It does **not** prove that a hosted Supabase project can be restored, point-in-time recovery, recovery of `auth.users` / password hashes / MFA factors, storage objects, or any production backup. No production exists. Backups, their schedule, their storage location and their encryption are an open owner decision.

## 1. Rebuild from scratch (reset)

```bash
pnpm db:start      # local stack (see README for the sandbox workarounds)
pnpm db:reset      # drops the local database, replays every migration in order, loads supabase/seed.sql, restores the mail forwarder
```

This is the "forward" migration path: migrations are plain SQL files applied in filename order and are never edited after they ship. There is **no down-migration**. The rollback strategy is: restore a dump taken before the migration, or reset the local database and replay. For a real environment a dump before every migration, and a restore rehearsal, would be required.

Validation after a reset: `pnpm test:db` (all DB tests), `pnpm exec supabase db lint --local --level warning`, and `schema-hygiene.test.ts` / `security-regression.test.ts` (function search paths, grants, RLS on every table, append-only triggers).

## 2. Dump and restore rehearsal

```bash
pnpm db:restore-drill      # bash scripts/db-restore-drill.sh
```

What the script does (all inside the local database container; nothing leaves the machine):

1. `pg_dump -Fc -n public -n app_private` of the local database to `/tmp/afit-backups/afit-local-<timestamp>.dump` (override with `BACKUP_DIR`).
2. Creates a scratch database `restore_check` with a minimal stand-in for Supabase's `auth` schema (a `users(id)` table filled with the live user ids, plus `auth.uid()` / `auth.jwt()` stubs) and the extensions the schema uses.
3. `pg_restore` into it. Only two error kinds are tolerated because they are artefacts of the scratch setup (`schema "public" already exists`, and `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`); any other error fails the drill.
4. Compares a fingerprint of the live and restored databases: table count, tables with RLS on, constraints, functions, triggers, policies, indexes, a hash of every function's access-control list, and a **content hash of every row of every table** (row count plus an md5 of the ordered row text), so a restore that drops or alters a row is caught, not just one that loses a table.
5. Drops the scratch database.

### Result recorded in this batch

Run on a freshly reset database after the new e2e specs had created data through the application (so rows exist in orders, notifications, reviews and so on):

```
unexpected pg_restore errors: 0
live:     tables=53 rls_on=53 constraints=303 functions=174 triggers=42 policies=99 indexes=128 fn_acl=b35e66df… rows=b6dbd2f5…
restored: tables=53 rls_on=53 constraints=303 functions=174 triggers=42 policies=99 indexes=128 fn_acl=b35e66df… rows=b6dbd2f5…
RESULT: restored database matches the source (local rehearsal only)
```

### What the drill taught us (kept honest)

- The first attempt ran against a local database that the DB test suite had used. It failed with foreign-key errors. Cause: some test helpers purge data with `session_replication_role = replica`, which skips foreign-key checks and can leave **orphan rows** (for example a product whose shop was deleted). A real restore rightly refuses orphans. This is a property of the test database, not of the application (the application cannot create orphans: foreign keys are enforced). Run the drill after `pnpm db:reset`.
- Restoring into a scratch database needs `pg_trgm` installed in the `extensions` schema (two search indexes use it). The script creates it.
- `auth.users` is deliberately not part of this drill. Recovering real accounts needs the hosted platform's own backup tooling and an owner-approved procedure (and ties into the open MFA-recovery decision).

### Conditions under which the drill is valid (post-Batch 6 review of the script)

| Question                                         | Answer                                                                                                                                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Must the database be freshly reset?              | **Yes.** Run `pnpm db:reset`, then create data through the application (for example `pnpm exec playwright test tests/e2e/engagement.spec.ts`), then run the drill.                                                                           |
| Does the drill create its own fixtures?          | No. It restores whatever the local database holds. It refuses (exit 3) to run on a database with no users or no orders, because restoring nothing proves nothing.                                                                            |
| Does it depend on data left by other tests?      | It must not. The DB test suites leave orphan rows (replica-mode purge); on such a database the restore reports foreign-key errors and the script fails with an explanation (exit 1). That is correct behaviour, demonstrated in this review. |
| Can it mislead?                                  | A restore of a tiny database says little about a large one; the content hash compares _this_ database only; stubs stand in for Supabase's `auth` schema, so `auth` data is not covered; local container only.                                |
| Does it touch anything remote or delete records? | No. It dumps to `/tmp/afit-backups`, creates and drops one scratch database (`restore_check`) in the local container, and never modifies the source.                                                                                         |

## 3. What a real recovery plan still needs (owner/operations decisions)

| Item                                                   | Status                                          |
| ------------------------------------------------------ | ----------------------------------------------- |
| Where backups are stored and who can read them         | Awaiting owner                                  |
| Encryption of backups; key custody                     | Awaiting owner                                  |
| Backup frequency and retention                         | Awaiting owner                                  |
| Restore of a hosted Supabase project, tested           | Not done (no hosted project exists)             |
| Recovery time / recovery point targets                 | Awaiting owner                                  |
| Who is allowed to run a restore, and how it is audited | Awaiting owner                                  |
| Restoring `auth` data (users, factors)                 | Not rehearsed; depends on MFA-recovery decision |
