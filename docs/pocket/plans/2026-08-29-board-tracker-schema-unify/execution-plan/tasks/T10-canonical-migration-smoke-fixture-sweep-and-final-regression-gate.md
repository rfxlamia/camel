# Task T10 — Canonical migration smoke, fixture sweep, and final regression gate

**Phase:** 3
**Depends:** T4, T5, T6, T7, T8, T9
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 10: Canonical migration smoke, fixture sweep, and final regression gate [depends: T4, T5, T6, T7, T8, T9]

## OBJECTIVE

Close the feature with a full migration-order proof, all existing direct card
insert fixtures updated for `cards.status_id NOT NULL`, and the complete
monorepo quality gate. This task is the only place allowed to declare the
plan executable.

Files:
- Create: `server/src/db/full-migration.integration.test.ts`
- Modify every direct card fixture affected by the final constraint:
  `server/src/routes.integration.test.ts`,
  `server/src/notifications/service.test.ts`,
  `server/src/notifications/scheduler.test.ts`,
  `server/src/routes/cards.notification.test.ts`,
  `server/src/routes/cards-mutations.integration.test.ts`,
  `server/src/agent/routes.test.ts`,
  `server/src/agent/ticket-intake/history.test.ts`,
  `server/src/db/board-tracker-unify-migration.integration.test.ts`,
  `server/src/routes/cards-identity.integration.test.ts`,
  `server/src/routes/columns-is-done-remap.integration.test.ts`,
  `server/src/routes/cards-taxonomy.integration.test.ts`, and
  `server/src/db/tracker-migration.test.ts`.

Steps:

1. Inventory with `rg` every `insertInto("cards")` and equivalent raw card
   insert in the repository. The known affected fixture set includes
   `server/src/routes.integration.test.ts`,
   `server/src/routes/cards-mutations.integration.test.ts`,
   `server/src/notifications/service.test.ts`,
   `server/src/notifications/scheduler.test.ts`,
   `server/src/routes/cards.notification.test.ts`,
   `server/src/agent/routes.test.ts`,
   `server/src/agent/ticket-intake/history.test.ts`, and the four new feature
   integration files listed above. For each fixture, use a real slotted
   `status_id`/T1 helper or the allocator as appropriate; do not skip a
   fixture because it is outside the feature's primary route suite. Preserve
   fixture intent and agent tests' no-activity contract.

2. Write/extend `full-migration.integration.test.ts` to exercise the same
   canonical sequence as `server/src/db/migrate.ts`, not only a marker-extracted
   SQL fragment:

   - fresh state: execute `schema.sql`, assert the base state before
     `agent-schema.sql`, then execute `agent-schema.sql`, then
     `chat-schema.sql`, all in one transaction; verify `columns.board_id` and
     chat tables appear only at their respective stages and the final schema
     migrates successfully;
   - existing state: start from a pre-unify schema with human cards,
     `columns.board_id`, historical agent cards, soft-deleted cards, existing
     tracker keys, and partially populated identity fields; run the full
     canonical migration and verify both branches, all status rows, keys,
     indexes, final NOT NULL, and untouched timestamps;
   - apply the canonical migration a second time and verify no key/status
     rewrites, no counter double increment, no duplicate slots, and no schema
     error.

   The test must use the real PostgreSQL transaction boundary and the three
   files in order. Marker-extracted tests may remain as focused unit coverage,
   but they cannot be the only migration-order evidence.

3. Run the focused migration/fixture tests with services and migration
   available:

   ```text
   docker compose up -d db redis
   make db-migrate
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/full-migration.integration.test.ts
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/board-tracker-unify-migration.integration.test.ts
   ```

   Fix any direct fixture failures by adding the correct status id, never by
   weakening the final constraint.

4. Run the complete quality gate from repository root:

   ```text
   npm run test
   npm run lint
   npm run typecheck
   npm run build
   RUN_INTEGRATION=1 npm run test:integration:routes --workspace=server
   ```

   The canonical route integration command must run with PostgreSQL/Redis
   services and the migrated schema. The command uses the server's
   `--no-file-parallelism` script to avoid cross-file database races.

5. Review the final diff for scope, stale commands, event placement, and
   migration predicates. Commit fixture/test-only corrections and this gate
   only after every command passes:

   ```text
   git add server/src/db/full-migration.integration.test.ts server/src/db/board-tracker-unify-migration.integration.test.ts server/src/routes/cards-identity.integration.test.ts server/src/routes/columns-is-done-remap.integration.test.ts server/src/routes/cards-taxonomy.integration.test.ts server/src/db/tracker-migration.test.ts server/src/routes.integration.test.ts server/src/routes/cards-mutations.integration.test.ts server/src/notifications/service.test.ts server/src/notifications/scheduler.test.ts server/src/routes/cards.notification.test.ts server/src/agent/routes.test.ts server/src/agent/ticket-intake/history.test.ts
   git commit -m "test(board-tracker): close migration and regression gates"
   ```

## REFERENCES LOADED

`server/src/db/migrate.ts`, all direct card insert fixtures found by `rg`,
`AGENTS.md` command conventions, the T2 migration tests, and the server route
integration script.

## WHY THIS APPROACH

`status_id NOT NULL` is a repository-wide contract, not only a new-route
contract. A canonical full migration smoke catches schema-load-order failures
that marker extraction cannot, while the explicit fixture inventory prevents
false confidence from a partial suite.

## SANDWICH CONTEXT

[CRITICAL: Do not weaken NOT NULL, skip direct fixtures, run only a marker
fragment, or claim completion without the root quality gate and canonical
route integration.]

## DELIVERABLE

Fresh/existing/idempotent canonical migration, all direct card fixtures,
server/client tests, lint, typecheck, build, and full route integration pass.

## QUALITY BAR

- No stale root single-file commands remain in the plan.
- Migration order and post-commit event behavior are evidenced.
- All direct inserts set a valid status id under the final schema.
- TDD/regression evidence is recorded before completion.

## STOP CONDITIONS

Stop with a concrete failure report if services are unavailable, migration
rollback is not clean, any direct fixture still inserts a null status, or any
quality-gate command fails. Do not mark the plan DONE on skipped integration
tests.
