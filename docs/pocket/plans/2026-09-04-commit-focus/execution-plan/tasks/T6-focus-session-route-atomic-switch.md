# Task T6 — Focus session route — atomic switch

**Phase:** 2
**Depends:** T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: Focus session route — atomic switch [depends: T5]

## OBJECTIVE

Add the `switch` action to `POST /workspaces/:workspaceId/focus-session`: finish the current session with its in-flight time accrued and create a Ready session on the new task, in a **single database transaction** so a user can never end up with two active sessions or with the old one destroyed and no replacement.

Files:
- Modify: `server/src/routes/focus-session.ts`
- Modify: `server/src/routes/focus-session-repo.ts`
- Test: `server/src/routes/focus-session.switch.test.ts`
- Test: `server/src/routes/focus-session.switch.integration.test.ts`

The repo gains one method: `switchSession(finish: { id, patch, expectedVersion }, create: InsertInput): Promise<{ finished: FocusSessionRow; created: FocusSessionRow } | null>`, implemented with `db.transaction().execute(...)` and returning `null` when the version guard matched no row. Keeping the transaction inside the repo is what lets the route stay testable with a fake.

Steps:

1. Write failing test for: `Given Running on task A, When switchSession creates B, Then the real transaction finishes A and leaves exactly one active session on B`
   Test file: `server/src/routes/focus-session.switch.integration.test.ts`
   Level: integration (real PostgreSQL)

   Test intent:
   Given an isolated real database fixture with a Running session on task A for `(user 7, workspace 3)`, plus a valid Ready-session insert input for task B
   When `createFocusSessionRepo(db).switchSession({ finish: { id: A.id, patch: { state: "finished", accumulated_seconds: 360, running_since: null, finished_at: T1 }, expectedVersion: A.version }, create: B })` runs
   Then:
   - exactly one row with `state <> 'finished'` exists for that `(user_id, workspace_id)`, and it points at B with `accumulated_seconds = 0`
   - A's row is present with `state = "finished"` and its accrued seconds
   - no unique-constraint violation is raised, proving the finish update occurs before the insert inside one transaction

   Fixture boundary: seed and clean up only the dedicated user, workspace, and `focus_sessions` rows, following `server/src/routes/work-item-member-concurrency.integration.test.ts`; do not rely on pre-existing rows or hard-coded generated ids.

   Exercise through: `createFocusSessionRepo(db).switchSession(...)`; the repository transaction is the unit under test
   Test doubles: none; gate the file with `describe.skipIf(!process.env.RUN_INTEGRATION)` so the default suite collects but skips it without a database
   Expected RED: `repo.switchSession is not a function` because T4's repository has no switch method yet

2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts` (needs `make db-up && make db-migrate`)
   Expected failure: `TypeError: repo.switchSession is not a function`

3. Write a separate failing test for: `Given the replacement insert fails, When switchSession runs, Then the old session remains Running`
   Test file: `server/src/routes/focus-session.switch.integration.test.ts`
   Level: integration (real PostgreSQL)

   Test intent:
   Given the same isolated fixture with Running session A, and a replacement insert input that explicitly sets `id: A.id` (Kysely's `Generated<number>` id is optional in an insert input; production leaves it generated, while this test uses the duplicate primary key as a deterministic insert failure)
   When `switchSession` attempts to finish A and insert B in one transaction
   Then:
   - the call rejects with PostgreSQL's duplicate-primary-key error
   - a fresh query shows A is still `state: "running"` with its original version and accumulated seconds — the failed insert rolled back the finish update

   Exercise through: the real `createFocusSessionRepo(db).switchSession(...)` boundary, followed by a real query of A
   Test doubles: none; use the same `RUN_INTEGRATION` gate and isolated fixture cleanup as the first integration scenario
   Expected RED: `repo.switchSession is not a function`; after the method exists, this test must fail if the implementation uses two sequential writes instead of a transaction

3a. Write a separate failing test for: `Given a stale expectedVersion, When switchSession runs against PostgreSQL, Then it returns null and A stays Running`
   Test file: `server/src/routes/focus-session.switch.integration.test.ts`
   Level: integration (real PostgreSQL)
   Test intent: Given Running session A at `version: 4`, When `switchSession` is called with `expectedVersion: 2` and a valid create input for B, Then the call resolves `null`, a fresh query shows A still Running at version 4 with original accumulated seconds, and no row for B exists. A fake-repo HTTP 409 cannot prove the SQL version guard.
   Exercise through: the real `createFocusSessionRepo(db).switchSession(...)` boundary, followed by a real query of A and a count of B
   Test doubles: none; same `RUN_INTEGRATION` gate and isolated fixture cleanup
   Expected RED: `repo.switchSession is not a function`; after the method exists, this must fail if the UPDATE omits `version = expectedVersion`

4. Run test — verify FAIL for integration RED case A only: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t exactly.one.row`.
   Expected failure: `repo.switchSession is not a function`.

4a. Run test — verify FAIL for integration RED case B only: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t old.session.remains.Running`.
   Expected failure: `repo.switchSession is not a function`.

4b. Run test — verify FAIL for integration RED case C only: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t stale.expectedVersion`.
   Expected failure: `repo.switchSession is not a function`.

   **Filter hygiene for steps 4, 4a, 4b and 6.** The `-t` values above are unquoted regexes whose `.` stands in for a space. Never write `-t "old session remains Running"`: npm strips the quotes, vitest receives `-t old` plus three stray positional filters, and the run can report `Tests N skipped (N)` at **exit 0** — a green gate that executed nothing (`CLAUDE.md`, "Never filter with `-t \"multi word\"`"). After every filtered run, confirm the summary says `Tests 1 passed (1)` or `1 failed`, not `skipped`. If that is ever in doubt, drop the filter and run the whole file.

5. Implement minimal code to satisfy the three independent integration cases:
   File: `server/src/routes/focus-session-repo.ts` — add `switchSession`, using `db.transaction().execute(...)`, applying the guarded finish update first (`WHERE id = $id AND version = expectedVersion`) and then inserting the replacement; return both rows and return `null` when the expected version matches no row.

6. Run test — verify PASS for case A, then case B, then case C, then the file as a whole: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t exactly.one.row`, `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t old.session.remains.Running`, `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t stale.expectedVersion`, and finally `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts`.

7. Write failing test for: `Given Running on task A with 300 accumulated seconds, When confirm switch to B, Then A is Finished with accumulated time and B is Ready at 0`
   Test file: `server/src/routes/focus-session.switch.test.ts`
   Level: unit

   Test intent:
   Given a Running session on task A (`accumulated_seconds: 300`, `running_since: T0`, `version: 2`) and a clock at `T0 + 60s`
   When `POST /workspaces/3/focus-session` with `{ action: "switch", source: "board", taskId: <B>, version: 2 }`
   Then:
   - `repo.switchSession` was called **once** — not a separate finish call followed by a separate insert
   - its `finish` argument carries `state: "finished"`, `accumulated_seconds: 360`, `running_since: null`, `finished_at` from the clock, and `expectedVersion: 2`
   - its `create` argument carries `task_source: "board"`, `task_id: B`, `state: "ready"`, `accumulated_seconds: 0`, `running_since: null`, and the `return_path` for B
   - the response is `201` and `body.session` is the **new** Ready session on B
   - `publish` was called as **two arguments** — `publishEvent(workspaceId, event)` (`server/src/realtime.ts:408`) — carrying the new session as `payload.session`, so other tabs land on B rather than a stale A. Assert `toHaveBeenCalledWith(3, {...})`, never a single object
   - the injected `recordFocusActivity()` audit spy was called once with `cardId: null` and `{ kind: "focus_session", action: "switch", sessionId, workspaceId, userId }`

   Exercise through: HTTP `POST`, via `supertest` against a router built with `createFocusSessionRouter({ repo: fakeRepo, now, publish, recordFocusActivity: vi.fn() })`. Reuse T4's app builder: `express.json()` plus a middleware setting **both** `req.user` and `req.workspace` — `work-items.test.ts` sets only the latter, and the `userId` assertions read `req.user!.id`
   Test doubles: fake `FocusSessionRepo` with `switchSession` as a `vi.fn()`; injected fixed clock; `vi.fn()` publisher; injected `recordFocusActivity()` audit spy; mock `../config.js` (`FOCUS_MODE_ENABLED: "true"`) and `../middleware/workspace.js` pass-through; do NOT mock `core/focus-session.ts`
   Expected RED: `switch` is not a recognized action, so the handler returns `409 { code: "session_active" }` instead of `201`

8. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`
   Expected failure: `expected 409 to be 201`

9. Implement minimal code to satisfy the test:
   File: `server/src/routes/focus-session.ts` — add the `switch` branch to `POST`: compute the finished snapshot via `applyAction(snapshot, "finish", now())`, build the new session input, call `repo.switchSession`, publish, serialize, and call the injected `recordFocusActivity()` audit seam once on success. The repository method is already implemented by Step 5.

10. Run test — verify PASS: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`

11. Write failing test for: switch with no active session behaves like a plain focus
    Test file: `server/src/routes/focus-session.switch.test.ts`
    Level: unit

    Test intent:
    Given `findActive` resolves `null` (the session finished in another tab between the dialog opening and the user confirming)
    When `POST { action: "switch", source: "tracker", taskId: 77 }`
    Then:
    - the response is `201` with a Ready session on the new task
    - `repo.insert` was used and `repo.switchSession` was NOT called — there is nothing to finish
    - the user is not shown an error for a race they did not cause

    Exercise through: HTTP `POST`
    Test doubles: fake repo, injected clock, `vi.fn()` publisher
    Expected RED: the switch branch assumes an active session and throws or 404s when there is none

12. Run test — verify FAIL, implement the fallback, verify PASS: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`

13. Write failing test for: a stale switch is rejected and leaves the old session running
    Test file: `server/src/routes/focus-session.switch.test.ts`
    Level: unit

    Test intent:
    Given the stored session on A is at `version: 4` and `repo.switchSession` returns `null` for `expectedVersion: 2`
    When `POST { action: "switch", source: "board", taskId: B, version: 2 }`
    Then:
    - the response is `409 { code: "version_conflict", session }` carrying the current session on A
    - `publish` was NOT called
    - `recordFocusActivity()` was NOT called — a rejected write is not an audit event
    - **no session on B exists** — a rejected switch must be all-or-nothing, never "A finished but B not created"

    Exercise through: HTTP `POST`
    Test doubles: fake repo returning `null` from `switchSession` then the current row from `findActive`; injected clock; `vi.fn()` publisher; injected `recordFocusActivity()` audit spy
    Expected RED: a `null` return is treated as success and a serialization of `null` escapes as a 500

14. Run test — verify FAIL, implement the 409 branch, verify PASS: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`

15. Write failing test for: switching to the task already focused is a no-op
    Test file: `server/src/routes/focus-session.switch.test.ts`
    Level: unit

    Test intent:
    Given an active session on task A
    When `POST { action: "switch", source: "board", taskId: <A, the same task> }`
    Then the existing session is returned unchanged, `repo.switchSession` was NOT called, `publish` was NOT called, and `recordFocusActivity()` was NOT called — a confirm dialog that resolves to the current task must never reset the running timer to zero

    Exercise through: HTTP `POST`
    Test doubles: fake repo, injected clock, `vi.fn()` publisher
    Expected RED: the switch branch runs unconditionally and returns a fresh session at 0 seconds

16. Run test — verify FAIL, implement the same-task guard (reusing T4's idempotent-focus comparison rather than writing a second one), verify PASS: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`

17. Write failing test for: switching to a task that does not resolve is refused
    Test file: `server/src/routes/focus-session.switch.test.ts`
    Level: unit

    Test intent:
    Given an active Running session on task A, and `findTask` resolving `null` for the target (soft-deleted, or belonging to another workspace)
    When `POST { action: "switch", source: "board", taskId: <B>, version: N }`
    Then:
    - the response is `404` and `repo.switchSession` was NOT called
    - session A is untouched — still Running, still holding its accumulated time
    - `publish` was NOT called

    T4 Step 7 proves this guard for the `focus` action; `switch` needs its own, and the consequence of missing it is worse. Without the guard the switch branch computes A's finish snapshot and commits the transaction, so the user loses an active session AND lands on one pointing at an inaccessible task, with `return_path` built from a null `task_key`.

    Exercise through: HTTP `POST`
    Test doubles: fake repo with `findTask` resolving `null`; injected fixed clock; `vi.fn()` publisher
    Expected RED: the switch branch never consults `findTask` — it finishes A and calls `switchSession` regardless

18. Run test — verify FAIL, implement the guard before any snapshot computation, verify PASS: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`

19. Refactor while green (bounded):
    - Rule of three: "does this request target the session's current task" now appears in the `focus` branch and the `switch` branch. Extract it once as a named predicate in `focus-session.ts` (e.g. `targetsSameTask(session, body)`) — never a generic `utils.ts`
    - The `create` input construction (`return_path`, `task_key`, Ready defaults) is shared by `focus` and `switch` — extract it once as `buildReadySessionInput(...)`. It is the single caller of `formatKey(derivePrefix(workspaceName), keyNumber)` from `core/tracker-key.ts`; do not derive the prefix a second time in the switch branch
    - If `focus-session.ts` crosses ~300 lines, move the repo-facing input builders into `focus-session-inputs.ts`; this conditional file is already listed in the File Structure Map and must be included in the commit below
    - Refactor only within `focus-session.ts` and `focus-session-repo.ts`, plus the mapped conditional `focus-session-inputs.ts`
    - Re-run all three default-run focus route suites — every one must stay PASS:
      `npm run test --workspace=server -- src/routes/focus-session.test.ts`
      `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
      `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`
    - Re-run the integration cycle: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts`

20. Commit:
    `git add server/src/routes/focus-session.ts server/src/routes/focus-session-repo.ts server/src/routes/focus-session.switch.test.ts server/src/routes/focus-session.switch.integration.test.ts`
    If Step 19 extracted `server/src/routes/focus-session-inputs.ts`, additionally run `git add server/src/routes/focus-session-inputs.ts` before committing.
    `git commit -m "feat(focus): add atomic focus session switch"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Switch task (both criteria); "Story: Switch focus task"; Implementation Notes: "Switch-focus atomicity: single server transaction (finish old + create new Ready) via `POST` action `switch`"
- `server/src/routes/focus-session.ts` (T4, T5) — the factory, repo interface, active-session helper, serializer, 409 contract
- `server/src/core/focus-session.ts` (T2) — `applyAction(snapshot, "finish", now)` computes the accrual at the switch moment
- `server/src/routes/tracker-projects.ts` — `db.transaction().execute(...)` usage in this codebase
- `server/src/routes/workspace-mutation-lock.ts` — existing precedent for serializing concurrent workspace mutations, if the transaction alone proves insufficient

## WHY THIS APPROACH

Complexity: standard
Justification: two files, but the deliverable is an atomicity guarantee — the failure mode (old session finished, new one never created, user's time silently gone) is invisible in a non-transactional implementation that otherwise passes every happy-path assertion.

## SANDWICH CONTEXT

[CRITICAL: finish-old and create-new must happen in ONE database transaction. Two sequential repo calls can leave a user with no session and lost time if the second fails, and the partial-unique index will reject a second active row anyway — producing a 500 instead of a switch.]

You are implementing the atomic focus session switch for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — confirm-then-switch; the old session is auto-stopped and Finished with its accumulated time, and the new session starts Ready at 0.
Files in scope: `server/src/routes/focus-session.ts`, `server/src/routes/focus-session-repo.ts`, `server/src/routes/focus-session.switch.test.ts`, `server/src/routes/focus-session.switch.integration.test.ts` — no other files (plus `focus-session-inputs.ts` if Step 19 triggers the mapped extraction).
Test framework: Vitest, node environment, `supertest`. Single file: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`.
Available after: T5 (lifecycle transitions + 409 contract), T4 (factory, repo, serializer), T2 (state machine), T1 (schema, partial unique index).
Architecture rule: NodeNext ESM — relative imports carry `.js`. The transaction lives in the repo, not the route, so the route stays testable with a fake. Never mutate the task itself. Every successful switch calls the injected `recordFocusActivity()` audit seam with `cardId: null` and the namespaced focus payload; it must not write a card/task row, and dedicated `focus_events` remains deferred to issue #107.

[RESTATE: one transaction — finish-old and create-new commit together or not at all.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given Running session on task A with 300 accumulated seconds, When the user confirms a switch to task B 60 seconds later, Then A is Finished with 360 accumulated seconds and a Ready session on B exists at 0 seconds
[derived] Given no active session, When `switch` is requested, Then it behaves as a plain focus — a Ready session on the target, no finish attempted
[derived] Given the target task is the one already focused, When `switch` is requested, Then the existing session is returned unchanged with no write
[must-not] Given a stale `version`, When `switch` is requested, Then the server must NOT finish the old session — respond `409 { code: "version_conflict", session }` with no session on B created; proven against PostgreSQL when `expectedVersion` is stale (integration Case C), not only a fake `switchSession → null`
[must-not] Given any switch, When it is applied, Then it must NOT leave two non-finished sessions for the same `(user_id, workspace_id)` — proven against a real database in the `RUN_INTEGRATION`-gated cycle, since a fake repo cannot observe it
[derived] Given a successful switch, When the route persists B, Then `recordFocusActivity()` is called once with `action: "switch"` and `cardId: null`; rejected and same-task no-op switches must not audit
[derived] Given the target task does not resolve, When `switch` is requested, Then the response is 404, the transaction is never opened, and session A is untouched
[must-not] Given a switch, When the old session is finished, Then the task's own status must NOT change

All tests PASS. Commit exists with message matching `feat(focus): add atomic focus session switch`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Finish + create in a single `db.transaction().execute(...)` inside the repo
- The SQL finish update matches `version = expectedVersion` and returns `null` when it matches no row — proven against PostgreSQL, not only a fake
- The accrual at the switch moment comes from `applyAction(..., "finish", now())`, not from arithmetic in the route
- A successful switch calls the injected `recordFocusActivity()` audit seam; rejected and same-task no-ops do not
- The same-task check is shared with the `focus` branch, not reimplemented
- The response carries the **new** session; `publish` carries the same, called as `publishEvent(workspaceId, event)` — two arguments
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — same-task comparison and Ready-input construction each exist once
- Commit message follows conventional commits format

Must-not-have:
- Two sequential repo calls standing in for a transaction
- Any write to `cards` or `tracker_items`
- a card/task row or a `focus_events` write; the required `recordFocusActivity()` audit call remains namespaced to focus
- A second copy of the return-path or task-key construction from T4

Open question risks:
- Assumption: the client sends the current `version` with `switch`, matching the lifecycle actions. If the confirm dialog cannot supply one, the guard needs rethinking → report NEEDS_CONTEXT rather than dropping the version check.

Rollback note:
- `FOCUS_MODE_ENABLED=false` 404s this action along with the rest of the router, because T4 mounts the flag gate router-level (`router.use(...)`) rather than per-route. A switch in flight at rollback time leaves at most one finished and one ready row — both harmless.

Red flags:
- Work outside the listed files → DONE_WITH_CONCERNS
- Finish and create issued as separate transactions → STOP
- A task-status write → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, all three focus route suites plus `npm run test` are green, commit created
Uncertain when: the client cannot supply `version` on switch
Escalate when: atomicity appears to require `lockWorkspaceMutation` or a schema change
