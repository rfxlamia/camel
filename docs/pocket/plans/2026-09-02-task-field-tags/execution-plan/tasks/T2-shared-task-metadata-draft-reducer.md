# Task T2 — Shared task metadata draft reducer

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 2: Shared task metadata draft reducer [depends: T1]

## OBJECTIVE

Create one deterministic metadata reducer per form for cardinality, Project and Phase invariants, local date behavior, payload normalization, and selective reset.

Files:

- Create: `client/src/components/task-entry/taskMetadataDraft.ts`
- Test: `client/src/components/task-entry/taskMetadataDraft.test.ts`

Steps:

#### RED Cycle T2-C01 — GWT Scenario: Replace a single-value field

1. **Write the failing test.**
   - Scenario: `Replace a single-value field`
   - Test file: `client/src/components/task-entry/taskMetadataDraft.test.ts`
   - Level: unit.
   - Test intent: Given the draft contains Priority High; When the reducer receives Priority Low; Then Low replaces High and the payload has exactly one priority.
   - Exercise through: the exported reducer and payload selector.
   - Test doubles: none.
   - Expected RED: `client/src/components/task-entry/taskMetadataDraft.ts` and its planned `taskMetadataReducer`/payload selector exports do not exist, so the test import fails before it can assert that Low replaces High.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Replace a single-value field\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/taskMetadataDraft.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Replace a single-value field\""`. Expected: PASS.

#### RED Cycle T2-C02 — GWT Scenario: Prevent duplicate multi-value relations

1. **Write the failing test.**
   - Scenario: `Prevent duplicate multi-value relations`
   - Test file: `client/src/components/task-entry/taskMetadataDraft.test.ts`
   - Level: unit.
   - Test intent: Given Rafi is already present in the assignee selection; When the reducer receives the command-flow toggle for Rafi again; Then existing toggle semantics apply and the payload contains no duplicate user ID.
   - Exercise through: the exported reducer and payload selector.
   - Test doubles: none.
   - Expected RED: `taskMetadataReducer` exists after T2-C01 but has no assignee toggle transition or payload deduplication, so selecting Rafi twice produces the wrong selected IDs or duplicate payload entries.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Prevent duplicate multi-value relations\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/taskMetadataDraft.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Prevent duplicate multi-value relations\""`. Expected: PASS.

#### RED Cycle T2-C03 — GWT Scenario: Derive Project from Phase

1. **Write the failing test.**
   - Scenario: `Derive Project from Phase`
   - Test file: `client/src/components/task-entry/taskMetadataDraft.test.ts`
   - Level: unit.
   - Test intent: Given the draft has no Project and Phase Launch belongs to Project Web; When the reducer selects Phase Launch; Then Project Web is derived and both IDs appear in the payload.
   - Exercise through: the exported reducer with fixed project-phase records.
   - Test doubles: none.
   - Expected RED: `taskMetadataReducer` has Priority and assignee transitions after T2-C02 but no Phase-selection transition that derives the parent Project, so the expected Project Web and Phase Launch IDs are not both present.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Derive Project from Phase\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/taskMetadataDraft.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Derive Project from Phase\""`. Expected: PASS.

#### RED Cycle T2-C04 — GWT Scenario: Clear an incompatible Phase

1. **Write the failing test.**
   - Scenario: `Clear an incompatible Phase`
   - Test file: `client/src/components/task-entry/taskMetadataDraft.test.ts`
   - Level: unit.
   - Test intent: Given Project Web and Phase Build are selected; When the reducer changes Project to Mobile where Build is unavailable; Then Phase is cleared.
   - Exercise through: the exported reducer with fixed project-phase records.
   - Test doubles: none.
   - Expected RED: After T2-C03 derives a Project from Phase, the Project-change transition does not yet clear a Phase that is absent from the new Project, so Phase Build remains selected after switching to Mobile.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Clear an incompatible Phase\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/taskMetadataDraft.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Clear an incompatible Phase\""`. Expected: PASS.

#### RED Cycle T2-C05 — GWT Scenario: Clear Phase when Project is removed

1. **Write the failing test.**
   - Scenario: `Clear Phase when Project is removed`
   - Test file: `client/src/components/task-entry/taskMetadataDraft.test.ts`
   - Level: unit.
   - Test intent: Given Project Web and Phase Build are selected; When the reducer removes Project; Then both Project and Phase values are absent.
   - Exercise through: the exported reducer and payload selector.
   - Test doubles: none.
   - Expected RED: After T2-C04 handles Project replacement, the Project-removal transition does not yet cascade to Phase, so removing Project Web leaves the Phase Build value in the draft.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Clear Phase when Project is removed\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/taskMetadataDraft.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Clear Phase when Project is removed\""`. Expected: PASS.

#### RED Cycle T2-C06 — GWT Scenario: Resolve a Next week preset

1. **Write the failing test.**
   - Scenario: `Resolve a Next week preset`
   - Test file: `client/src/components/task-entry/taskMetadataDraft.test.ts`
   - Level: unit.
   - Test intent: Given the local calendar date is 2026-09-02; When the date operation selects Next week; Then the draft and payload contain 2026-09-09.
   - Exercise through: the exported date operation and payload selector.
   - Test doubles: control time with Vitest fake timers; keep date-fns and reducer real.
   - Expected RED: The reducer has no local-calendar preset action or `date-fns` mapping after T2-C05, so Next week cannot resolve from 2026-09-02 to the asserted date-only value 2026-09-09.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Resolve a Next week preset\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/taskMetadataDraft.ts`. Add Today, Tomorrow, and Next week (+7 days) actions using local `date-fns` `addDays` plus `format("yyyy-MM-dd")`; explicitly cover DST, month-end, and year-end without elapsed UTC-hour arithmetic.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Resolve a Next week preset\""`. Expected: PASS.

#### Regression Verification T2-C07 — GWT Scenario: Preserve calendar dates across time boundaries

1. **Define the regression verification.**
   - Scenario: `Preserve calendar dates across time boundaries`
   - Test file: `client/src/components/task-entry/taskMetadataDraft.test.ts`
   - Level: unit.
   - Test intent: Given Today, Tomorrow, and Next week cross fixed DST, month, and year boundaries; When each preset is resolved; Then local calendar arithmetic preserves the intended YYYY-MM-DD values without UTC-hour drift.
   - Exercise through: the exported date operations.
   - Test doubles: control time with Vitest fake timers; keep date-fns real.
   - Baseline timing: Run after T2-C06 local-calendar preset arithmetic is green.
2. **Run the baseline/prerequisite verification:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Preserve calendar dates across time boundaries\""`. Expected: PASS across DST, month, and year boundaries; this constrains the date-fns-based implementation rather than manufacturing a second RED..
3. **Run the same verification after this task's remaining production changes:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Preserve calendar dates across time boundaries\""`. Expected: PASS.

#### RED Cycle T2-C08 — GWT Scenario: Reject an invalid Tracker date range immediately

1. **Write the failing test.**
   - Scenario: `Reject an invalid Tracker date range immediately`
   - Test file: `client/src/components/task-entry/taskMetadataDraft.test.ts`
   - Level: unit.
   - Test intent: Given Start date is 2026-09-10 and a previous valid End date exists; When the reducer attempts End date 2026-09-09; Then the new value is rejected, the prior value remains, and the state exposes the specified explanation.
   - Exercise through: the exported reducer and validation selector.
   - Test doubles: none.
   - Expected RED: Date values can be stored after T2-C07, but the reducer has no range guard that rejects End date before Start date while retaining the previous value and error state.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Reject an invalid Tracker date range immediately\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/taskMetadataDraft.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Reject an invalid Tracker date range immediately\""`. Expected: PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts`. Expected: PASS.
3. **Commit:** `git add client/src/components/task-entry/taskMetadataDraft.ts client/src/components/task-entry/taskMetadataDraft.test.ts` then `git commit -m "feat(task-entry): add task metadata draft reducer"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: standard. The boundary is independently runnable after T1 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: Use one reducer instance as the sole metadata source for commands, chips, existing controls, and payload selection.]
You are implementing Shared task metadata draft reducer for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T1.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Use one reducer instance as the sole metadata source for commands, chips, existing controls, and payload selection.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `feat(task-entry): add task metadata draft reducer` exists.

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
