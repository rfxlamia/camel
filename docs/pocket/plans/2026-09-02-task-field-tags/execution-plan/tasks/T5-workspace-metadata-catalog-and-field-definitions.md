# Task T5 — Workspace metadata catalog and field definitions

**Phase:** 2
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: Workspace metadata catalog and field definitions [depends: T2] [parallel: T4]

## OBJECTIVE

Create a workspace-scoped catalog provider and exact Board and Tracker field-definition factories with independent states and lock-aware filtering.

Files:

- Create: `client/src/components/task-entry/TaskMetadataCatalogProvider.tsx`
- Create: `client/src/components/task-entry/taskFieldDefinitions.tsx`
- Test: `client/src/components/task-entry/TaskMetadataCatalogProvider.test.tsx`
- Test: `client/src/components/task-entry/taskFieldDefinitions.test.tsx`

Steps:

#### RED Cycle T5-C01 — GWT Scenario: Continue when one catalog fails

1. **Write the failing test.**
   - Scenario: `Continue when one catalog fails`
   - Test file: `client/src/components/task-entry/TaskMetadataCatalogProvider.test.tsx`
   - Level: component integration.
   - Test intent: Given Assignee loading fails while Priority succeeds; When the consumer opens fields and retries Assignee; Then Priority and title-only creation remain usable while Assignee shows its concise error and retry reloads only Assignee.
   - Exercise through: the public provider and context consumed by a test component.
   - Test doubles: mock only api catalog methods; keep provider and context real.
   - Expected RED: `TaskMetadataCatalogProvider` does not exist, so the consumer cannot receive independent Assignee failure/Priority success states or invoke an Assignee-only retry.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskMetadataCatalogProvider.test.tsx -t "\"Continue when one catalog fails\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskMetadataCatalogProvider.tsx`. Add only the independent catalog loading, failure, and per-catalog retry behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskMetadataCatalogProvider.test.tsx -t "\"Continue when one catalog fails\""`. Expected: PASS.

#### Regression Verification T5-C02 — GWT Scenario: Distinguish loading, empty, and failed catalogs

1. **Define the regression verification.**
   - Scenario: `Distinguish loading, empty, and failed catalogs`
   - Test file: `client/src/components/task-entry/TaskMetadataCatalogProvider.test.tsx`
   - Level: component integration.
   - Test intent: Given three catalog requests are independently pending, empty, and rejected; When the provider exposes state to a consumer; Then loading, empty, and failed remain distinct and empty never offers option creation.
   - Exercise through: the public provider and context consumed by a test component.
   - Test doubles: mock only api catalog methods; keep provider and context real.
   - Baseline timing: Run immediately after T5-C01 is green and before field-definition work.
2. **Run the baseline/prerequisite verification:** `npm run test --workspace=client -- src/components/task-entry/TaskMetadataCatalogProvider.test.tsx -t "\"Distinguish loading, empty, and failed catalogs\""`. Expected: PASS; the provider must distinguish loading, ready-empty, and failed states introduced by T5-C01..
3. **Run the same verification after this task's production changes:** `npm run test --workspace=client -- src/components/task-entry/TaskMetadataCatalogProvider.test.tsx -t "\"Distinguish loading, empty, and failed catalogs\""`. Expected: PASS.

#### RED Cycle T5-S01 — Support: defines the exact Board command field set

1. **Write the failing test.**
   - Scenario: `defines the exact Board command field set`
   - Test file: `client/src/components/task-entry/taskFieldDefinitions.test.tsx`
   - Level: unit.
   - Test intent: Given all Board catalogs are available; When the Board definition factory derives fields; Then Assignee, Priority, Labels, Project, Phase, and Due date appear while Status and Column do not.
   - Exercise through: the exported Board definition factory.
   - Test doubles: none.
   - Expected RED: `taskFieldDefinitions.tsx` and the planned Board definition factory do not exist, so the exact six-field list and Status/Column exclusions cannot be asserted.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/taskFieldDefinitions.test.tsx -t "\"defines the exact Board command field set\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/taskFieldDefinitions.tsx`. Implement the Board field-definition factory with exactly Assignee, Priority, Labels, Project, Phase, and Due date and no Status/Column definitions.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/taskFieldDefinitions.test.tsx -t "\"defines the exact Board command field set\""`. Expected: PASS.

#### RED Cycle T5-S02 — Support: defines the exact Tracker command field set

1. **Write the failing test.**
   - Scenario: `defines the exact Tracker command field set`
   - Test file: `client/src/components/task-entry/taskFieldDefinitions.test.tsx`
   - Level: unit.
   - Test intent: Given all Tracker catalogs are available; When the Tracker definition factory derives fields; Then Status, Priority, Assignee, Labels, Project, Phase, Start date, and End date appear.
   - Exercise through: the exported Tracker definition factory.
   - Test doubles: none.
   - Expected RED: The Board factory exists after T5-S01, but `taskFieldDefinitions.tsx` has no Tracker factory, so the asserted eight-field Tracker list cannot be produced.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/taskFieldDefinitions.test.tsx -t "\"defines the exact Tracker command field set\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/taskFieldDefinitions.tsx`. Implement the Tracker field-definition factory with exactly Status, Priority, Assignee, Labels, Project, Phase, Start date, and End date.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/taskFieldDefinitions.test.tsx -t "\"defines the exact Tracker command field set\""`. Expected: PASS.

#### RED Cycle T5-S03 — Support: filters valid locked Tracker fields

1. **Write the failing test.**
   - Scenario: `filters valid locked Tracker fields`
   - Test file: `client/src/components/task-entry/taskFieldDefinitions.test.tsx`
   - Level: unit.
   - Test intent: Given Project Alpha and Phase Build are valid locked context; When the Tracker definition factory derives fields; Then Project and Phase are omitted without changing other definitions.
   - Exercise through: the exported Tracker definition factory.
   - Test doubles: none.
   - Expected RED: The Tracker factory exists after T5-S02 but accepts no valid context-lock descriptor, so Project and Phase remain in the returned field definitions for a locked Project/Phase create surface.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/taskFieldDefinitions.test.tsx -t "\"filters valid locked Tracker fields\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/taskFieldDefinitions.tsx`. Add lock-aware filtering to the Tracker definition factory so valid locked Project/Phase fields are omitted without changing the remaining definitions.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/taskFieldDefinitions.test.tsx -t "\"filters valid locked Tracker fields\""`. Expected: PASS.

#### Regression Verification T5-S04 — Support: deduplicates workspace catalog requests

1. **Define the regression verification.**
   - Scenario: `deduplicates workspace catalog requests`
   - Test file: `client/src/components/task-entry/TaskMetadataCatalogProvider.test.tsx`
   - Level: component integration.
   - Test intent: Given one provider has multiple Add Card consumers in the same workspace; When they mount and then the workspace ID changes; Then each catalog endpoint is requested once for the initial workspace and once for the new workspace, not once per consumer or column.
   - Exercise through: TaskMetadataCatalogProvider with multiple real context consumers.
   - Test doubles: mock only api catalog methods and count calls by workspace ID; keep provider cache/effects and context real.
   - Baseline timing: Run after T5-C01 is green; this verification constrains the provider implementation before Board integration.
2. **Run the prerequisite verification:** `npm run test --workspace=client -- src/components/task-entry/TaskMetadataCatalogProvider.test.tsx -t "\"deduplicates workspace catalog requests\""`. Expected: PASS with one request per catalog per workspace.
3. **Run the same verification after T5 field-definition changes:** `npm run test --workspace=client -- src/components/task-entry/TaskMetadataCatalogProvider.test.tsx -t "\"deduplicates workspace catalog requests\""`. Expected: PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `npm run test --workspace=client -- src/components/task-entry/TaskMetadataCatalogProvider.test.tsx src/components/task-entry/taskFieldDefinitions.test.tsx`. Expected: PASS.
3. **Commit:** `git add client/src/components/task-entry/TaskMetadataCatalogProvider.tsx client/src/components/task-entry/taskFieldDefinitions.tsx client/src/components/task-entry/TaskMetadataCatalogProvider.test.tsx client/src/components/task-entry/taskFieldDefinitions.test.tsx` then `git commit -m "feat(task-entry): add workspace metadata catalogs"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: standard. The boundary is independently runnable after T2 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: Load each catalog once per workspace, keep catalog states independent, and never expose Board Status or Column.]
You are implementing Workspace metadata catalog and field definitions for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T2.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Load each catalog once per workspace, keep catalog states independent, and never expose Board Status or Column.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `feat(task-entry): add workspace metadata catalogs` exists.

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
