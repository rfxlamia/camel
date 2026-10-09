# Task T3 — Transactional task metadata validation and workspace lock primitives

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: Transactional task metadata validation and workspace lock primitives [prereq]

## OBJECTIVE

Create a transaction-scoped metadata validator, strict date parser behavior, and deterministic workspace/reference lock primitives for both create backends.

Files:

- Create: `server/src/routes/work-item-create-metadata.ts`
- Create: `server/src/routes/work-item-create-metadata.integration.test.ts`
- Create: `server/src/routes/workspace-mutation-lock.ts`
- Create: `server/src/routes/workspace-mutation-lock.test.ts`
- Modify: `server/src/routes/tracker-item-parsers.ts`
- Test: `server/src/routes/tracker-item-parsers.test.ts`

Steps:

#### RED Cycle T3-C01 — GWT Scenario: Reject multiple stale references together

1. **Write the failing test.**
   - Scenario: `Reject multiple stale references together`
   - Test file: `server/src/routes/work-item-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given Project Web and Assignee Rafi are both stale in a real transaction fixture; When the exported transaction-scoped validator evaluates the metadata; Then one stable field-error map contains Project and Assignee errors and the transaction has performed no mutation.
   - Exercise through: the exported validator inside a real migrated PostgreSQL test transaction using its DBExecutor.
   - Test doubles: none for PostgreSQL, DBExecutor, and validator; control only time if a date assertion needs it.
   - Expected RED: `server/src/routes/work-item-create-metadata.ts` and the planned transaction-scoped `validateTaskCreateMetadata` export do not exist, so the integration test import fails before Project and Assignee field errors can be aggregated.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-create-metadata.integration.test.ts -t "\"Reject multiple stale references together\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `server/src/routes/work-item-create-metadata.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-create-metadata.integration.test.ts -t "\"Reject multiple stale references together\""`. Expected: PASS.

#### Regression Verification T3-S01 — Support: rejects a revoked membership in transaction-scoped validation

1. **Define the regression verification.**
   - Scenario: `rejects a revoked membership in transaction-scoped validation`
   - Test file: `server/src/routes/work-item-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given an assignee ID belongs to a user whose workspace membership is absent; When the exported validator runs inside a real transaction; Then the stable Assignee error is returned without mutation.
   - Exercise through: the exported validator in a real migrated PostgreSQL transaction.
   - Test doubles: none for PostgreSQL, DBExecutor, and validator; control only time if required.
   - Baseline timing: Run after T3-C01 aggregate validation is green.
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-create-metadata.integration.test.ts -t "\"rejects a revoked membership in transaction-scoped validation\""`. Expected: PASS because a revoked member and a stale assignee both resolve to an absent workspace_members row in the same transaction-scoped validator..
3. **Run the same verification after this task's remaining production changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-create-metadata.integration.test.ts -t "\"rejects a revoked membership in transaction-scoped validation\""`. Expected: PASS.

#### RED Cycle T3-S02 — Support: rejects cross-workspace and wrong-kind references together

1. **Write the failing test.**
   - Scenario: `rejects cross-workspace and wrong-kind references together`
   - Test file: `server/src/routes/work-item-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given Status, Priority, Labels, Project, and Phase include cross-workspace and wrong-kind records; When the exported validator runs inside a real transaction; Then all affected stable fields are reported in deterministic order without mutation.
   - Exercise through: the exported validator in a real migrated PostgreSQL transaction.
   - Test doubles: none for PostgreSQL, DBExecutor, and validator.
   - Expected RED: Current parsers query through global `db` and return on the first invalid reference, so the assertion for deterministic simultaneous Status, Priority, Labels, Project, and Phase errors fails.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-create-metadata.integration.test.ts -t "\"rejects cross-workspace and wrong-kind references together\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `server/src/routes/work-item-create-metadata.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-create-metadata.integration.test.ts -t "\"rejects cross-workspace and wrong-kind references together\""`. Expected: PASS.

#### RED Cycle T3-S03 — Support: orders deterministic workspace and reference locks

1. **Write the failing test.**
   - Scenario: `orders deterministic workspace and reference locks`
   - Test file: `server/src/routes/workspace-mutation-lock.test.ts`
   - Level: unit.
   - Test intent: Given mixed reference categories and unsorted IDs are supplied; When the exported lock helper builds its acquisition sequence; Then workspace is first, categories are fixed, and IDs are sorted before destination locking.
   - Exercise through: the exported pure lock-order function and a recording DBExecutor adapter.
   - Test doubles: use one recording DBExecutor fake; keep the lock-order function real.
   - Expected RED: `server/src/routes/workspace-mutation-lock.ts` and its planned `lockTaskCreateReferences` export do not exist, so the recording executor receives no workspace/reference/destination acquisition sequence.
2. **Run RED:** `npm run test --workspace=server -- src/routes/workspace-mutation-lock.test.ts -t "\"orders deterministic workspace and reference locks\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `server/src/routes/workspace-mutation-lock.ts`. Implement `lockWorkspaceMutation` and `lockTaskCreateReferences` with this deterministic acquisition order exactly: lock the `workspaces` row first; lock and revalidate `workspace_members` rows ordered by user ID; lock and revalidate `tracker_vocabularies` rows ordered by vocabulary ID; lock and revalidate `tracker_projects` rows ordered by project ID; lock and revalidate `tracker_phases` rows ordered by phase ID; lock the destination `columns` row last for Board create. Omit categories absent from a request, but never reorder categories that are present.
4. **Run PASS:** `npm run test --workspace=server -- src/routes/workspace-mutation-lock.test.ts -t "\"orders deterministic workspace and reference locks\""`. Expected: PASS.

#### RED Cycle T3-S04 — Support: rejects malformed and reversed date-only inputs

1. **Write the failing test.**
   - Scenario: `rejects malformed and reversed date-only inputs`
   - Test file: `server/src/routes/tracker-item-parsers.test.ts`
   - Level: unit.
   - Test intent: Given malformed calendar values and End before Start are supplied; When public parser exports normalize the create input; Then invalid values produce field errors without coercion.
   - Exercise through: the public tracker item parser exports.
   - Test doubles: none.
   - Expected RED: `parseDateRange` currently returns one unkeyed `{ error: string }` and stops at the first malformed value, so the assertion for concrete `startDate`/`endDate` field errors across malformed and reversed input fails.
2. **Run RED:** `npm run test --workspace=server -- src/routes/tracker-item-parsers.test.ts -t "\"rejects malformed and reversed date-only inputs\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `server/src/routes/tracker-item-parsers.ts`. Extend the concrete `parseDateRange`/date-only parsing contract **additively**: keep strict `YYYY-MM-DD` calendar validation, keep the existing End-before-Start rejection (already implemented), and add stable field-specific `startDate` and `endDate` errors without coercion. The change MUST be additive — the existing `{ error: string }` member of the return union stays, and the existing single-error text is unchanged — so that out-of-scope callers keep compiling and behaving identically. Verified callers outside this task: `server/src/routes/tracker-phases.ts:168` and `:269` (owned by T10 in Phase 3, which does not touch this contract) and `server/src/routes/tracker-items.ts:475` and `:972` (owned by T7). A replacement-style return type would break `tracker-phases.ts` typecheck for the whole span between Phase 1 and Phase 3 with no task permitted to repair it. Confirm with `npm run typecheck --workspace=server` before the packet commit.
4. **Run PASS:** `npm run test --workspace=server -- src/routes/tracker-item-parsers.test.ts -t "\"rejects malformed and reversed date-only inputs\""`. Expected: PASS.

#### Regression Verification T3-S05 — Support: validates Phase inference and Project/Phase mismatch

1. **Define the regression verification.**
   - Scenario: `validates Phase inference and Project/Phase mismatch`
   - Test file: `server/src/routes/work-item-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given Phase-only input and a valid same-workspace mismatched Project/Phase pair; When the shared transaction-scoped validator runs; Then Phase-only input normalizes to its parent Project and the mismatched pair returns stable Project/Phase errors without writes
   - Exercise through: the exported validator inside a real migrated PostgreSQL transaction.
   - Test doubles: none for validator, DBExecutor, or PostgreSQL.
   - Baseline timing: Run after T3-C01 aggregate reference validation is green
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-create-metadata.integration.test.ts -t "\"validates Phase inference and Project Phase mismatch\""`. Expected: PASS.
3. **Run the same verification after this task's remaining changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-create-metadata.integration.test.ts -t "\"validates Phase inference and Project Phase mismatch\""`. Expected: PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-create-metadata.integration.test.ts && npm run test --workspace=server -- src/routes/workspace-mutation-lock.test.ts src/routes/tracker-item-parsers.test.ts && npm run typecheck --workspace=server`. Expected: PASS. The typecheck run proves the additive `parseDateRange` contract did not break `tracker-phases.ts`.
3. **Commit:** `git add server/src/routes/work-item-create-metadata.ts server/src/routes/work-item-create-metadata.integration.test.ts server/src/routes/workspace-mutation-lock.ts server/src/routes/workspace-mutation-lock.test.ts server/src/routes/tracker-item-parsers.ts server/src/routes/tracker-item-parsers.test.ts` then `git commit -m "feat(server): add transactional task metadata validation"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: deep. The boundary is independently runnable after none and keeps one bounded deliverable without moving behavior into another task.

**Reuse before reimplementation.** `server/src/routes/tracker-item-parsers.ts` already validates the same four reference categories this task needs: `parsePriorityId` (:33), `parseLabelIds` (:60), `parseAssigneeIds` (:90), and `parseProjectPhase` (:120). They cannot be used as-is for two concrete reasons — they query the module-level `db` rather than a supplied transaction, and they return on the first invalid reference instead of aggregating field errors. Neither reason justifies a second parallel implementation.

Preferred approach, in order:

1. This task already opens `tracker-item-parsers.ts` for modification. Thread an optional `dbExec: DBExecutor = db` parameter through the four existing parsers. The default keeps every current PATCH caller compiling and behaving identically, and it makes them transaction-usable.
2. Build `validateTaskCreateMetadata` in `work-item-create-metadata.ts` as a thin aggregator that calls those parsers with the supplied transaction executor and collects their errors into the stable field-error map, rather than re-issuing its own `tracker_vocabularies` / `workspace_members` / `tracker_projects` / `tracker_phases` lookups.
3. Reimplement a category from scratch only where the existing parser genuinely cannot express the required create-time semantics; when that happens, say so in the packet report.

Duplicating all four lookups leaves two validators live indefinitely — the new one for create, the old one for PATCH — with the cross-workspace and wrong-kind rules maintained in two places. That is the outcome to avoid.

## SANDWICH CONTEXT

[CRITICAL: Validation must use the supplied transaction DBExecutor; workspace and deterministic references lock before destination and every write.]
You are implementing Transactional task metadata validation and workspace lock primitives for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: none.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Validation must use the supplied transaction DBExecutor; workspace and deterministic references lock before destination and every write.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `feat(server): add transactional task metadata validation` exists.

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

### Phase B — Shared UI and atomic backends
