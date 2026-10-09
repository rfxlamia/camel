# Task T11 — Board Add Card tag integration

**Phase:** 3
**Depends:** T1, T4, T5, T6
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 11: Board Add Card tag integration [depends: T1, T4, T5, T6] [test-risk]

## OBJECTIVE

Extract AddCard, connect one reducer/editor/catalog instance to the expanded API, and preserve fixed-column submit, draft, retry, guard, and refresh semantics.

Files:

- Create: `client/src/components/AddCard.tsx`
- Create: `client/src/components/AddCard.test.tsx`
- Modify: `client/src/components/ColumnView.tsx`
- Modify: `client/src/pages/BoardPage.tsx`
- Test: `client/src/pages/BoardPage.test.tsx`

Steps:

#### RED Cycle T11-C01 — GWT Scenario: Preserve the originating Board column

1. **Write the failing test.**
   - Scenario: `Preserve the originating Board column`
   - Test file: `client/src/components/AddCard.test.tsx`
   - Level: component integration.
   - Test intent: Given Add Card is open for the To do column; When the command menu opens and a successful create is submitted; Then Status and Column are absent and the callback receives the unchanged To do column ID.
   - Exercise through: the rendered AddCard with real editor, definitions, catalog provider, and reducer.
   - Test doubles: mock only external catalog API data and the onAddCard callback.
   - Expected RED: `client/src/components/AddCard.tsx` does not exist and the inline `ColumnView` AddCard exposes only a title textarea, so the test import/field-menu query fails before it can assert the fixed column ID.
2. **Run RED:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Preserve the originating Board column\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/AddCard.tsx`. Implement the fixed-column AddCard editor/draft behavior; wire the extracted component from `client/src/components/ColumnView.tsx` without allowing metadata to replace the originating `column.id`.
4. **Run PASS:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Preserve the originating Board column\""`. Expected: PASS.

#### RED Cycle T11-C02 — GWT Scenario: Submit Board with Enter outside a popover

1. **Write the failing test.**
   - Scenario: `Submit Board with Enter outside a popover`
   - Test file: `client/src/components/AddCard.test.tsx`
   - Level: component integration.
   - Test intent: Given Add Card has a valid title and no popover is open; When the user presses Enter without Shift; Then the Board callback runs exactly once.
   - Exercise through: the rendered AddCard form and native textarea.
   - Test doubles: mock only external catalog API data and the onAddCard callback.
   - Expected RED: T11-C01 extracts `AddCard` with a fixed-column editor, but its initial key handler does not yet distinguish an open command layer from the closed editor; Enter either bypasses the new submit callback or submits while the popover owns the key.
2. **Run RED:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Submit Board with Enter outside a popover\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/AddCard.tsx`. Add only the AddCard editor and submit lifecycle behavior required by this Enter cycle while retaining command-popover key ownership from T4.
4. **Run PASS:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Submit Board with Enter outside a popover\""`. Expected: PASS.

#### Regression Verification T11-C03 — GWT Scenario: Preserve the draft on any submit failure

1. **Define the regression verification.**
   - Scenario: `Preserve the draft on any submit failure`
   - Test file: `client/src/components/AddCard.test.tsx`
   - Level: component integration.
   - Test intent: Given extracted AddCard contains a non-empty title and metadata chips and its directly supplied onAddCard callback rejects with a generic create error; When submit settles; Then the editor remains open and the title and every chip remain unchanged for retry.
   - Exercise through: the standalone AddCard component with its real reducer/editor lifecycle.
   - Test doubles: provide fixed catalog data and a rejecting onAddCard callback; keep AddCard, reducer, title, chips, and draft lifecycle real.
   - Baseline timing: Run after T11-C01 extracts AddCard and before BoardPage integration changes.
2. **Run the baseline/prerequisite verification:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Preserve the draft on any submit failure\""`. Expected: PASS when the component is directly given a rejecting onAddCard callback; the post-integration run ensures propagated BoardPage failures retain the same draft behavior..
3. **Run the same verification after this task's remaining production changes:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Preserve the draft on any submit failure\""`. Expected: PASS.

#### RED Cycle T11-C04 — GWT Scenario: Prevent an in-flight duplicate submit

1. **Write the failing test.**
   - Scenario: `Prevent an in-flight duplicate submit`
   - Test file: `client/src/components/AddCard.test.tsx`
   - Level: component integration.
   - Test intent: Given an Add Card create promise is pending; When the CTA and Enter submit are activated again; Then no second callback starts.
   - Exercise through: the rendered AddCard form with a deferred callback promise.
   - Test doubles: mock external catalog API data and the deferred onAddCard promise; keep submit guard real.
   - Expected RED: Inline AddCard has no submitting state or in-flight guard, so CTA and Enter can invoke `onAddCard` twice while the first promise is pending.
2. **Run RED:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Prevent an in-flight duplicate submit\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/AddCard.tsx`. Add one AddCard-owned pending guard shared by CTA and Enter submission paths.
4. **Run PASS:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Prevent an in-flight duplicate submit\""`. Expected: PASS.

#### Regression Verification T11-C05 — GWT Scenario: Retry after a failed request

1. **Define the regression verification.**
   - Scenario: `Retry after a failed request`
   - Test file: `client/src/components/AddCard.test.tsx`
   - Level: component integration.
   - Test intent: Given the first Add Card request failed before success and its draft remains; When the same draft is submitted again and succeeds; Then one task is attributed to the successful request and the draft clears only after that success.
   - Exercise through: the rendered AddCard retry lifecycle.
   - Test doubles: mock external catalogs and sequence onAddCard from rejection to success; keep editor, reducer, and lifecycle real.
   - Baseline timing: Run after T11-C03 failure preservation and T11-C04 in-flight guarding are green.
2. **Run the baseline/prerequisite verification:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Retry after a failed request\""`. Expected: PASS; the preserved reducer/title draft can be resubmitted after a settled rejection and is cleared only after the later success..
3. **Run the same verification after this task's remaining production changes:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Retry after a failed request\""`. Expected: PASS.

#### RED Cycle T11-C06 — GWT Scenario: Treat refresh failure as synchronization failure

1. **Write the failing test.**
   - Scenario: `Treat refresh failure as synchronization failure`
   - Test file: `client/src/pages/BoardPage.test.tsx`
   - Level: component integration.
   - Test intent: Given api.createCard committed and returned success; When the subsequent board refresh rejects; Then the AddCard result remains successful, no create retry is invited, and a synchronization retry is reported or scheduled.
   - Exercise through: the rendered BoardPage and AddCard callback boundary.
   - Test doubles: mock api.createCard and board refresh separately; keep BoardPage outcome branching and AddCard lifecycle real.
   - Expected RED: `BoardPage.onAddCard` wraps `api.createCard` and `refresh()` in one catch and resolves after either failure, so a refresh rejection is reported as add failure and cannot produce the asserted separate synchronization-retry outcome.
2. **Run RED:** `npm run test --workspace=client -- src/pages/BoardPage.test.tsx -t "\"Treat refresh failure as synchronization failure\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/pages/BoardPage.tsx`. Separate the successful `api.createCard` result from the subsequent `refresh()` outcome, propagate create rejection to AddCard, and report/schedule refresh rejection only as synchronization failure.
4. **Run PASS:** `npm run test --workspace=client -- src/pages/BoardPage.test.tsx -t "\"Treat refresh failure as synchronization failure\""`. Expected: PASS.

#### RED Cycle T11-S01 — Support: assembles the full Board metadata callback payload

1. **Write the failing test.**
   - Scenario: `assembles the full Board metadata callback payload`
   - Test file: `client/src/components/AddCard.test.tsx`
   - Level: component integration.
   - Test intent: Given AddCard contains Fix login and every supported selected metadata value; When the user clicks Add to board; Then onAddCard receives plain title, original columnId, and complete metadata without statusId.
   - Exercise through: the rendered AddCard with real editor, definitions, provider, and reducer.
   - Test doubles: mock external catalog API data and onAddCard; keep payload assembly real.
   - Expected RED: After T11-C01, extracted AddCard preserves the column and editor draft but still forwards the legacy `(columnId, title)` callback shape, so the Assignee/Priority/Labels/Project/Phase/Due-date payload assertions fail.
2. **Run RED:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"assembles the full Board metadata callback payload\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/AddCard.tsx`. Assemble the full Board callback payload from the one reducer/editor draft and retain the original column ID without `statusId`.
4. **Run PASS:** `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"assembles the full Board metadata callback payload\""`. Expected: PASS.

#### RED Cycle T11-S02 — Support: mounts one catalog provider per Board workspace

1. **Write the failing test.**
   - Scenario: `mounts one catalog provider per Board workspace`
   - Test file: `client/src/pages/BoardPage.test.tsx`
   - Level: component integration.
   - Test intent: Given BoardPage renders two columns with an AddCard consumer in each; When the workspace loads and then changes; Then one TaskMetadataCatalogProvider surrounds the column collection and each catalog endpoint is requested once per workspace rather than once per AddCard.
   - Exercise through: BoardPage with real provider/context, ColumnView, and AddCard wiring.
   - Test doubles: mock BoardContext data and catalog API responses; keep provider placement and all consumers real.
   - Expected RED: BoardPage currently renders ColumnView directly and has no TaskMetadataCatalogProvider, so opening metadata consumers cannot share one workspace catalog owner and the provider/call-count assertions fail.
2. **Run RED:** `npm run test --workspace=client -- src/pages/BoardPage.test.tsx -t "\"mounts one catalog provider per Board workspace\""`. Expected: FAIL because no Board-level provider exists.
3. **Implement the minimum behavior.** File: `client/src/pages/BoardPage.tsx`. Mount exactly one TaskMetadataCatalogProvider keyed by activeWorkspaceId around the Board column collection; never mount it inside ColumnView or AddCard.
4. **Run PASS:** `npm run test --workspace=client -- src/pages/BoardPage.test.tsx -t "\"mounts one catalog provider per Board workspace\""`. Expected: PASS.

#### RED Cycle T11-S03 — Support: propagates Board create field errors into Add Card

1. **Write the failing test.**
   - Scenario: `propagates Board create field errors into Add Card`
   - Test file: `client/src/pages/BoardPage.test.tsx`
   - Level: component integration.
   - Test intent: Given api.createCard rejects with typed fieldErrors for Project and Assignee; When a user submits the real AddCard rendered by BoardPage; Then BoardPage propagates the create failure, AddCard remains open with title/chips intact, and both affected chips render invalid feedback.
   - Exercise through: BoardPage → ColumnView → AddCard → api.createCard with real reducer/editor/error mapping.
   - Test doubles: mock only api.createCard rejection and catalog responses; keep BoardPage callback, AddCard lifecycle, reducer, chips, and typed error mapping real.
   - Expected RED: BoardPage currently catches api.createCard errors and resolves Promise<void>, so AddCard observes success, closes, and cannot render the returned Project/Assignee field errors.
2. **Run RED:** `npm run test --workspace=client -- src/pages/BoardPage.test.tsx -t "\"propagates Board create field errors into Add Card\""`. Expected: FAIL because the failure is swallowed and the editor closes.
3. **Implement the minimum behavior.** Files: `client/src/pages/BoardPage.tsx`, `client/src/components/AddCard.tsx`. Make the Board callback reject or return an explicit failure result for create errors, preserve refresh as a separate post-success concern, and map TaskCreateFieldErrors onto every matching chip while retaining the complete draft.
4. **Run PASS:** `npm run test --workspace=client -- src/pages/BoardPage.test.tsx -t "\"propagates Board create field errors into Add Card\""`. Expected: PASS.

#### Regression Verification T11-S04 — Support: preserves Board draft for WIP network and server failures

1. **Define the regression verification.**
   - Scenario: `preserves Board draft for WIP network and server failures`
   - Test file: `client/src/pages/BoardPage.test.tsx`
   - Level: component integration.
   - Test intent: Given the real BoardPage to AddCard chain receives, in separate cases, the existing 409 WIP branch, a network rejection, and a server rejection; When each submit settles; Then the editor remains open with the complete title/chip draft and the correct error class is shown
   - Exercise through: BoardPage → ColumnView → AddCard → api.createCard.
   - Test doubles: mock only each API failure and catalogs; keep callbacks, reducer/editor, and draft lifecycle real.
   - Baseline timing: Run after T11-S03 failure propagation is green
2. **Run the baseline/prerequisite verification:** `npm run test --workspace=client -- src/pages/BoardPage.test.tsx -t "\"preserves Board draft for WIP network and server failures\""`. Expected: PASS.
3. **Run the same verification after this task's remaining changes:** `npm run test --workspace=client -- src/pages/BoardPage.test.tsx -t "\"preserves Board draft for WIP network and server failures\""`. Expected: PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `npm run test --workspace=client -- src/components/AddCard.test.tsx src/pages/BoardPage.test.tsx`. Expected: PASS.
3. **Commit:** `git add client/src/components/AddCard.tsx client/src/components/AddCard.test.tsx client/src/components/ColumnView.tsx client/src/pages/BoardPage.tsx client/src/pages/BoardPage.test.tsx` then `git commit -m "feat(board): add metadata tags to Add Card"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: deep. The boundary is independently runnable after T1, T4, T5, and T6 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: Keep the originating column fixed and clear the draft only after confirmed create success; a refresh failure is a separate synchronization outcome.]
You are implementing Board Add Card tag integration for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T1, T4, T5, and T6.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Keep the originating column fixed and clear the draft only after confirmed create success; a refresh failure is a separate synchronization outcome.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `feat(board): add metadata tags to Add Card` exists.

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
