# Task T10 — Race-safe phase removal

**Phase:** 3
**Depends:** T6, T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 10: Race-safe phase removal [depends: T6, T7] [parallel: T8] [test-risk]

## OBJECTIVE

Make phase release and removal acquire deterministic workspace and phase locks before dependent scans, then verify Board and Tracker races independently.

Files:

- Modify: `server/src/routes/tracker-phases.ts`
- Test: `server/src/routes/tracker-phases.test.ts`
- Create: `server/src/routes/work-item-phase-concurrency.integration.test.ts`

Steps:

#### RED Cycle T10-S01 — Support: locks phase removal before dependent scans

1. **Write the failing test.**
   - Scenario: `locks phase removal before dependent scans`
   - Test file: `server/src/routes/tracker-phases.test.ts`
   - Level: unit.
   - Test intent: Given the phase-removal transaction runs with a phase and owning project; When route orchestration is recorded; Then it calls the workspace lock first, locks/revalidates the owning Project second, locks/revalidates the Phase third, and only then invokes dependent Tracker/Card scans and release/cleanup.
   - Exercise through: the phase route with its existing mocked route harness; assert collaborator call order, not PostgreSQL row-lock behavior.
   - Test doubles: mock Kysely/transaction query chains and dependent release collaborators; keep route orchestration and the imported `lockWorkspaceMutation` helper real. This unit test does not claim to prove PostgreSQL row locks or SQL serialization.
   - Expected RED: Current phase deletion calls `lookupPhaseInWorkspace` and `releasePhaseItemsToNoPhase` without the T3 workspace → owning Project → Phase lock sequence, so the recorded calls reach Phase/dependent access before the required workspace and Project locks.
2. **Run RED:** `npm run test --workspace=server -- src/routes/tracker-phases.test.ts -t "\"locks phase removal before dependent scans\""`. Expected: FAIL for the assertion described above.
3. **Do not implement yet.** Continue to the next RED cycle in this task; all lock-order and concurrency tests must be observed failing before the shared GREEN change.

#### RED Cycle T10-S02 — Support: serializes Board create against phase removal

1. **Write the failing test.**
   - Scenario: `serializes Board create against phase removal`
   - Test file: `server/src/routes/work-item-phase-concurrency.integration.test.ts`
   - Level: integration.
   - Database proof: this new `.integration.test.ts` cycle alone proves SQL serialization; use real Supertest routes, PostgreSQL, transactions, and lock helpers with no mocks for route/DB/lock collaborators.
   - Test intent: Given a Board create selects Phase Build and Project Web while phase removal is interleaved; When synchronization barriers release both transactions; Then the card commits with a valid pair or rejects completely with no partial rows and effects.
   - Exercise through: real Board create and phase-removal routes through Supertest and PostgreSQL.
   - Test doubles: scheduling barriers and publisher spies; keep routes, locks, validator, transactions, and database real.
   - Expected RED: Current phase deletion has no workspace/phase lock protocol before releasing dependent items, so an interleaved Board create can validate Phase Build during deletion and violate the asserted serialized result.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-phase-concurrency.integration.test.ts -t "\"serializes Board create against phase removal\""`. Expected: FAIL for the assertion described above.
3. **Do not implement yet.** Continue to the next RED cycle in this task; all lock-order and concurrency tests must be observed failing before the shared GREEN change.

#### RED Cycle T10-S03 — Support: serializes Tracker create against phase removal

1. **Write the failing test.**
   - Scenario: `serializes Tracker create against phase removal`
   - Test file: `server/src/routes/work-item-phase-concurrency.integration.test.ts`
   - Level: integration.
   - Database proof: this new `.integration.test.ts` cycle alone proves SQL serialization; use real Supertest routes, PostgreSQL, transactions, and lock helpers with no mocks for route/DB/lock collaborators.
   - Test intent: Given a Tracker create selects Phase Build and Project Web while phase removal is interleaved; When synchronization barriers release both transactions; Then the item commits with a valid pair or rejects with Phase context feedback and no partial rows and effects.
   - Exercise through: real Tracker create and phase-removal routes through Supertest and PostgreSQL.
   - Test doubles: scheduling barriers and publisher spies; keep routes, locks, validator, transactions, and database real.
   - Expected RED: Current phase deletion releases Tracker items before any shared workspace/phase lock, so an interleaved Tracker create can race the soft delete and violate the complete-valid-or-complete-rejection invariant.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-phase-concurrency.integration.test.ts -t "\"serializes Tracker create against phase removal\""`. Expected: FAIL for the assertion described above.
3. **Do not implement yet.** Continue to T10-S04 and record the Board cleanup RED before the shared GREEN change.

#### RED Cycle T10-S04 — Support: clears Board card phase metadata on phase removal

1. **Write the failing test.**
   - Scenario: `clears Board card phase metadata on phase removal`
   - Test file: `server/src/routes/work-item-phase-concurrency.integration.test.ts`
   - Level: integration.
   - Test intent: Given a non-deleted Board card belongs to Project Web and Phase Build; When Phase Build removal commits after the card exists; Then the card preserves project_id, clears phase_id, increments version, writes one card_events update describing Phase removal, and publishes one post-commit card.updated event.
   - Exercise through: Express phase DELETE through Supertest plus real PostgreSQL card/card_events assertions and a post-commit publisher spy.
   - Test doubles: scheduling control and publisher spy only; keep phase route, workspace/project/phase locks, Kysely, database, card update, and activity write real.
   - Expected RED: Current phase deletion releases only tracker_items, soft-deletes the phase, and never updates cards, so phase_id remains set, version/card_events do not change, and no card.updated event is published.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-phase-concurrency.integration.test.ts -t "\"clears Board card phase metadata on phase removal\""`. Expected: FAIL on the Board card cleanup assertions.
3. **Implement the shared GREEN behavior.** File: `server/src/routes/tracker-phases.ts`. For T10-S01 through T10-S04, lock workspace first, then lock/revalidate the owning tracker_projects row, then lock/revalidate the tracker_phases row; only afterward scan dependents. Release/reposition tracker_items; select affected non-deleted cards, preserve project_id, clear phase_id, increment version, and write card_events via recordActivity; soft-delete the phase and record phase activity; after commit publish one card.updated per affected card and the phase-deleted event.
4. **Run all grouped PASS commands:** rerun the exact T10-S01 unit command, the T10-S02/T10-S03 real concurrency commands, and `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-phase-concurrency.integration.test.ts -t "\"clears Board card phase metadata on phase removal\""`. Expected: PASS for lock order, both interleavings, Tracker release, and every Board cleanup effect.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `npm run test --workspace=server -- src/routes/tracker-phases.test.ts && RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-phase-concurrency.integration.test.ts`. Expected: PASS.
3. **Commit:** `git add server/src/routes/tracker-phases.ts server/src/routes/tracker-phases.test.ts server/src/routes/work-item-phase-concurrency.integration.test.ts` then `git commit -m "fix(phases): serialize phase removal with task create"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: deep. The boundary is independently runnable after T6 and T7 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: The exact implementation starts with the T3 workspace lock primitive, locks and revalidates the phase row, then runs existing dependent scans, release, cleanup, activity, and soft deletion in deterministic order.]
You are implementing Race-safe phase removal for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T6 and T7.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: The exact implementation starts with the T3 workspace lock primitive, locks and revalidates the phase row, then runs existing dependent scans, release, cleanup, activity, and soft deletion in deterministic order.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `fix(phases): serialize phase removal with task create` exists.

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
