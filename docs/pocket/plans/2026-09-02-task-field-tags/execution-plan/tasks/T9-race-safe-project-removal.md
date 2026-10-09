# Task T9 — Race-safe project removal

**Phase:** 3
**Depends:** T6, T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 9: Race-safe project removal [depends: T6, T7] [parallel: T8] [parallel: T10] [test-risk]

## OBJECTIVE

Make project release and removal acquire deterministic workspace and project locks before dependent scans, then verify Board and Tracker races independently.

Files:

- Modify: `server/src/routes/tracker-projects.ts`
- Test: `server/src/routes/tracker-projects.test.ts`
- Create: `server/src/routes/work-item-project-concurrency.integration.test.ts`

Steps:

#### RED Cycle T9-S01 — Support: locks project removal before dependent scans

1. **Write the failing test.**
   - Scenario: `locks project removal before dependent scans`
   - Test file: `server/src/routes/tracker-projects.test.ts`
   - Level: unit.
   - Test intent: Given an authorized project release has dependent items and phases; When the mocked transaction records route orchestration; Then the route calls the real imported `lockWorkspaceMutation` helper first, locks/revalidates the project next, and only then invokes dependent scan, release, cleanup, activity, and soft-delete collaborators.
   - Exercise through: the project route with its existing mocked route harness; assert collaborator call order, not PostgreSQL row-lock behavior.
   - Test doubles: mock Kysely/transaction query chains and dependent scan/release collaborators; keep route orchestration and the imported `lockWorkspaceMutation` helper real. This unit test does not claim to prove PostgreSQL row locks or SQL serialization.
   - Expected RED: Current project deletion queries `tracker_projects` and dependent `tracker_items`/`cards` without calling `lockWorkspaceMutation` or using `FOR UPDATE`, so the mocked transaction call-order assertion does not record workspace lock then project revalidation first.
2. **Run RED:** `npm run test --workspace=server -- src/routes/tracker-projects.test.ts -t "\"locks project removal before dependent scans\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `server/src/routes/tracker-projects.ts`. Lock the workspace first, lock/revalidate the Project second, then preserve dependent scans, phase soft-delete, Tracker/Card release, activity, and post-commit events.
4. **Run PASS:** `npm run test --workspace=server -- src/routes/tracker-projects.test.ts -t "\"locks project removal before dependent scans\""`. Expected: PASS, then run T9-S02 and T9-S03 regression verifications.

#### Regression Verification T9-S02 — Support: serializes Board create against project removal

1. **Define the regression verification.**
   - Scenario: `serializes Board create against project removal`
   - Test file: `server/src/routes/work-item-project-concurrency.integration.test.ts`
   - Level: integration.
   - Test intent: Given a Board create selects Project Web while its removal transaction is interleaved; When synchronization barriers release both transactions; Then the card is complete against a still-valid project or rejects completely with no partial rows and effects.
   - Exercise through: real Board create and project-removal routes through Supertest and PostgreSQL.
   - Test doubles: scheduling barriers and publisher spies; keep routes, locks, validator, transactions, and database real.
   - Baseline timing: Run after T9-S01 workspace/project lock ordering is green; do not claim a pre-change RED unless a deterministic violating interleaving is demonstrated.
2. **Run the prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-project-concurrency.integration.test.ts -t "\"serializes Board create against project removal\""`. Expected: PASS for the complete-create-or-complete-release outcome.
3. **Run the same verification after task refactor:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-project-concurrency.integration.test.ts -t "\"serializes Board create against project removal\""`. Expected: PASS.

#### Regression Verification T9-S03 — Support: serializes Tracker create against project removal

1. **Define the regression verification.**
   - Scenario: `serializes Tracker create against project removal`
   - Test file: `server/src/routes/work-item-project-concurrency.integration.test.ts`
   - Level: integration.
   - Test intent: Given a Tracker create selects Project Web and child Phase Build while project removal is interleaved; When synchronization barriers release both transactions; Then the item is complete against a valid context or rejects with Project context feedback and no partial rows and effects.
   - Exercise through: real Tracker create and project-removal routes through Supertest and PostgreSQL.
   - Test doubles: scheduling barriers and publisher spies; keep routes, locks, validator, transactions, and database real.
   - Baseline timing: Run after T9-S01 workspace/project lock ordering is green; do not claim a pre-change RED unless a deterministic violating interleaving is demonstrated.
2. **Run the prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-project-concurrency.integration.test.ts -t "\"serializes Tracker create against project removal\""`. Expected: PASS for the complete-create-or-complete-release outcome.
3. **Run the same verification after task refactor:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-project-concurrency.integration.test.ts -t "\"serializes Tracker create against project removal\""`. Expected: PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `npm run test --workspace=server -- src/routes/tracker-projects.test.ts && RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-project-concurrency.integration.test.ts`. Expected: PASS.
3. **Commit:** `git add server/src/routes/tracker-projects.ts server/src/routes/tracker-projects.test.ts server/src/routes/work-item-project-concurrency.integration.test.ts` then `git commit -m "fix(projects): serialize project removal with task create"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: deep. The boundary is independently runnable after T6 and T7 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: The exact implementation starts with the T3 workspace lock primitive, locks and revalidates the project row, then runs existing dependent scans, release, cleanup, activity, and soft deletion in deterministic order.]
You are implementing Race-safe project removal for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T6 and T7.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: The exact implementation starts with the T3 workspace lock primitive, locks and revalidates the project row, then runs existing dependent scans, release, cleanup, activity, and soft deletion in deterministic order.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `fix(projects): serialize project removal with task create` exists.

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
