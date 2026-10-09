# EXECUTION PLAN — Task Field Tags for Create Flows

**Date:** 2026-09-02
**Spec:** `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`
**GitHub issue:** #106
**Status:** draft
**Total tasks:** 12

---

## Execution Overview

### Recommended Order

```text
T1, T3 (parallel) → T2, T6, T7 (T6/T7 parallel) → T4, T5 (parallel) → T8, T9, T10, T11, T12 (parallel when each dependency set is complete)
```

### Execution DAG

```text
T1 → T2 → T4 ─┐
       └→ T5 ─┼→ T11
               └→ T12
T3 → T6 ───────→ T11
 └→ T7 ────────→ T12
T6 + T7 → T8, T9, T10
```

### Three Phases

- **Phase A — Contracts and state foundations:** T1–T3.
- **Phase B — Shared UI and atomic backends:** T4–T7.
- **Phase C — Concurrency hardening and surface integration:** T8–T12.

Dependency order is recommended; Pocket Development enforces the declared graph. T1 and T3 are roots. T4 and T5 may run together after T2. T6 and T7 may run together after T3. T8, T9, and T10 may run together after T6 and T7. T11 and T12 may run together after their declared dependencies.

### Architecture and Scope Constraints

- Keep `cards` with `card_events` and `tracker_items` with `tracker_events`; preserve source-aware route semantics.
- Board status remains its destination column. `POST /cards` rejects `statusId`.
- Tracker creation remains canonical through `/work-items`; `/tracker/items` delegates to the same handler.
- Each form owns one metadata reducer. The native textarea is the title source and chips are sibling end elements. Do not add `contenteditable` or an editor dependency.
- Shared server validation accepts `DBExecutor`, runs inside the create transaction, batches reference checks, aggregates stable `fieldErrors`, and finishes before identity allocation and writes.
- Lock order is workspace, deterministic referenced categories and IDs, destination column, then inserts. Removal routes lock workspace first, lock and revalidate the removed row, then retain existing cleanup behavior.
- Main row, relations, and source-specific activity are atomic. Realtime and notification publishers run after commit and remain best-effort.
- Catalogs are cached per workspace with independent states. API additions preserve `error: string` and title-only callers.
- No database migration and no dependency are added. Server imports use `.js`; client imports omit extensions.
- Out of scope: editing existing tasks; commands in Description and other surfaces; creating taxonomy values; Board Status and Column commands; natural-language parsing; persisted chip markup; dual-table consolidation; durable idempotency; `camel-lottie/`.
- Deploy server first and client second. Roll back client first. Retain lock correctness unless it is proven regressive.

## File Structure Map

| Responsibility | Files | Task |
| --- | --- | --- |
| Client create contracts | `client/src/lib/taskCreateContracts.ts`, `client/src/api.ts`, `client/src/api.test.ts`, `client/src/api.tracker.test.ts` | T1 |
| Metadata reducer | `client/src/components/task-entry/taskMetadataDraft.ts`, `client/src/components/task-entry/taskMetadataDraft.test.ts` | T2 |
| Transaction metadata validation | `server/src/routes/work-item-create-metadata.ts`, `server/src/routes/work-item-create-metadata.integration.test.ts` | T3 |
| Workspace lock primitives | `server/src/routes/workspace-mutation-lock.ts`, `server/src/routes/workspace-mutation-lock.test.ts` | T3 |
| Strict date parsing | `server/src/routes/tracker-item-parsers.ts`, `server/src/routes/tracker-item-parsers.test.ts` | T3 |
| Composite editor | `client/src/components/task-entry/TaskTitleEditor.tsx`, `client/src/components/task-entry/TaskFieldCommandPopover.tsx`, `client/src/components/task-entry/TaskTitleEditor.test.tsx` | T4 |
| Catalog provider | `client/src/components/task-entry/TaskMetadataCatalogProvider.tsx`, `client/src/components/task-entry/TaskMetadataCatalogProvider.test.tsx` | T5 |
| Field definitions | `client/src/components/task-entry/taskFieldDefinitions.tsx`, `client/src/components/task-entry/taskFieldDefinitions.test.tsx` | T5 |
| Board create backend | `server/src/routes/card-create.ts`, `server/src/routes/cards.ts`, `server/src/routes/cards-create-metadata.integration.test.ts` | T6 |
| Board create regressions | `server/src/routes/cards-taxonomy.integration.test.ts`, `server/src/routes/cards-mutations.integration.test.ts` | T6 test/read only |
| Board helper reuse | `server/src/routes/card-response.ts`, `server/src/routes/card-assignees.ts`, `server/src/routes/card-labels.ts` | T6 read/import only |
| Shared create primitives | `server/src/routes/work-item-create-metadata.ts`, `server/src/routes/workspace-mutation-lock.ts` | T6, T7 read/import only |
| Existing server seams reused by create backends | `server/src/routes/helpers.ts`, `server/src/routes/tracker-item-parsers.ts`, `server/src/validators/input-length.ts`, `server/src/core/allocate-card-identity.ts`, `server/src/core/wip.ts`, `server/src/core/position.ts`, `server/src/db/kysely.ts`, `server/src/realtime.ts`, `server/src/events.ts` | T6, T7 read/import only |
| Tracker create backend | `server/src/routes/tracker-item-create.ts`, `server/src/routes/tracker-items.ts`, `server/src/routes/tracker-item-create-metadata.integration.test.ts`, `server/src/routes/tracker-items.write.test.ts`, `server/src/routes/work-items.test.ts` | T7 |
| Tracker helper reuse | `server/src/routes/work-item-response.ts`, `server/src/routes/tracker-assignees.ts`, `server/src/routes/tracker-activity.ts`, `server/src/routes/vocabulary-response.ts` | T7 read/import only |
| Member removal locking | `server/src/routes/helpers.ts`, `server/src/routes/workspaceAccess.test.ts`, `server/src/routes/work-item-member-concurrency.integration.test.ts` | T8 |
| Project removal locking | `server/src/routes/tracker-projects.ts`, `server/src/routes/tracker-projects.test.ts`, `server/src/routes/work-item-project-concurrency.integration.test.ts` | T9 |
| Phase removal locking | `server/src/routes/tracker-phases.ts`, `server/src/routes/tracker-phases.test.ts`, `server/src/routes/work-item-phase-concurrency.integration.test.ts` | T10 |
| Board create UI | `client/src/components/AddCard.tsx`, `client/src/components/AddCard.test.tsx`, `client/src/components/ColumnView.tsx`, `client/src/pages/BoardPage.tsx`, `client/src/pages/BoardPage.test.tsx` | T11 |
| Tracker create UI | `client/src/components/tracker/TrackerCreateMetadataFields.tsx`, `client/src/components/tracker/TrackerCreateMetadataFields.test.tsx`, `client/src/components/tracker/TrackerCreateModal.tsx`, `client/src/components/tracker/TrackerCreateModal.test.tsx` | T12 |

Every file named by a packet appears above. Existing mocked Tracker route tests remain unit regressions; real persistence and atomicity use the new integration test. `workspaceAccess.test.ts` remains a mocked service-level unit regression and does not claim SQL lock proof.

## GWT Traceability Matrix

| Spec scenario | Owner | Mode | Verification | Exact command |
| --- | --- | --- | --- | --- |
| Open the field menu | T4 | RED | T4-C01 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Open the field menu\""` |
| Do not trigger inside an email-like word | T4 | RED | T4-C02 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Do not trigger inside an email-like word\""` |
| Abandon a partial command | T4 | RED | T4-C03 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Abandon a partial command\""` |
| Ignore IME composition keystrokes | T4 | RED | T4-C04 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Ignore IME composition keystrokes\""` |
| Select an assignee with the keyboard | T4 | RED | T4-C05 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Select an assignee with the keyboard\""` |
| Do not create a missing option | T4 | RED | T4-C06 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Do not create a missing option\""` |
| Consume Enter while the picker is unavailable | T4 | RED | T4-C07 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Consume Enter while the picker is unavailable\""` |
| Edit a chip by clicking it | T4 | RED | T4-C08 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Edit a chip by clicking it\""` |
| Remove a chip by pointer or keyboard | T4 | RED | T4-C09 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Remove a chip by pointer or keyboard\""` |
| Restore title focus after a picker closes | T4 | RED | T4-C10 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Restore title focus after a picker closes\""` |
| Close nested layers in order | T12 | RED | T12-C01 | `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Close nested layers in order\""` |
| Replace a single-value field | T2 | RED | T2-C01 | `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Replace a single-value field\""` |
| Select multiple assignees | T4 | RED | T4-C11 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Select multiple assignees\""` |
| Prevent duplicate multi-value relations | T2 | RED | T2-C02 | `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Prevent duplicate multi-value relations\""` |
| Derive Project from Phase | T2 | RED | T2-C03 | `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Derive Project from Phase\""` |
| Clear an incompatible Phase | T2 | RED | T2-C04 | `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Clear an incompatible Phase\""` |
| Clear Phase when Project is removed | T2 | RED | T2-C05 | `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Clear Phase when Project is removed\""` |
| Reflect a command selection in the existing picker | T12 | RED | T12-C02 | `npm run test --workspace=client -- src/components/tracker/TrackerCreateMetadataFields.test.tsx -t "\"Reflect a command selection in the existing picker\""` |
| Reflect an existing picker selection in the chip list | T12 | RED | T12-C03 | `npm run test --workspace=client -- src/components/tracker/TrackerCreateMetadataFields.test.tsx -t "\"Reflect an existing picker selection in the chip list\""` |
| Honor a valid project context lock | T12 | RED | T12-C04 | `npm run test --workspace=client -- src/components/tracker/TrackerCreateMetadataFields.test.tsx -t "\"Honor a valid project context lock\""` |
| Recover from a deleted locked context | T12 | RED | T12-C05 | `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Recover from a deleted locked context\""` |
| Preserve the originating Board column | T11 | RED | T11-C01 | `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Preserve the originating Board column\""` |
| Resolve a Next week preset | T2 | RED | T2-C06 | `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Resolve a Next week preset\""` |
| Preserve calendar dates across time boundaries | T2 | Regression | T2-C07 | `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Preserve calendar dates across time boundaries\""` |
| Reject an invalid Tracker date range immediately | T2 | RED | T2-C08 | `npm run test --workspace=client -- src/components/task-entry/taskMetadataDraft.test.ts -t "\"Reject an invalid Tracker date range immediately\""` |
| Continue when one catalog fails | T5 | RED | T5-C01 | `npm run test --workspace=client -- src/components/task-entry/TaskMetadataCatalogProvider.test.tsx -t "\"Continue when one catalog fails\""` |
| Distinguish loading, empty, and failed catalogs | T5 | Regression | T5-C02 | `npm run test --workspace=client -- src/components/task-entry/TaskMetadataCatalogProvider.test.tsx -t "\"Distinguish loading, empty, and failed catalogs\""` |
| Reject a chips-only draft | T4 | RED | T4-C12 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Reject a chips-only draft\""` |
| Exclude chips from title length validation | T4 | RED | T4-C13 | `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Exclude chips from title length validation\""` |
| Submit Board with Enter outside a popover | T11 | RED | T11-C02 | `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Submit Board with Enter outside a popover\""` |
| Preserve Tracker Enter shortcuts | T12 | Regression | T12-C06 | `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Preserve Tracker Enter shortcuts\""` |
| Create a fully configured Board card | T6 | RED | T6-C01 | `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Create a fully configured Board card\""` |
| Merge explicit and signable-column assignees | T6 | RED | T6-C02 | `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Merge explicit and signable-column assignees\""` |
| Deduplicate the same automatic and explicit assignee | T6 | Regression | T6-C03 | `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Deduplicate the same automatic and explicit assignee\""` |
| Reject a stale signable-column assignee | T6 | RED | T6-C04 | `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Reject a stale signable-column assignee\""` |
| Create a fully configured Tracker item | T7 | Regression | T7-C01 | `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/tracker-item-create-metadata.integration.test.ts -t "\"Create a fully configured Tracker item\""` |
| Reject multiple stale references together | T3 | RED | T3-C01 | `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-create-metadata.integration.test.ts -t "\"Reject multiple stale references together\""` |
| Reject a revoked assignee | T8 | Regression | T8-C01 | `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"Reject a revoked assignee\""` |
| Resolve a concurrent reference deletion atomically | T8 | Regression | T8-C02 | `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"Resolve a concurrent reference deletion atomically\""` |
| Roll back every side effect on invalid create | T6 | Regression | T6-C05 | `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Roll back every side effect on invalid create\""` |
| Preserve the draft on any submit failure | T11 | Regression | T11-C03 | `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Preserve the draft on any submit failure\""` |
| Prevent an in-flight duplicate submit | T11 | RED | T11-C04 | `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Prevent an in-flight duplicate submit\""` |
| Retry after a failed request | T11 | Regression | T11-C05 | `npm run test --workspace=client -- src/components/AddCard.test.tsx -t "\"Retry after a failed request\""` |
| Treat refresh failure as synchronization failure | T11 | RED | T11-C06 | `npm run test --workspace=client -- src/pages/BoardPage.test.tsx -t "\"Treat refresh failure as synchronization failure\""` |
| Reset the Tracker draft selectively | T12 | RED | T12-C07 | `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx -t "\"Reset the Tracker draft selectively\""` |

The matrix designates one owner for each approved scenario. Supplementary cycles verify lower-level contracts and additional surface/backend regressions without claiming duplicate GWT ownership.

---

## Pocket Packets

### Phase A — Contracts and state foundations

### Task 1: Client create and field-error contracts [prereq]

## OBJECTIVE

Define additive Board and Tracker create payload contracts and typed field-error parsing while preserving the existing error message, status, and title-only callers.

Files:

- Create: `client/src/lib/taskCreateContracts.ts`
- Modify: `client/src/api.ts`
- Test: `client/src/api.test.ts`
- Test: `client/src/api.tracker.test.ts`

Steps:

#### RED Cycle T1-S01 — Support: serializes additive Board create metadata

1. **Write the failing test.**
   - Scenario: `serializes additive Board create metadata`
   - Test file: `client/src/api.test.ts`
   - Level: unit.
   - Test intent: Given a Board request contains title plus Assignee, Priority, Labels, Project, Phase, and Due date; When api.createCard serializes the request; Then the body contains every additive field and excludes statusId.
   - Exercise through: the public api.createCard boundary.
   - Test doubles: mock fetch; keep request serialization real.
   - Expected RED: `api.createCard` currently types and serializes only `columnId`, `title`, and `description`, so the request-body assertion for `assigneeIds`, `priorityId`, `labelIds`, `projectId`, `phaseId`, and `dueDate` fails.
2. **Run RED:** `npm run test --workspace=client -- src/api.test.ts -t "\"serializes additive Board create metadata\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/lib/taskCreateContracts.ts`, `client/src/api.ts`. Add the additive `BoardCreatePayload` type in contracts, use it in `api.createCard`, and extend `api.ts` request serialization to include Assignee, Priority, Labels, Project, Phase, and Due date while continuing to exclude `statusId`.
4. **Run PASS:** `npm run test --workspace=client -- src/api.test.ts -t "\"serializes additive Board create metadata\""`. Expected: PASS.

#### RED Cycle T1-S02 — Support: preserves Board structured field errors

1. **Write the failing test.**
   - Scenario: `preserves Board structured field errors`
   - Test file: `client/src/api.test.ts`
   - Level: unit.
   - Test intent: Given the Board endpoint returns error plus multiple fieldErrors; When api.createCard rejects; Then ApiError retains message, status, and every stable field error.
   - Exercise through: the public api.createCard and ApiError boundary.
   - Test doubles: mock fetch; keep error parsing real.
   - Expected RED: `ApiError` has no `fieldErrors` property and `request()` discards `body.fieldErrors`, so the rejection assertion cannot observe either returned Board field error.
2. **Run RED:** `npm run test --workspace=client -- src/api.test.ts -t "\"preserves Board structured field errors\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/lib/taskCreateContracts.ts`, `client/src/api.ts`. Add the stable `TaskCreateFieldErrors` response type in contracts, add an optional typed `fieldErrors` property to `ApiError`, and make `request()` in `api.ts` retain `body.fieldErrors` alongside message and status.
4. **Run PASS:** `npm run test --workspace=client -- src/api.test.ts -t "\"preserves Board structured field errors\""`. Expected: PASS.

#### RED Cycle T1-S03 — Support: accepts additive Tracker dates in the public create contract

1. **Write the failing compile-time contract assertion.**
   - Scenario: `accepts additive Tracker dates in the public create contract`
   - Test file: `client/src/api.tracker.test.ts`
   - Level: compile-time contract.
   - Test intent: Given a Tracker create payload containing every supported metadata field plus startDate and endDate; When TypeScript checks it against the second parameter of public `api.createWorkItem`; Then the payload is assignable without a cast or suppression.
   - Exercise through: the exported TypeScript signature of `api.createWorkItem`, verified by the client compiler rather than Vitest transpilation.
   - Test doubles: none; do not use `as any`, `@ts-expect-error`, or a fetch mock for this compile-time assertion.
   - Trap to avoid: `client/tsconfig.json` sets `noUnusedLocals: true` and `include: ["src"]`, so a contract const that is declared but never referenced fails with `TS6133` instead of the intended excess-property diagnostic — a red run for the wrong reason, and an unreachable PASS. The assertion value MUST be consumed: pass it to a `api.createWorkItem` call inside an existing `it()` with the fetch mock already used in this file, or reference it with `void payload`.
   - Expected RED: `api.createWorkItem` currently omits `startDate` and `endDate` from its second-parameter type, so `npm run typecheck --workspace=client` reports those date keys as excess properties in the new contract assertion.
2. **Run RED:** `npm run typecheck --workspace=client`. Expected: FAIL with excess-property diagnostics for `startDate` and `endDate` in the named contract assertion.
3. **Implement the minimum behavior.** Files: `client/src/lib/taskCreateContracts.ts`, `client/src/api.ts`. Add the additive `TrackerCreatePayload` type with `startDate` and `endDate` in contracts, use it as the public `api.createWorkItem` body type, and retain `JSON.stringify(body)` so every accepted field is forwarded unchanged to `/work-items`.
4. **Run PASS:** `npm run typecheck --workspace=client`. Expected: PASS.

#### Regression Verification T1-S04 — Support: preserves Tracker structured field errors

1. **Define the regression verification.**
   - Scenario: `preserves Tracker structured field errors`
   - Test file: `client/src/api.tracker.test.ts`
   - Level: unit.
   - Test intent: Given the canonical endpoint returns error plus multiple fieldErrors; When api.createWorkItem rejects; Then ApiError exposes the same typed field-error model as Board.
   - Exercise through: the public api.createWorkItem and ApiError boundary.
   - Test doubles: mock fetch; keep error parsing real.
   - Baseline timing: Run after T1-S02 adds the shared request()/ApiError fieldErrors path.
2. **Run the baseline/prerequisite verification:** `npm run test --workspace=client -- src/api.tracker.test.ts -t "\"preserves Tracker structured field errors\""`. Expected: PASS for Tracker because Board and Tracker share the same error parser; rerun after the Tracker payload contract changes..
3. **Run the same verification after this task's remaining production changes:** `npm run test --workspace=client -- src/api.tracker.test.ts -t "\"preserves Tracker structured field errors\""`. Expected: PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `npm run test --workspace=client -- src/api.test.ts src/api.tracker.test.ts`. Expected: PASS.
3. **Commit:** `git add client/src/lib/taskCreateContracts.ts client/src/api.ts client/src/api.test.ts client/src/api.tracker.test.ts` then `git commit -m "feat(api): add task metadata create contracts"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: standard. The boundary is independently runnable after none and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: Keep contracts additive, keep Board status derived from column, and preserve separate Board and Tracker persistence semantics.]
You are implementing Client create and field-error contracts for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: none.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Keep contracts additive, keep Board status derived from column, and preserve separate Board and Tracker persistence semantics.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `feat(api): add task metadata create contracts` exists.

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

---

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

### Task 4: Composite task title editor and command popover [depends: T2]

## OBJECTIVE

Build the shared native-textarea editor and two-stage field/value popover with exact trigger, keyboard, accessibility, chip, focus, title, and IME behavior.

Files:

- Create: `client/src/components/task-entry/TaskTitleEditor.tsx`
- Create: `client/src/components/task-entry/TaskFieldCommandPopover.tsx`
- Test: `client/src/components/task-entry/TaskTitleEditor.test.tsx`

Steps:

#### RED Cycle T4-C01 — GWT Scenario: Open the field menu

1. **Write the failing test.**
   - Scenario: `Open the field menu`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the Board title is "Fix login "; When the user types "@"; Then the field popover opens with the first available option represented as active.
   - Exercise through: the rendered native textarea and accessible field listbox.
   - Test doubles: fixed field definitions; keep the real TaskTitleEditor, TaskFieldCommandPopover, and reducer wrapper.
   - Expected RED: `TaskTitleEditor` and `TaskFieldCommandPopover` do not exist, so the component test fails to import the editor before it can query an active first field option.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Open the field menu\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskTitleEditor.tsx`, `client/src/components/task-entry/TaskFieldCommandPopover.tsx`. Create the native-textarea composite editor and the real field-command popover, wire terminal `@` to the first available field option, and keep the initial implementation limited to this valid trigger path.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Open the field menu\""`. Expected: PASS.

#### RED Cycle T4-C02 — GWT Scenario: Do not trigger inside an email-like word

1. **Write the failing test.**
   - Scenario: `Do not trigger inside an email-like word`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the title is "Notify <foo@bar.com>"; When the user continues typing; Then the field popover stays closed.
   - Exercise through: the rendered native textarea.
   - Test doubles: fixed field definitions; keep command-state handling real.
   - Expected RED: After T4-C01, the initial terminal-`@` detector has no word-boundary/email exclusion, so typing `foo@bar.com` opens the command popover and the closed-popover assertion fails.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Do not trigger inside an email-like word\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Do not trigger inside an email-like word\""`. Expected: PASS.

#### RED Cycle T4-C03 — GWT Scenario: Abandon a partial command

1. **Write the failing test.**
   - Scenario: `Abandon a partial command`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the editor contains "Fix login @pri"; When the user presses Escape and then repeats through click-away; Then the popover closes and "@pri" remains literal title text in both cases.
   - Exercise through: the rendered editor and document pointer boundary.
   - Test doubles: fixed field definitions; keep editor and popover real.
   - Expected RED: After T4-C02, the command state has no Escape/click-away abandonment transition that restores partial `@pri` as literal text, so the title-preservation assertion fails.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Abandon a partial command\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Abandon a partial command\""`. Expected: PASS.

#### RED Cycle T4-C04 — GWT Scenario: Ignore IME composition keystrokes

1. **Write the failing test.**
   - Scenario: `Ignore IME composition keystrokes`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given text composition is active; When "@" and Enter occur before compositionend; Then no command opens and no value selection fires.
   - Exercise through: composition events on the rendered native textarea.
   - Test doubles: fixed field definitions; keep composition guards real.
   - Expected RED: After T4-C03, key handling does not inspect `isComposing` or composition state, so an `@` or Enter generated before `compositionend` triggers command behavior.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Ignore IME composition keystrokes\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Ignore IME composition keystrokes\""`. Expected: PASS.

#### RED Cycle T4-C05 — GWT Scenario: Select an assignee with the keyboard

1. **Write the failing test.**
   - Scenario: `Select an assignee with the keyboard`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the field menu is open for "Fix login" with member Rafi available; When the user chooses Assignee, searches "raf", navigates with Arrow keys, and presses Enter; Then an Assignee Rafi chip appears while the persisted title candidate stays "Fix login".
   - Exercise through: the rendered textarea, combobox, listbox, and real reducer wrapper.
   - Test doubles: fixed external catalog data; keep editor, popover, and reducer real.
   - Expected RED: The popover created by T4-C01 lists fields only and has no searchable value stage or reducer dispatch, so filtering Assignee values to Rafi and creating the chip fails.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Select an assignee with the keyboard\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskFieldCommandPopover.tsx`, `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the value-stage behavior required by this cycle to the real popover and connect it through the editor without duplicating reducer state.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Select an assignee with the keyboard\""`. Expected: PASS.

#### RED Cycle T4-C06 — GWT Scenario: Do not create a missing option

1. **Write the failing test.**
   - Scenario: `Do not create a missing option`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the active value search has no results; When the user presses Enter; Then nothing is selected or created and cancellation remains available.
   - Exercise through: the rendered value listbox and keyboard event path.
   - Test doubles: an empty external catalog; keep editor and popover real.
   - Expected RED: After T4-C05 adds searchable values, Enter still assumes an active option; an empty filtered list is not consumed as a no-op, so the selection/creation assertion fails.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Do not create a missing option\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskFieldCommandPopover.tsx`, `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the value-stage behavior required by this cycle to the real popover and connect it through the editor without duplicating reducer state.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Do not create a missing option\""`. Expected: PASS.

#### RED Cycle T4-C07 — GWT Scenario: Consume Enter while the picker is unavailable

1. **Write the failing test.**
   - Scenario: `Consume Enter while the picker is unavailable`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the active picker is separately rendered as loading, failed, disabled, and empty; When the user presses Enter in each state; Then the keystroke is consumed without selecting a value or submitting the host form.
   - Exercise through: the rendered editor inside a submit-observing form.
   - Test doubles: external catalog states and a submit spy; keep editor, popover, and reducer real.
   - Expected RED: After T4-C06 handles empty results, loading, failed, and disabled option states do not yet consume Enter, allowing the host form submit handler to run.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Consume Enter while the picker is unavailable\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskFieldCommandPopover.tsx`, `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the value-stage behavior required by this cycle to the real popover and connect it through the editor without duplicating reducer state.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Consume Enter while the picker is unavailable\""`. Expected: PASS.

#### RED Cycle T4-C08 — GWT Scenario: Edit a chip by clicking it

1. **Write the failing test.**
   - Scenario: `Edit a chip by clicking it`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the real reducer wrapper contains Priority High; When the user clicks its chip; Then the Priority value picker opens with High selected.
   - Exercise through: the rendered chip button and value listbox.
   - Test doubles: fixed catalog data; keep editor, popover, and reducer real.
   - Expected RED: Selected values render after T4-C05, but chips have no edit action that reopens the matching value picker with the current value selected.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Edit a chip by clicking it\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Edit a chip by clicking it\""`. Expected: PASS.

#### RED Cycle T4-C09 — GWT Scenario: Remove a chip by pointer or keyboard

1. **Write the failing test.**
   - Scenario: `Remove a chip by pointer or keyboard`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given a metadata chip follows a plain title; When the user removes it through its control and then repeats using two-stage Backspace; Then the chip and reducer value disappear while the plain title is unchanged.
   - Exercise through: the rendered remove control, textarea boundary, and real reducer wrapper.
   - Test doubles: fixed catalog data; keep editor, popover, reducer, and key handling real.
   - Expected RED: After T4-C08 adds chip activation, the editor has no remove control plus two-stage boundary Backspace state, so chip selection/removal assertions fail.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Remove a chip by pointer or keyboard\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Remove a chip by pointer or keyboard\""`. Expected: PASS.

#### RED Cycle T4-C11 — GWT Scenario: Select multiple assignees

1. **Write the failing test.**
   - Scenario: `Select multiple assignees`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the Assignee value picker is open with Rafi and Maya available; When the user selects Rafi and then Maya; Then both reducer values are selected and the picker remains open until Done, then remains open in a repeated run until Escape.
   - Exercise through: the rendered multi-value listbox and real reducer wrapper.
   - Test doubles: fixed member catalog data; keep editor, popover, and reducer real.
   - Expected RED: The value stage added by T4-C05 closes after every Enter and has no multi-select stay-open/Done behavior, so selecting Rafi then Maya cannot retain both values before Escape or Done.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Select multiple assignees\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskFieldCommandPopover.tsx`, `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the value-stage behavior required by this cycle to the real popover and connect it through the editor without duplicating reducer state.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Select multiple assignees\""`. Expected: PASS.

#### RED Cycle T4-C10 — GWT Scenario: Restore title focus after a picker closes

1. **Write the failing test.**
   - Scenario: `Restore title focus after a picker closes`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given a field picker and then a value picker are opened from a known caret; When each closes through Enter, Escape, Done, and click-away in separate assertions; Then focus and caret return to the native title textarea while the create surface stays mounted.
   - Exercise through: the rendered editor focus lifecycle.
   - Test doubles: fixed catalog data; keep focus management and command components real.
   - Expected RED: Popover close paths through selection, Escape, Done, and click-away do not yet restore the textarea ref and caret, so focus remains outside the title editor.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Restore title focus after a picker closes\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Restore title focus after a picker closes\""`. Expected: PASS.

#### RED Cycle T4-C12 — GWT Scenario: Reject a chips-only draft

1. **Write the failing test.**
   - Scenario: `Reject a chips-only draft`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the editor has chips and whitespace-only title text; When the host form requests a submit candidate; Then no create callback fires and title-required state appears.
   - Exercise through: the rendered native editor inside a submit-observing form.
   - Test doubles: fixed catalog data and submit spy; keep title extraction, editor, and reducer real.
   - Expected RED: The editor exposes chips and text after T4-C11 but has no plain-title validity result for the host, so a chips-only or whitespace-only draft is reported as submittable.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Reject a chips-only draft\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Reject a chips-only draft\""`. Expected: PASS.

#### RED Cycle T4-C13 — GWT Scenario: Exclude chips from title length validation

1. **Write the failing test.**
   - Scenario: `Exclude chips from title length validation`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given plain title text is exactly the endpoint limit and metadata chips are present; When the host form requests a submit candidate; Then validation counts only plain title text and returns no chip markup.
   - Exercise through: the rendered native editor validation callback.
   - Test doubles: fixed endpoint limit and catalog data; keep extraction logic and reducer real.
   - Expected RED: After T4-C12 adds title validity, the submit candidate has no endpoint-limit calculation isolated from chip labels, so the exact-max plain title plus chips is rejected or counted incorrectly.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Exclude chips from title length validation\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Exclude chips from title length validation\""`. Expected: PASS.

#### RED Cycle T4-S01 — Support: exposes combobox semantics and announces chip changes

1. **Write the failing test.**
   - Scenario: `exposes combobox semantics and announces chip changes`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the editor, field stage, value stage, and chip list are rendered; When keyboard focus, active options, chip add/remove, and invalid-chip state change; Then combobox/listbox roles, aria-expanded, aria-controls, aria-activedescendant, option selection state, and a polite live region expose the same state without moving DOM focus away from the textarea.
   - Exercise through: the real TaskTitleEditor and TaskFieldCommandPopover rendered with the real reducer wrapper.
   - Test doubles: fixed catalog data only; keep editor, popover, reducer, focus management, and ARIA output real.
   - Expected RED: The interaction cycles T4-C01 through T4-C13 add visible behavior but do not yet define aria-activedescendant wiring or a live region for chip add/remove/invalid announcements, so the accessibility queries and announcement assertions fail.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"exposes combobox semantics and announces chip changes\""`. Expected: FAIL for the missing ARIA relationships and announcements.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskTitleEditor.tsx`, `client/src/components/task-entry/TaskFieldCommandPopover.tsx`. Add the semantic relationships and polite announcements without changing keyboard focus ownership or adding animation.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"exposes combobox semantics and announces chip changes\""`. Expected: PASS.

#### RED Cycle T4-S02 — Support: preserves Tab navigation around the command editor

1. **Write the failing test.**
   - Scenario: `preserves Tab and Shift+Tab navigation around the command editor`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given textarea focus owns an open field/value popover; When Tab is pressed; Then the popover closes without selecting, draft text/chips remain, and focus advances in DOM order from textarea to each rendered chip action and then the next form control (or directly to the next control when no chips exist). When Shift+Tab is pressed from the textarea; Then the popover closes without selecting and focus moves to the preceding form control. No path restores focus back to the textarea after the browser has moved it with Tab.
   - Exercise through: the real TaskTitleEditor and TaskFieldCommandPopover inside a form harness.
   - Test doubles: fixed catalog values only; keep browser focus order, editor, chips, popover, and reducer real.
   - Expected RED: Existing T4 interactions define Arrow/Enter/Escape and focus restoration but no Tab/Shift+Tab contract, so focus skips the intended chip/form destination or closes command state while the assertion expects preserved draft and surface.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"preserves Tab and Shift\+Tab navigation around the command editor\""`. Expected: FAIL on focus order or preserved-state assertions.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskTitleEditor.tsx`, `client/src/components/task-entry/TaskFieldCommandPopover.tsx`. Keep DOM focus on the textarea while listbox options use aria-activedescendant; on Tab/Shift+Tab close the popover without selection or preventDefault, preserving draft and allowing native DOM order: textarea → chip actions in render order → next form control, with reverse order for Shift+Tab.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"preserves Tab and Shift\+Tab navigation around the command editor\""`. Expected: PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx`. Expected: PASS.
3. **Commit:** `git add client/src/components/task-entry/TaskTitleEditor.tsx client/src/components/task-entry/TaskFieldCommandPopover.tsx client/src/components/task-entry/TaskTitleEditor.test.tsx` then `git commit -m "feat(task-entry): add task field command editor"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: deep. The boundary is independently runnable after T2 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: Keep the title source as a native textarea and chips as sibling end elements; keep TaskTitleEditor, TaskFieldCommandPopover, and the reducer real in component tests.]
You are implementing Composite task title editor and command popover for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T2.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Keep the title source as a native textarea and chips as sibling end elements; keep TaskTitleEditor, TaskFieldCommandPopover, and the reducer real in component tests.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `feat(task-entry): add task field command editor` exists.

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

---

### Task 6: Atomic Board card creation backend [depends: T3] [test-risk]

## OBJECTIVE

Extract the Board create handler and atomically persist validated scalar metadata, relations, and card activity before best-effort post-commit effects.

Files:

- Create: `server/src/routes/card-create.ts`
- Modify: `server/src/routes/cards.ts`
- Test: `server/src/routes/cards-create-metadata.integration.test.ts`
- Test/read only: `server/src/routes/cards-taxonomy.integration.test.ts`
- Test/read only: `server/src/routes/cards-mutations.integration.test.ts`
- Read/import only: `server/src/routes/card-response.ts`
- Read/import only: `server/src/routes/card-assignees.ts`
- Read/import only: `server/src/routes/card-labels.ts`
- Read/import only: `server/src/routes/work-item-create-metadata.ts` (T3 validator)
- Read/import only: `server/src/routes/workspace-mutation-lock.ts` (T3 lock primitives)
- Read/import only: `server/src/routes/helpers.ts` (`recordActivity`)
- Read/import only: `server/src/validators/input-length.ts`
- Read/import only: `server/src/core/allocate-card-identity.ts`
- Read/import only: `server/src/core/wip.ts`
- Read/import only: `server/src/core/position.ts`
- Read/import only: `server/src/db/kysely.ts`
- Read/import only: `server/src/realtime.ts`
- Read/import only: `server/src/events.ts`

Steps:

#### Regression Verification T6-C03 — GWT Scenario: Deduplicate the same automatic and explicit assignee

1. **Define the regression verification.**
   - Scenario: `Deduplicate the same automatic and explicit assignee`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given the destination auto-assigns Rafi and the request also selects Rafi; When POST /cards completes; Then Rafi is persisted once and receives exactly one assignment notification.
   - Exercise through: Express POST /cards through Supertest against a real migrated PostgreSQL database.
   - Test doubles: spy only post-commit event and notification publishers; keep all database collaborators real.
   - Baseline timing: Write and run before T6 production changes to record the currently green public post-state; rerun after T6-C02 introduces explicit-assignee merging.
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Deduplicate the same automatic and explicit assignee\""`. Expected: PASS today because the route ignores explicit assigneeIds and stores/notifies the automatic Rafi once; the post-change run proves the new merge path preserves that observable invariant..
3. **Run the same verification after this task's production changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Deduplicate the same automatic and explicit assignee\""`. Expected: PASS.

#### RED Cycle T6-C01 — GWT Scenario: Create a fully configured Board card

1. **Write the failing test.**
   - Scenario: `Create a fully configured Board card`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given an authorized member submits Fix login in To do with every supported Board metadata field; When POST /cards completes; Then one hydrated card is committed in To do with scalar fields, assignee relations, label relations, and one card activity row.
   - Exercise through: Express POST /cards through Supertest against a real migrated PostgreSQL database.
   - Test doubles: spy only post-commit event and notification publishers; keep route, validator, Kysely, database, relation helpers, and activity helper real.
   - Expected RED: Current `POST /cards` destructures only `columnId`, `title`, `description`, and `statusId` and writes no requested scalar or label relations, so the fully configured hydrated-card and relation assertions fail.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Create a fully configured Board card\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `server/src/routes/card-create.ts`, `server/src/routes/cards.ts`. Implement the atomic metadata-aware handler in `card-create.ts`, then replace the inline `POST /cards` body in `cards.ts` with explicit delegation to that handler so the tested public route reaches the new behavior; retain every previously green cycle.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Create a fully configured Board card\""`. Expected: PASS.

#### RED Cycle T6-C02 — GWT Scenario: Merge explicit and signable-column assignees

1. **Write the failing test.**
   - Scenario: `Merge explicit and signable-column assignees`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given the destination auto-assigns Rafi and the request explicitly selects Maya; When POST /cards completes; Then Rafi and Maya each have one relation and exactly one post-commit assignment notification.
   - Exercise through: Express POST /cards through Supertest against a real migrated PostgreSQL database.
   - Test doubles: spy only post-commit event and notification publishers; keep all database collaborators real.
   - Expected RED: Current `POST /cards` ignores request `assigneeIds` and inserts only the signable-column assignee, so Maya has no `card_assignees` row and the merged-assignee assertion fails.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Merge explicit and signable-column assignees\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `server/src/routes/card-create.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Merge explicit and signable-column assignees\""`. Expected: PASS.

#### RED Cycle T6-C04 — GWT Scenario: Reject a stale signable-column assignee

1. **Write the failing test.**
   - Scenario: `Reject a stale signable-column assignee`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given the destination column points to an auto-assignee whose workspace membership no longer exists; When POST /cards runs; Then the request is rejected with a column configuration error and no card, relation, or activity row is committed.
   - Exercise through: Express POST /cards through Supertest against a real migrated PostgreSQL database.
   - Test doubles: spy only post-commit publishers; keep route, validator, Kysely, database, relation helpers, and activity helper real.
   - Expected RED: Current `POST /cards` copies `signable_assignee_id` without revalidating workspace membership, so a stale automatic assignee reaches relation insertion instead of returning the asserted column configuration error before writes.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Reject a stale signable-column assignee\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `server/src/routes/card-create.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Reject a stale signable-column assignee\""`. Expected: PASS.

#### Regression Verification T6-C05 — GWT Scenario: Roll back every side effect on invalid create

1. **Define the regression verification.**
   - Scenario: `Roll back every side effect on invalid create`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given Board metadata validation fails after multiple invalid references are submitted; When POST /cards completes its rejection path; Then no card, relation, card activity, realtime event, or notification exists.
   - Exercise through: Express POST /cards through Supertest plus real database row assertions.
   - Test doubles: spy only post-commit event and notification publishers; keep route, validator, transaction, relation helpers, and activity helper real.
   - Baseline timing: Run after T6-C01 atomic metadata creation is green.
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Roll back every side effect on invalid create\""`. Expected: PASS; invalid metadata must leave no card, relation, activity, realtime event, or notification..
3. **Run the same verification after this task's remaining production changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"Roll back every side effect on invalid create\""`. Expected: PASS.

#### RED Cycle T6-S03 — Support: keeps committed Board success after publisher failure

1. **Write the failing test.**
   - Scenario: `keeps committed Board success after publisher failure`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given a valid card transaction commits and the realtime publisher rejects; When POST /cards completes; Then HTTP success and committed rows remain and assignment notification processing is not part of this isolated failure case.
   - Exercise through: Express POST /cards through Supertest against a real migrated PostgreSQL database.
   - Test doubles: force only the realtime publisher to reject; keep notification publisher successful and transaction/activity/database real.
   - Expected RED: Evaluated against the handler as it stands after T6-C01/C02/C04, not against the pre-task route. `card-create.ts` at that point still carries forward the original ordering from `cards.ts:396-400` — `await publishCardWorkspaceEvent(...)` before the response, with no best-effort guard — so a publisher rejection turns a committed create into an HTTP failure and the success assertion fails. If T6-C01 already introduced the guard, this cycle is not red: stop and record it as a Regression Verification instead of manufacturing a failure.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"keeps committed Board success after publisher failure\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `server/src/routes/card-create.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"keeps committed Board success after publisher failure\""`. Expected: PASS.

#### RED Cycle T6-S04 — Support: does not emit a due-date-change notification at creation

1. **Write the failing test.**
   - Scenario: `does not emit a due-date-change notification at creation`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given a valid new card includes an initial Due date; When POST /cards commits; Then the create event represents the date and no due-date-change notification is published.
   - Exercise through: Express POST /cards through Supertest against a real migrated PostgreSQL database.
   - Test doubles: spy on post-commit publishers; keep route and database collaborators real.
   - Expected RED: Current `POST /cards` ignores `dueDate` and records only `cardTitle` in create activity, so the assertion that the create event represents the initial date fails even though no due-date-change notification is emitted.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"does not emit a due-date-change notification at creation\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `server/src/routes/card-create.ts`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"does not emit a due-date-change notification at creation\""`. Expected: PASS.

#### Regression Verification T6-S05 — Support: rejects malformed Board due date atomically

1. **Define the regression verification.**
   - Scenario: `rejects malformed Board due date atomically`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given POST /cards contains a non-calendar dueDate; When the public route validates it; Then the response contains a dueDate field error and no card, relation, activity, realtime event, or notification is produced
   - Exercise through: Express POST /cards through Supertest and real database zero-write assertions.
   - Test doubles: publisher spies only; keep route, validator, and database real.
   - Baseline timing: Run after T6-C01 atomic metadata creation is green
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"rejects malformed Board due date atomically\""`. Expected: PASS.
3. **Run the same verification after this task's remaining changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"rejects malformed Board due date atomically\""`. Expected: PASS.

#### Regression Verification T6-S06 — Support: preserves Phase inference and rejects Project Phase mismatch on Board create

1. **Define the regression verification.**
   - Scenario: `preserves Phase inference and rejects Project Phase mismatch on Board create`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given Phase-only Board metadata and then a valid same-workspace mismatched Project/Phase pair; When POST /cards handles each request; Then the first persists the inferred parent Project and the second returns stable field errors with zero writes
   - Exercise through: two public Express POST /cards cases through Supertest with real PostgreSQL.
   - Test doubles: publisher spies only; keep route, validator, transaction, and DB real.
   - Baseline timing: Run after T6-C01 is green and T3-S05 validator behavior exists
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"preserves Board Phase inference and mismatch rejection\""`. Expected: PASS.
3. **Run the same verification after this task's remaining changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"preserves Board Phase inference and mismatch rejection\""`. Expected: PASS.

#### Regression Verification T6-S07 — Support: returns all invalid Board fields from the public route

1. **Define the regression verification.**
   - Scenario: `returns all invalid Board fields from the public route`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given multiple stale/wrong-kind Board metadata references; When POST /cards rejects; Then one HTTP response exposes every stable fieldErrors entry and no side effect is committed
   - Exercise through: public Express POST /cards through Supertest plus real database assertions.
   - Test doubles: publisher spies only; keep error mapping, validator, and route real.
   - Baseline timing: Run after T6-C01 and T6-C05 are green
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"returns all invalid Board fields\""`. Expected: PASS.
3. **Run the same verification after this task's remaining changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"returns all invalid Board fields\""`. Expected: PASS.

#### RED Cycle T6-S08 — Support: keeps Board success when assignment notification publication fails

1. **Write the failing test.**
   - Scenario: `keeps Board success when assignment notification fails`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given card persistence commits and only assignment-event publication rejects; When POST /cards completes; Then HTTP success and committed rows remain, the notification failure is observed/logged, and no duplicate publication occurs.
   - Exercise through: public Express POST /cards with real PostgreSQL.
   - Test doubles: force only assignment notification publication to reject; keep realtime publisher successful and persistence collaborators real.
   - Expected RED: T6-S03 makes only realtime publication best-effort and explicitly leaves assignment notification successful, so a rejected assignment publisher still escapes the post-commit path and prevents the asserted HTTP success.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"keeps Board success when assignment notification fails\""`. Expected: FAIL because assignment publication rejection escapes.
3. **Implement the minimum behavior.** File: `server/src/routes/card-create.ts`. Apply the same isolated best-effort error handling to each unique assignment notification after commit, record/log failure without throwing, and do not retry or duplicate notifications.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"keeps Board success when assignment notification fails\""`. Expected: PASS.

#### RED Cycle T6-S09 — Support: constructs the Board response before commit completes

1. **Write the failing test.**
   - Scenario: `constructs the Board response before commit completes`
   - Test file: `server/src/routes/cards-create-metadata.integration.test.ts`
   - Level: integration.
   - Test intent: Given a valid metadata create; When SQL ordering is recorded; Then every database query needed for the hydrated HTTP card occurs inside the transaction before COMMIT, and no fallible hydration SELECT occurs between COMMIT and the response.
   - Exercise through: public POST /cards with real PostgreSQL and a query-order recorder around the DB driver.
   - Test doubles: record query/transaction boundaries only; keep SQL execution, route, validator, relations, and activity real.
   - Expected RED: Evaluated against the handler as it stands after the earlier T6 cycles. It still carries forward the pre-task hydration shape from `cards.ts:402` — `hydrateCard(cardId, workspaceId)` running on the global `db` after the transaction commits — so the query log contains hydration SELECT statements after COMMIT. If an earlier cycle already moved hydration inside the transaction, this cycle is not red: record it as a Regression Verification instead.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"constructs the Board response before commit completes\""`. Expected: FAIL on post-COMMIT hydration queries.
3. **Implement the minimum behavior.** File: `server/src/routes/card-create.ts`. Produce the complete hydrated response from transaction-scoped queries/results and leave only best-effort publishers after commit.
   - Available seam: `hydrateCardResponses(dbExec, rows)` in `card-response.ts:159` already takes a `DBExecutor`, as do `loadCardAssigneesForCards` and `loadCardLabelsForCards`. Hydrating inside the transaction therefore needs no change to any read/import-only file — pass `trx` where `cards.ts:150` passes the global `db`.
   - Row selection: `selectFullCard` is currently module-private at `cards.ts:61`. Export it (`cards.ts` is modifiable in this task) and call `selectFullCard(trx)`.
   - Import-cycle caution: `cards.ts` will import `card-create.ts` for delegation while `card-create.ts` imports `selectFullCard` back from `cards.ts`. Under NodeNext ESM this resolves because `selectFullCard` is a hoisted `function` declaration, but it is fragile. If the cycle causes any load-order problem, move `selectFullCard` into `card-response.ts` and raise that file from read/import-only to modifiable for this task before doing so.
   - Do not regress assignment notification: `cards.ts:401-409` currently feeds `card!.title` from the post-commit `hydrateCard` into `emitCardAssigned`. Once hydration moves inside the transaction, the in-transaction hydration result must supply that title to the post-commit publishers. Losing the title here silently breaks the assignment notification that T6-C02, T6-C03, and T6-S08 all assert on.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts -t "\"constructs the Board response before commit completes\""`. Expected: PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-create-metadata.integration.test.ts`. Expected: PASS.
3. **Run preserved Board-create regressions:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-taxonomy.integration.test.ts -t "\"rejects statusId on POST\""` and `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/cards-mutations.integration.test.ts -t "\"rejects concurrent creates beyond the WIP limit\""`. Expected: PASS. These are regression checks, not RED cycles, because both behaviors already pass before extraction.
4. **Commit:** `git add server/src/routes/card-create.ts server/src/routes/cards.ts server/src/routes/cards-create-metadata.integration.test.ts` then `git commit -m "feat(cards): create cards with atomic metadata"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: deep. The boundary is independently runnable after T3 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: Validate and lock before identity allocation; commit cards, relations, and card_events together; publish only after commit.]
You are implementing Atomic Board card creation backend for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T3.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Validate and lock before identity allocation; commit cards, relations, and card_events together; publish only after commit.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `feat(cards): create cards with atomic metadata` exists.

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

### Task 8: Race-safe member removal [depends: T6, T7] [test-risk]

## OBJECTIVE

Make member removal call the workspace lock contract before existing cleanup and verify revoked and concurrent membership invalidation through real HTTP transactions.

Files:

- Modify: `server/src/routes/helpers.ts`
- Test: `server/src/routes/workspaceAccess.test.ts`
- Create: `server/src/routes/work-item-member-concurrency.integration.test.ts`

Steps:

#### Regression Verification T8-C01 — GWT Scenario: Reject a revoked assignee

1. **Define the regression verification.**
   - Scenario: `Reject a revoked assignee`
   - Test file: `server/src/routes/work-item-member-concurrency.integration.test.ts`
   - Level: integration.
   - Test intent: Given an assignee was selected before that member removal committed; When Board create and Tracker create are submitted after removal in separate fixtures; Then each create is rejected atomically with an Assignee error and no task, relation, or activity row.
   - Exercise through: real Board and Tracker HTTP create routes plus the real member-removal route through Supertest and PostgreSQL.
   - Test doubles: scheduling barriers and post-commit publisher spies; keep all collaborating create, removal, lock, validator, transaction, and database units real.
   - Baseline timing: Run after T6 and T7 are green but before the T8 concurrent-removal lock change.
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"Reject a revoked assignee\""`. Expected: PASS; transaction-scoped create validation must reject a membership removed before submission..
3. **Run the same verification after this task's production changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"Reject a revoked assignee\""`. Expected: PASS.

#### Regression Verification T8-C02 — GWT Scenario: Resolve a concurrent reference deletion atomically

1. **Define the regression verification.**
   - Scenario: `Resolve a concurrent reference deletion atomically`
   - Test file: `server/src/routes/work-item-member-concurrency.integration.test.ts`
   - Level: integration.
   - Test intent: Given a selected member reference is removed while Board and Tracker creates are deliberately interleaved in separate fixtures; When the real transactions are released from synchronization barriers; Then each result is a complete valid task committed before removal or a complete rejection after removal, with no orphaned or partial state.
   - Exercise through: real Board and Tracker HTTP create routes plus the real member-removal route through Supertest and PostgreSQL.
   - Test doubles: scheduling barriers and post-commit publisher spies; keep all collaborating routes, locks, validator, transactions, and database real.
   - Baseline timing: Run after T6/T7 transaction-scoped membership validation is green and before T8-S02 adds workspace-first removal locking.
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"Resolve a concurrent reference deletion atomically\""`. Expected: PASS is permitted because create and delete already conflict on the referenced workspace_members row; the post-change run protects the same complete-create-or-reject invariant..
3. **Run the same verification after this task's remaining production changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"Resolve a concurrent reference deletion atomically\""`. Expected: PASS.

#### RED Cycle T8-S02 — Support: waits on workspace lock before deleting membership

1. **Write the failing test.**
   - Scenario: `waits on workspace lock before deleting membership`
   - Test file: `server/src/routes/work-item-member-concurrency.integration.test.ts`
   - Level: integration.
   - Test intent: Given transaction A holds FOR UPDATE on the workspace row; When transaction B starts member removal; Then query pg_stat_activity/pg_locks until B is observably waiting on A's workspace-row lock (with a bounded timeout), proving B reached the workspace barrier; only then, while A is held, transaction C can acquire the target workspace_members row with FOR UPDATE NOWAIT; after C releases and A commits, B proceeds and completes existing cleanup.
   - Exercise through: real PostgreSQL transactions plus the public member-removal route/service boundary; use a third connection and NOWAIT to distinguish workspace-first waiting from membership-first deletion.
   - Test doubles: deterministic barriers, bounded pg_stat_activity/pg_locks wait-state polling, and timeouts only; keep workspace lock helper, default removeMember transaction, Kysely, PostgreSQL, membership delete, and cleanup real.
   - Expected RED: Current default removeMember transaction executes DELETE workspace_members before any workspace-row lock, so transaction B holds or waits on the membership row and transaction C's FOR UPDATE NOWAIT fails instead of succeeding while B is blocked on the workspace.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"waits on workspace lock before deleting membership\""`. Expected: FAIL because the third connection cannot lock the membership row.
3. **Implement the minimum behavior.** File: `server/src/routes/helpers.ts`. Inside the existing default WorkspaceAccessDeps.removeMember transaction callback, call lockWorkspaceMutation(trx, workspaceId) before DELETE workspace_members, then preserve signable-column, card-assignee, tracker-assignee, and publication behavior.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"waits on workspace lock before deleting membership\""`. Expected: PASS, then rerun T8-C02 and expect PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts && RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts`. Expected: PASS.
3. **Commit:** `git add server/src/routes/helpers.ts server/src/routes/workspaceAccess.test.ts server/src/routes/work-item-member-concurrency.integration.test.ts` then `git commit -m "fix(workspaces): serialize member removal with task create"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: deep. The boundary is independently runnable after T6 and T7 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: Member removal and both create routes must collaborate against real PostgreSQL for race proof; unit coverage is service regression only.]
You are implementing Race-safe member removal for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T6 and T7.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Member removal and both create routes must collaborate against real PostgreSQL for race proof; unit coverage is service regression only.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `fix(workspaces): serialize member removal with task create` exists.

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

---

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

---

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

---

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

---

## Plan Summary

| Task | Name | Depends | Phase | Complexity |
| --- | --- | --- | --- | --- |
| T1 | Client create and field-error contracts | none | A | standard |
| T2 | Shared task metadata draft reducer | T1 | A | standard |
| T3 | Transactional task metadata validation and workspace lock primitives | none | A | deep |
| T4 | Composite task title editor and command popover | T2 | B | deep |
| T5 | Workspace metadata catalog and field definitions | T2 | B | standard |
| T6 | Atomic Board card creation backend | T3 | B | deep |
| T7 | Strict Tracker item creation backend | T3 | B | deep |
| T8 | Race-safe member removal | T6 and T7 | C | deep |
| T9 | Race-safe project removal | T6 and T7 | C | deep |
| T10 | Race-safe phase removal | T6 and T7 | C | deep |
| T11 | Board Add Card tag integration | T1, T4, T5, and T6 | C | deep |
| T12 | Tracker New Item tag integration | T1, T4, T5, and T7 | C | deep |

### Final Verification Commands

Run only after all tasks complete:

```text
npm run test
npm run typecheck
npm run lint
make check
npm run check:mutation-routing
npm run check:key-collisions --workspace=server
```

The key-collision command requires a configured local database. Direct `npx vitest run` is prohibited.

Two limits on this list, both verified against the repo:

- `make check` runs `npm run lint` and `npm run check:mutation-routing`, and adds `check:key-collisions` only when `DATABASE_URL` is set — the last two entries above are already covered by it unless `DATABASE_URL` is unset.
- `scripts/check-work-item-mutation-routing.mjs` matches `api.(updateWorkItem|updateTrackerItem|updateCard)` only. It does **not** guard create calls, so nothing in this list prevents T11 or T12 from calling `api.createCard` / `api.createWorkItem` outside the intended seam. Board and Tracker create routing is enforced by the T11/T12 component tests alone. If create routing is worth the same protection as update routing, extend the guard's `FORBIDDEN` pattern in a follow-up — it is out of scope for this plan and must not be bundled into a task packet.
