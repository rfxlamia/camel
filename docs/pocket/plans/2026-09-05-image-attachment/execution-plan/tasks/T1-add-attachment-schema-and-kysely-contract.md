# Task T1 — Add attachment schema and Kysely contract

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 1: Add attachment schema and Kysely contract [prereq] [test-risk]

## OBJECTIVE

Add the additive `attachments` table and committed Kysely type so attachment routes can persist one logical image with separate thumbnail/original paths without touching tracker tables or card optimistic-locking fields.

Files:

- Modify: `server/src/db/schema.sql`
- Modify: `server/src/db/types.ts`
- Create: `server/src/db/attachment-schema.integration.test.ts`
- Create: `server/src/db/attachment-schema.test.ts`

Steps:

1. Write failing test for: the full schema can be applied twice and PostgreSQL enforces attachment constraints/cascade.
   Test file: `server/src/db/attachment-schema.integration.test.ts`
   Level: integration

   Test intent:
   Given an isolated PostgreSQL schema, When the repository schema is applied twice and fixtures are inserted, Then:
   - the second application succeeds without destructive errors
   - invalid MIME/size rows are rejected by database constraints
   - physically deleting a card cascades its attachment row
   - valid rows can be selected in `(card_id, created_at, id)` order

   Exercise through:
   - the real `schema.sql` migration text and PostgreSQL connection, not a SQL string matcher.

   Test doubles:
   - isolated database schema/transaction fixture only
   - do not mock PostgreSQL, migration execution, FK enforcement, constraints, or schema text.

   Expected RED:
   - the current database has no `attachments` table/index, so migration application and constraint assertions fail.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test --workspace=server -- src/db/attachment-schema.integration.test.ts`
   Expected failure: live migration/constraint assertions fail because the schema is absent.

3. Implement minimal code to satisfy the test:
   File: `server/src/db/schema.sql`
   Implement: an idempotent `attachments` table with the exact logical-image columns, FK cascade, PNG/JPEG check, positive bounded byte-size checks, created timestamp, and `(card_id, created_at, id)` index. Keep it additive and leave `cards.version`, `tracker_items`, and existing public uploads untouched.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test --workspace=server -- src/db/attachment-schema.integration.test.ts`
   Expected: real schema reapplication and constraint/cascade assertions PASS.

5. Refactor while green (bounded):
   - Keep migration ordering/idempotency in `schema.sql`; keep integration setup isolated and gated.
   - Re-run the integration test and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/db/schema.sql server/src/db/attachment-schema.integration.test.ts`
   `git commit -m "feat(attachments): add attachment table schema"`

7. Write failing test for: generated database type exposes `Attachments` and registers `attachments` on `Database`.
   Test file: `server/src/db/attachment-schema.test.ts`
   Level: unit (generated-contract check)

   Test intent:
   Given the committed `server/src/db/types.ts`, When the type contract test reads it, Then `Attachments` uses the repository's `Generated<T>`/`Timestamp` conventions and the database registry contains `attachments: Attachments`.

   Exercise through:
   - the committed Kysely type module contract, not a handwritten duplicate type.

   Test doubles:
   - none
   - do not mock the generated type file.

   Expected RED:
   - the schema now exists but `types.ts` has no `Attachments` interface or database registry entry.

8. Run test — verify FAIL:
   `npm run test --workspace=server -- src/db/attachment-schema.test.ts`
   Expected failure: generated-type assertions report that `Attachments`/`attachments` is missing.

9. Implement minimal code to satisfy the test:
   File: `server/src/db/types.ts`
   Implement: regenerate the committed Kysely type output from the migrated schema, or update the generated output using the same field/nullability conventions if a database is unavailable. Preserve the generated-file header and add only the new table shape/registry entry.

10. Run test — verify PASS:
    `npm run test --workspace=server -- src/db/attachment-schema.test.ts`
    Expected: generated-type assertions PASS.

11. Refactor while green (bounded):
    - Run `npm run typecheck` and re-run the schema integration and type contract tests — all must stay PASS.

12. Commit:
    `git add server/src/db/types.ts server/src/db/attachment-schema.test.ts`
    `git commit -m "feat(attachments): register Kysely attachment types"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — schema scope, FK cascade, no tracker changes, and card-version isolation.
- `server/src/db/schema.sql` — idempotent DDL ordering and current nullable `card_events.to_column_id` behavior.
- `server/src/db/types.ts` — generated `Generated<T>`/`Timestamp` conventions.
- `server/src/db/focus-session-schema.test.ts` — schema/type contract test convention.

## WHY THIS APPROACH

Complexity: standard
Justification: This is a persistence prerequisite spanning one SQL artifact, one generated type artifact, and one contract test. The two RED cycles independently prove database shape and type shape before any route can depend on them.

## SANDWICH CONTEXT

[CRITICAL: Attachments must remain an additive `cards`-only table and must not modify tracker tables or card optimistic-locking semantics.]
You are implementing the attachment persistence contract for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: one attachment row stores thumbnail and original paths, with local storage and authenticated delivery added later.
Files in scope: `server/src/db/schema.sql`, `server/src/db/types.ts`, `server/src/db/attachment-schema.test.ts`, `server/src/db/attachment-schema.integration.test.ts`.
Available after: none.
Architecture rule: use idempotent `schema.sql` applied by `make db-migrate`; do not add a separate migration or touch `tracker_items`.
[RESTATE: Attachments must remain an additive `cards`-only table and must not modify tracker tables or card optimistic-locking semantics.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a migrated database, When the attachment schema is applied twice, Then the `attachments` table and deterministic cover-order index exist without destructive changes.
Given a card is physically deleted, When its attachment FK is evaluated, Then attachment rows cascade; soft-delete cleanup is handled later by T7.
Given `server/src/db/types.ts` is loaded, When attachment queries are typechecked, Then `Attachments` and the `attachments` registry entry match the DDL.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- PNG/JPEG-only row contract, bounded byte sizes, timestamp, FK cascade, and `(card_id, created_at, id)` ordering index.
- Kysely type output remains consistent with the repository's generated-file conventions.
- Schema is additive and idempotent.
- Tests are written before implementation and both commits are conventional.

Must-not-have:

- Changes to `tracker_items`, `work-item-response.ts`, `workItemMutations.ts`, or `cards.version`.
- Public file paths, URL columns, or image bytes stored in the database.
- A separate migration file or destructive table rewrite.

Open question risks:

- None introduced by this task; the accepted orphan/idempotency risks are handled by later storage/API tasks.

Rollback note:

- The table/index are additive. If the feature is disabled, leave the schema in place and hide UI entry points; do not roll back existing card/column tables.

## STOP CONDITIONS

Done when: both schema/type contract cycles pass, typecheck is green, and both commits exist.
Uncertain when: the live database type generator produces a shape incompatible with the existing Kysely conventions; report NEEDS_CONTEXT before hand-editing unrelated types.
Escalate when: satisfying the schema requires changing tracker tables, `cards.version`, or existing card-event history.
