# Task T7 — Strict Tracker item creation backend

**Phase:** 1
**Depends:** T3
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 7: Strict Tracker item creation backend [depends: T3] [parallel: T6] [test-risk]

## OBJECTIVE

Extract one strict Tracker create handler for canonical and legacy routes, with real-database persistence coverage and explicit mocked route-unit regressions.

Files:

- Create: `server/src/routes/tracker-item-create.ts`
- Modify: `server/src/routes/tracker-items.ts`
- Create: `server/src/routes/tracker-item-create-metadata.integration.test.ts`
- Test: `server/src/routes/tracker-items.write.test.ts`
- Test: `server/src/routes/work-items.test.ts`
- Read/import only: `server/src/routes/work-item-create-metadata.ts` (T3 validator)
- Read/import only: `server/src/routes/workspace-mutation-lock.ts` (T3 lock primitives)
- Read/import only: `server/src/routes/tracker-item-parsers.ts`
- Read/import only: `server/src/routes/work-item-response.ts`
- Read/import only: `server/src/routes/tracker-assignees.ts`
- Read/import only: `server/src/routes/tracker-activity.ts`
- Read/import only: `server/src/routes/vocabulary-response.ts`
- Read/import only: `server/src/routes/helpers.ts`
- Read/import only: `server/src/db/kysely.ts`
- Read/import only: `server/src/realtime.ts`
- Read/import only: `server/src/events.ts`

Steps:

#### Regression Verification T7-C01 — GWT Scenario: Create a fully configured Tracker item

1. **Define the regression verification.**
   - Scenario: `Create a fully configured Tracker item`
   - Test file: `server/src/routes/tracker-item-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given an authorized member submits Ship onboarding with every supported Tracker field including valid dates; When POST /work-items completes; Then one hydrated tracker item and its relations and tracker activity row are committed without a Board row.
   - Exercise through: Express POST /work-items through Supertest against a real migrated PostgreSQL database.
   - Test doubles: spy only post-commit event and notification publishers; keep route, validator, parser, Kysely, database, relation helpers, and activity helper real.
   - Baseline timing: Write and run before extraction/strict-validation changes.
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"Create a fully configured Tracker item\""`. Expected: PASS today through the existing public Tracker create route; this is compatibility coverage, not evidence for the new strict-validation seam..
3. **Run the same verification after this task's production changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"Create a fully configured Tracker item\""`. Expected: PASS.

#### Regression Verification T7-S02 — Support: preserves canonical and legacy route wiring parity

1. **Define the regression verification.**
   - Scenario: `preserves canonical and legacy route wiring parity`
   - Test file: `server/src/routes/work-items.test.ts`
   - Level: unit.
   - Test intent: Given equivalent authorized payloads target /work-items and /tracker/items; When each route handles them; Then both return equivalent status, body, and error forwarding after extraction.
   - Exercise through: the Express route wiring with the existing unit harness, asserted only through public HTTP status and body on both paths.
   - Test doubles: mock authentication, database service calls, and outbound publishers; keep route registration and URL rewriting real. Do NOT spy on the extracted handler — see the scope note below.
   - Scope note: `/work-items` is not a parallel handler. `server/src/routes/work-items.ts:21` rewrites `req.url` from `/work-items` onto `/tracker/items`, so a single handler serves both and parity holds by construction. This cycle therefore guards the rewrite middleware surviving T7's extraction; it is deliberately narrow and must not be inflated into a delegation-spy assertion.
   - Baseline timing: Write and run before T7-S01 changes route internals.
2. **Run the baseline/prerequisite verification:** `npm run test --workspace=server -- src/routes/work-items.test.ts -t "\"preserves canonical and legacy route wiring parity\""`. Expected: PASS today when asserted only through equivalent public canonical and legacy HTTP status/body behavior; do not assert an extracted-handler spy..
3. **Run the same verification after this task's production changes:** `npm run test --workspace=server -- src/routes/work-items.test.ts -t "\"preserves canonical and legacy route wiring parity\""`. Expected: PASS.

#### Regression Verification T7-S03 — Support: preserves existing mocked write-route regressions

1. **Define the regression verification.**
   - Scenario: `preserves existing mocked write-route regressions`
   - Test file: `server/src/routes/tracker-items.write.test.ts`
   - Level: unit.
   - Test intent: Given existing create authorization and response cases are configured; When the extracted handler is delegated from tracker-items routing; Then the existing unit-level status, body, and authorization behavior remains.
   - Exercise through: the tracker-items route using its existing mocked service harness.
   - Test doubles: mock database service calls, authentication, activity, and publishers; keep route branching real.
   - Baseline timing: Run the existing mocked route regressions before T7-S01 changes route internals.
2. **Run the baseline/prerequisite verification:** `npm run test --workspace=server -- src/routes/tracker-items.write.test.ts -t "\"preserves existing mocked write-route regressions\""`. Expected: PASS today for existing authorization, status, and response behavior; the post-change run protects those contracts..
3. **Run the same verification after this task's production changes:** `npm run test --workspace=server -- src/routes/tracker-items.write.test.ts -t "\"preserves existing mocked write-route regressions\""`. Expected: PASS.

#### RED Cycle T7-S01 — Support: rejects invalid Tracker metadata atomically

1. **Write the failing test.**
   - Scenario: `rejects invalid Tracker metadata atomically`
   - Test file: `server/src/routes/tracker-item-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given Status and Priority have wrong kinds, references cross workspaces, membership is stale, and dates are invalid; When POST /work-items runs; Then all stable field errors return and no item, relation, or tracker activity row exists.
   - Exercise through: Express POST /work-items through Supertest against a real migrated PostgreSQL database.
   - Test doubles: spy only post-commit publishers; keep route, parser, validator, Kysely, database, relation, and activity collaborators real.
   - Expected RED: Current Tracker creation runs scalar parsers before its transaction and returns on the first invalid field; therefore it cannot return all stable field errors together and the aggregate-error assertion fails.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"rejects invalid Tracker metadata atomically\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `server/src/routes/tracker-item-create.ts`, `server/src/routes/tracker-items.ts`. Create the strict transaction-scoped handler, wire both canonical and legacy routing through it, aggregate field errors before writes, and keep post-commit publication behavior unchanged for the later publisher-failure cycle.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"rejects invalid Tracker metadata atomically\""`. Expected: PASS.

#### Regression Verification T7-S04 — Support: rolls back invalid Tracker create side effects

1. **Define the regression verification.**
   - Scenario: `rolls back invalid Tracker create side effects`
   - Test file: `server/src/routes/tracker-item-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given metadata validation fails after several invalid fields are submitted; When POST /work-items rejects; Then no tracker item, relation, tracker activity, realtime event, or notification exists.
   - Exercise through: Express POST /work-items through Supertest against a real migrated PostgreSQL database.
   - Test doubles: spy only post-commit publishers; keep route and database collaborators real.
   - Baseline timing: Run after T7-S01 strict transaction handling is green.
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"rolls back invalid Tracker create side effects\""`. Expected: PASS; invalid metadata must leave zero tracker rows, relations, activity, or post-commit effects..
3. **Run the same verification after this task's production changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"rolls back invalid Tracker create side effects\""`. Expected: PASS.

#### RED Cycle T7-S05 — Support: keeps committed Tracker success after publisher failure

1. **Write the failing test.**
   - Scenario: `keeps committed Tracker success after publisher failure`
   - Test file: `server/src/routes/tracker-item-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given a valid Tracker transaction commits and post-commit publishers reject; When POST /work-items completes; Then the hydrated HTTP response remains successful and committed rows remain.
   - Exercise through: Express POST /work-items through Supertest against a real migrated PostgreSQL database.
   - Test doubles: force event and notification publisher failures; keep transaction and activity collaborators real.
   - Expected RED: Evaluated against the handler as it stands after T7-S01, not against the pre-task route. The extracted handler still carries forward the original ordering — `await publishEvent(...)` before status 201, with no catch around publisher rejection — so a committed row is followed by an HTTP failure instead of the asserted successful response. If T7-S01 already made publication best-effort, this cycle is not red: record it as a Regression Verification instead.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"keeps committed Tracker success after publisher failure\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `server/src/routes/tracker-item-create.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"keeps committed Tracker success after publisher failure\""`. Expected: PASS.

#### Regression Verification T7-S06 — Support: preserves Phase inference and rejects Project Phase mismatch on Tracker create

1. **Define the regression verification.**
   - Scenario: `preserves Phase inference and rejects Project Phase mismatch on Tracker create`
   - Test file: `server/src/routes/tracker-item-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given Phase-only Tracker metadata and then a valid same-workspace mismatched Project/Phase pair; When POST /work-items handles each request; Then the first persists the inferred Project and the second returns stable errors with zero writes
   - Exercise through: public Express POST /work-items cases through Supertest and real PostgreSQL.
   - Test doubles: publisher spies only; keep route, validator, transaction, and DB real.
   - Baseline timing: Run after T7-S01 strict handler and T3-S05 are green
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"preserves Tracker Phase inference and mismatch rejection\""`. Expected: PASS.
3. **Run the same verification after this task's remaining changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"preserves Tracker Phase inference and mismatch rejection\""`. Expected: PASS.

#### RED Cycle T7-S07 — Support: constructs the Tracker response before commit completes

1. **Write the failing test.**
   - Scenario: `constructs the Tracker response before commit completes`
   - Test file: `server/src/routes/tracker-item-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given a valid Tracker create; When SQL ordering is recorded; Then all database queries required for the hydrated WorkItem response occur inside the transaction before COMMIT and none occur before HTTP success afterward.
   - Exercise through: public POST /work-items with real PostgreSQL and a query-order recorder around the DB driver.
   - Test doubles: record query/transaction boundaries only; keep handler, SQL execution, validator, relations, and activity real.
   - Expected RED: Evaluated against the handler as it stands after the earlier T7 cycles. It still carries forward the pre-task shape — resolving the created row and hydrating the mutation item after the transaction commits — so query ordering records post-COMMIT database reads. If an earlier cycle already moved hydration inside the transaction, this cycle is not red: record it as a Regression Verification instead.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"constructs the Tracker response before commit completes\""`. Expected: FAIL on post-COMMIT hydration queries.
3. **Implement the minimum behavior.** File: `server/src/routes/tracker-item-create.ts`. Build the complete WorkItem response from transaction-scoped results and leave only best-effort publication after commit.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"constructs the Tracker response before commit completes\""`. Expected: PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts && npm run test --workspace=server -- src/routes/tracker-items.write.test.ts src/routes/work-items.test.ts`. Expected: PASS.
3. **Commit:** `git add server/src/routes/tracker-item-create.ts server/src/routes/tracker-items.ts server/src/routes/tracker-item-create-metadata.integration.test.ts server/src/routes/tracker-items.write.test.ts server/src/routes/work-items.test.ts` then `git commit -m "feat(tracker): create items with strict atomic metadata"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: deep. The boundary is independently runnable after T3 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: Both Tracker endpoints must share one handler and write only tracker_items, relations, and tracker_events inside the transaction.]
You are implementing Strict Tracker item creation backend for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T3.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Both Tracker endpoints must share one handler and write only tracker_items, relations, and tracker_events inside the transaction.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `feat(tracker): create items with strict atomic metadata` exists.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Every RED cycle runs before its implementation and reruns the identical command for PASS; every Regression Verification records its stated baseline/prerequisite result and reruns the same command after production changes.
- Client component tests keep the reducer, editor, popover, provider, context, and field definitions real whenever those units collaborate.
- Real server integration tests use `RUN_INTEGRATION=1`, Supertest, and migrated PostgreSQL without mocking route, validator, Kysely, DBExecutor, relation, or activity collaborators.
- Rule-of-three and size refactors stay bounded to mapped files; server imports retain `.js`; client imports omit extensions.
- The conventional commit is created after every cycle is green.

Must-not-have:

- No files outside OBJECTIVE, no source behavior outside the approved scenarios, and no test implementation copied into this plan.
- No existing-task editing, Description command, extra command surface, value creation, Board Status or Column command, natural-language parsing, chip persistence, table or event consolidation, idempotency system, migration, dependency, `contenteditable`, editor library, or `camel-lottie/` change.
- No global database access from the shared validator and no pre-commit realtime or notification publication.

Open question risks:

- Click-away on a partial command remains literal.
- A lost committed response can still produce a duplicate after manual retry because durable idempotency is out of scope.
- Initial Board Due date is represented by create activity and does not emit a due-date-change notification.

Rollback note:

- Deploy server before client and roll back client before server. Preserve lock correctness unless directly proven regressive.

## STOP CONDITIONS

Done when every declared RED becomes green, the packet suite passes, scope remains bounded, and the conventional commit exists. Uncertain when an approved assumption conflicts with existing public behavior. Escalate before changing approved behavior, touching an unmapped file, adding schema or dependency work, publishing effects before commit, accepting Board statusId, or merging Board and Tracker persistence.

---

### Phase C — Concurrency hardening and surface integration
