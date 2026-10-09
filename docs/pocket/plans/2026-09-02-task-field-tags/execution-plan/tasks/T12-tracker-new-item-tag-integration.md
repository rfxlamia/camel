# Task T12 — Tracker New Item tag integration

**Phase:** 3
**Depends:** T1, T4, T5, T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 12: Tracker New Item tag integration [depends: T1, T4, T5, T7] [parallel: T11] [test-risk]

## OBJECTIVE

Integrate one reducer/editor/catalog state into Tracker New Item, bind existing controls, recover invalid locks, preserve submit semantics, and reset Create more selectively.

Files:

- Create: `client/src/components/tracker/TrackerCreateMetadataFields.tsx`
- Create: `client/src/components/tracker/TrackerCreateMetadataFields.test.tsx`
- Modify: `client/src/components/tracker/TrackerCreateModal.tsx`
- Test: `client/src/components/tracker/TrackerCreateModal.test.tsx`

Steps:

#### Regression Verification T12-C06 — GWT Scenario: Preserve Tracker Enter shortcuts

1. **Define the regression verification.**
   - Scenario: `Preserve Tracker Enter shortcuts`
   - Test file: `client/src/components/tracker/TrackerCreateModal.test.tsx`
   - Level: component integration.
   - Test intent: Given Tracker New Item has a valid title and no popover is open; When the user presses plain Enter, then Cmd+Enter, then Ctrl+Enter in isolated runs; Then plain Enter does not submit while each modified shortcut submits exactly once.
   - Exercise through: the rendered modal and native title textarea.
   - Test doubles: mock only api.createWorkItem; keep shortcut routing, editor, and reducer real.
   - Baseline timing: Run before T12 production changes to record current Enter/Cmd-Ctrl+Enter behavior; rerun after command-aware editor integration.
2. **Run the baseline/prerequisite verification:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Preserve Tracker Enter shortcuts\""`. Expected: PASS today for the legacy modal shortcut contract..
3. **Run the same verification after this task's remaining production changes:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Preserve Tracker Enter shortcuts\""`. Expected: PASS.

#### RED Cycle T12-C01 — GWT Scenario: Close nested layers in order

1. **Write the failing test.**
   - Scenario: `Close nested layers in order`
   - Test file: `client/src/components/tracker/TrackerCreateModal.test.tsx`
   - Level: component integration.
   - Test intent: Given a Tracker value picker is open inside the command flow; When the user presses Escape repeatedly; Then the value layer closes first, the field layer closes next, and only the final unhandled Escape closes the modal.
   - Exercise through: the rendered modal, real TaskTitleEditor, real popover, and real reducer wrapper.
   - Test doubles: fixed external catalogs; keep modal Escape routing and all task-entry components real.
   - Expected RED: `TrackerCreateModal` tracks only one legacy `openPicker`; it cannot represent command field and value layers separately, so repeated Escape closes the picker and then modal instead of the asserted three-layer order.
2. **Run RED:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Close nested layers in order\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/tracker/TrackerCreateModal.tsx`. Route Escape through value layer, field layer, and modal in that order while delegating shared editor layer handling to T4.
4. **Run PASS:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Close nested layers in order\""`. Expected: PASS.

#### RED Cycle T12-C02 — GWT Scenario: Reflect a command selection in the existing picker

1. **Write the failing test.**
   - Scenario: `Reflect a command selection in the existing picker`
   - Test file: `client/src/components/tracker/TrackerCreateMetadataFields.test.tsx`
   - Level: component integration.
   - Test intent: Given the Tracker reducer has no Priority; When the user selects Priority High through the real command editor; Then the existing Priority control renders High from that reducer state.
   - Exercise through: the rendered metadata fields, real task editor, and real reducer wrapper.
   - Test doubles: fixed external catalogs; keep field definitions, provider context, reducer, and controls real.
   - Expected RED: `TrackerCreateMetadataFields.tsx` does not exist and `TrackerCreateModal` stores Priority in an independent `useState`, so a command reducer selection cannot update the legacy Priority control.
2. **Run RED:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateMetadataFields.test.tsx -t "\"Reflect a command selection in the existing picker\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/tracker/TrackerCreateMetadataFields.tsx`. Bind the existing Priority control to the modal-owned metadata reducer so command selection is displayed by the existing picker.
4. **Run PASS:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateMetadataFields.test.tsx -t "\"Reflect a command selection in the existing picker\""`. Expected: PASS.

#### RED Cycle T12-C03 — GWT Scenario: Reflect an existing picker selection in the chip list

1. **Write the failing test.**
   - Scenario: `Reflect an existing picker selection in the chip list`
   - Test file: `client/src/components/tracker/TrackerCreateMetadataFields.test.tsx`
   - Level: component integration.
   - Test intent: Given the Tracker command chip list is visible; When the user selects Priority through the existing picker; Then the inline Priority chip renders from the same reducer state.
   - Exercise through: the rendered existing picker and real task editor.
   - Test doubles: fixed external catalogs; keep reducer, controls, and editor real.
   - Expected RED: T12-C02 binds command selections into the legacy picker, but legacy picker changes still bypass the reducer action consumed by TaskTitleEditor, so the reverse picker-to-chip assertion fails.
2. **Run RED:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateMetadataFields.test.tsx -t "\"Reflect an existing picker selection in the chip list\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/tracker/TrackerCreateMetadataFields.tsx`. Dispatch existing-picker selection into the same reducer rendered by the chip list.
4. **Run PASS:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateMetadataFields.test.tsx -t "\"Reflect an existing picker selection in the chip list\""`. Expected: PASS.

#### RED Cycle T12-C04 — GWT Scenario: Honor a valid project context lock

1. **Write the failing test.**
   - Scenario: `Honor a valid project context lock`
   - Test file: `client/src/components/tracker/TrackerCreateMetadataFields.test.tsx`
   - Level: component integration.
   - Test intent: Given Tracker New Item starts with valid locked Project Alpha and Phase Build; When the command field menu opens; Then Project and Phase are omitted while the payload stays targeted at Alpha and Build.
   - Exercise through: the rendered metadata fields and field definitions with real reducer state.
   - Test doubles: fixed external catalogs and context record; keep field filtering and reducer real.
   - Expected RED: After T12-C03 establishes two-way reducer binding, TrackerCreateMetadataFields still receives no valid context-lock descriptor and returns Project/Phase definitions, so the locked-field omission assertion fails.
2. **Run RED:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateMetadataFields.test.tsx -t "\"Honor a valid project context lock\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/tracker/TrackerCreateMetadataFields.tsx`. Render valid locked Project/Phase values from reducer context while using T5 field definitions to omit their command choices.
4. **Run PASS:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateMetadataFields.test.tsx -t "\"Honor a valid project context lock\""`. Expected: PASS.

#### RED Cycle T12-C05 — GWT Scenario: Recover from a deleted locked context

1. **Write the failing test.**
   - Scenario: `Recover from a deleted locked context`
   - Test file: `client/src/components/tracker/TrackerCreateModal.test.tsx`
   - Level: component integration.
   - Test intent: Given a locked Project or Phase is deleted before submit; When the create API returns the typed context destination error; Then the modal preserves the draft, shows a context error, releases the invalid lock, and exposes Project and Phase selection.
   - Exercise through: the rendered modal submit boundary with real metadata fields and reducer.
   - Test doubles: mock only the create API rejection; keep context recovery, editor, and reducer real.
   - Expected RED: Current modal reduces a 400 response to one message and keeps `lockProjectAssignment` derived permanently from props, so typed stale-context errors cannot release the lock or expose Project/Phase selection.
2. **Run RED:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Recover from a deleted locked context\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/tracker/TrackerCreateModal.tsx`. Preserve the full draft on typed context rejection, render the context-level error, release only the invalid lock, and expose valid Project/Phase selection.
4. **Run PASS:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Recover from a deleted locked context\""`. Expected: PASS.

#### RED Cycle T12-C07 — GWT Scenario: Reset the Tracker draft selectively

1. **Write the failing test.**
   - Scenario: `Reset the Tracker draft selectively`
   - Test file: `client/src/components/tracker/TrackerCreateModal.test.tsx`
   - Level: component integration.
   - Test intent: Given Create more is enabled with Status In Progress, Project Web, Phase Build, title, Description, Assignee, Labels, Priority, Start date, and End date; When api.createWorkItem succeeds; Then Status, Project, and Phase remain while title, Description, Assignees, Labels, Priority, Start date, and End date clear.
   - Exercise through: the rendered modal success flow using the real reducer reset.
   - Test doubles: mock only api.createWorkItem success and external catalogs; keep reducer, reset, and rendered controls real.
   - Expected RED: Current `resetDraft` clears Project/Phase whenever the context is not prop-locked and never clears `priorityId`, so Create more fails both the retained Project/Phase and reset Priority assertions.
2. **Run RED:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Reset the Tracker draft selectively\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/tracker/TrackerCreateModal.tsx`. On Create more success retain Status/Project/Phase and reset title, Description, Assignees, Labels, Priority, Start date, and End date through the one reducer/modal lifecycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Reset the Tracker draft selectively\""`. Expected: PASS.

#### RED Cycle T12-S01 — Support: submits one complete synchronized Tracker payload

1. **Write the failing test.**
   - Scenario: `submits one complete synchronized Tracker payload`
   - Test file: `client/src/components/tracker/TrackerCreateModal.test.tsx`
   - Level: component integration.
   - Test intent: Given the title, Description, dates, and every supported metadata field are represented by one reducer; When the user clicks Create item; Then api.createWorkItem receives one plain-title payload matching existing controls and chips.
   - Exercise through: the rendered modal with real metadata fields, editor, definitions, provider, and reducer.
   - Test doubles: mock only external catalog methods and api.createWorkItem.
   - Expected RED: Current modal owns parallel `useState` values, has no shared reducer/chips, and omits `startDate`/`endDate` from the create body, so the complete synchronized payload assertion fails.
2. **Run RED:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"submits one complete synchronized Tracker payload\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/tracker/TrackerCreateModal.tsx`. Build one complete `api.createWorkItem` payload from the modal-owned reducer plus title/Description, including dates and all synchronized metadata.
4. **Run PASS:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"submits one complete synchronized Tracker payload\""`. Expected: PASS.

#### RED Cycle T12-S02 — Support: preserves Tracker draft for every submit failure class

1. **Write the failing test.**
   - Scenario: `preserves Tracker draft for every submit failure class`
   - Test file: `client/src/components/tracker/TrackerCreateModal.test.tsx`
   - Level: component integration.
   - Test intent: Given the modal has title, Description, and chips; When create rejects separately for validation, network, and server errors; Then the modal stays open, all draft values remain, and every returned invalid field is marked.
   - Exercise through: the rendered modal submit lifecycle.
   - Test doubles: mock external catalogs and sequenced api.createWorkItem rejections; keep lifecycle and reducer real.
   - Expected RED: T1 already exposes typed `fieldErrors`, but TrackerCreateModal currently renders only one string error and has no reducer action or prop mapping that marks every corresponding Tracker field/chip, so multi-field invalid feedback assertions fail.
2. **Run RED:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"preserves Tracker draft for every submit failure class\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/tracker/TrackerCreateModal.tsx`. Preserve all modal/reducer values for validation, network, and server rejection and map every typed field error to the relevant rendered field/chip.
4. **Run PASS:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"preserves Tracker draft for every submit failure class\""`. Expected: PASS.

#### Regression Verification T12-S03 — Support: blocks duplicate Tracker submission while pending

1. **Define the regression verification.**
   - Scenario: `blocks duplicate Tracker submission while pending`
   - Test file: `client/src/components/tracker/TrackerCreateModal.test.tsx`
   - Level: component integration.
   - Test intent: Given api.createWorkItem is pending; When the CTA and modified submit shortcut are activated again; Then exactly one request remains in flight.
   - Exercise through: the rendered modal with a deferred API promise.
   - Test doubles: mock external catalogs and deferred api.createWorkItem; keep submit guard real.
   - Baseline timing: Run after the modal/editor integration cycles are green and before task-wide refactor.
2. **Run the baseline/prerequisite verification:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"blocks duplicate Tracker submission while pending\""`. Expected: PASS; the existing modal-owned `submitting` guard must govern both CTA and command-aware shortcut entry paths..
3. **Run the same verification after this task's production changes:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"blocks duplicate Tracker submission while pending\""`. Expected: PASS.

#### Regression Verification T12-S04 — Support: retries a preserved Tracker draft after failure

1. **Define the regression verification.**
   - Scenario: `retries a preserved Tracker draft after failure`
   - Test file: `client/src/components/tracker/TrackerCreateModal.test.tsx`
   - Level: component integration.
   - Test intent: Given the first request failed and the complete draft remains; When the user submits the same draft again and the API succeeds; Then the successful request is sent once and clearing follows only confirmed success.
   - Exercise through: the rendered modal retry lifecycle.
   - Test doubles: mock external catalogs and sequence api.createWorkItem from rejection to success; keep reducer and lifecycle real.
   - Baseline timing: Run after complete reducer-backed payload and failure preservation are green.
2. **Run the baseline/prerequisite verification:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"retries a preserved Tracker draft after failure\""`. Expected: PASS; a rejected request must preserve the complete draft and a subsequent success must send the same payload once..
3. **Run the same verification after this task's production changes:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"retries a preserved Tracker draft after failure\""`. Expected: PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `npm run test --workspace=client -- src/components/tracker/TrackerCreateMetadataFields.test.tsx src/components/tracker/TrackerCreateModal.test.tsx`. Expected: PASS.
3. **Commit:** `git add client/src/components/tracker/TrackerCreateMetadataFields.tsx client/src/components/tracker/TrackerCreateMetadataFields.test.tsx client/src/components/tracker/TrackerCreateModal.tsx client/src/components/tracker/TrackerCreateModal.test.tsx` then `git commit -m "feat(tracker): add metadata tags to New Item"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: deep. The boundary is independently runnable after T1, T4, T5, and T7 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: Tracker New Item owns one reducer shared by existing controls and command chips; valid locks remain authoritative and invalid locks release only after typed context rejection.]
You are implementing Tracker New Item tag integration for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T1, T4, T5, and T7.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Tracker New Item owns one reducer shared by existing controls and command chips; valid locks remain authoritative and invalid locks release only after typed context rejection.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `feat(tracker): add metadata tags to New Item` exists.

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
