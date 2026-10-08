# Task T22 — Contract: rename cards to work_items

**Phase:** 6
**Depends:** T21
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 22: Contract: rename cards to work_items [depends: T21]

## OBJECTIVE
Rename `cards` → `work_items` and `card_events` → `work_item_events` mechanically, compiler-guided, and close #103.

Steps:
1. Write failing test for: "Tables are renamed and old names are gone"
   Test file: `server/src/db/work-item-rename.integration.test.ts`
   Level: integration
   Test intent: Given a migrated database (fresh and merged) / When `migrate()` runs / Then `work_items` and `work_item_events` exist, `cards` and `card_events` do not, all FKs, indexes and the unique key survive on the new names, and `migrate()` twice is a no-op
   Exercise through: `applySchema(client)` (twice) and `information_schema`/`pg_indexes` reads
   Test doubles: none
   Expected RED: old names still exist
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/work-item-rename.integration.test.ts`
3. Add an idempotent `ALTER TABLE cards RENAME TO work_items` (guarded by `to_regclass`), same for events; update every Kysely reference and raw SQL string (`"cards"`, `FROM cards`, `JOIN cards`, `UPDATE cards`, `card_events`) found by the typecheck and by grep; do not rename the HTTP paths (`/cards/:id` stays: client contract). Verify PASS; run `npm run test`, typecheck, lint, `make check`. Commit: `git commit -m "refactor(server): rename cards to work_items"`.
4. Open the PR with `closes #103` and `closes #203` in the body; leave #100 alone (its P1#3 is separate).

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Scope (rename at Contract stage); Issue #103 acceptance
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: ~58 query sites plus raw SQL, compiler-guided; the migration itself is two guarded statements.

## SANDWICH CONTEXT
[CRITICAL: HTTP paths and response shapes do not change; only table and Kysely names change; the rename must be idempotent and inside the single migration transaction.]
You are implementing the table rename for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (Contract stage)
Files in scope: schema.sql, db/types.ts, every server file referencing `cards`/`card_events`, tests
Available after: T21
Architecture rule: 300-on-touch applies to every touched file
[RESTATE: Idempotent rename; HTTP unchanged.]

## DELIVERABLE
Given a migrated database, When migrated, Then only the new table names exist with all constraints intact

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Grep for the old names returns only intentional HTTP path strings and historical docs
Must-not-have:
  - Changing HTTP routes or JSON field names
Open question risks:
  - none
Rollback note:
  - Revert PR and run the reverse rename statement from the PR description.
Red flags:
  - Any raw SQL string missed by the compiler → run the full integration suite before merge

## STOP CONDITIONS
Done when: scenario passes and all checks are green
Uncertain when: a dynamic SQL string builds the table name
Escalate when: the 300-on-touch extraction expands scope too far
