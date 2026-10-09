# Task T1 — Client create and field-error contracts

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
