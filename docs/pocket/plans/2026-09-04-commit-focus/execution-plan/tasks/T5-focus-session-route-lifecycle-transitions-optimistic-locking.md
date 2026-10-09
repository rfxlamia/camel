# Task T5 — Focus session route — lifecycle transitions + optimistic locking

**Phase:** 2
**Depends:** T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: Focus session route — lifecycle transitions + optimistic locking [depends: T4]

## OBJECTIVE

Add `PATCH /workspaces/:workspaceId/focus-session` with actions `start`, `pause`, `resume`, `finish`, delegating all time math and transition legality to `core/focus-session.ts`, and returning HTTP 409 on a stale `version`.

Files:
- Modify: `server/src/routes/focus-session.ts`
- Test: `server/src/routes/focus-session.lifecycle.test.ts`

A new test file, not an edit to `focus-session.test.ts` — T4's suite stays as the read/create contract, this one is the lifecycle contract.

The handler is thin by construction: load the active session → `applyAction(snapshot, action, now())` → `repo.update(id, patch, expectedVersion)` → publish → serialize. Anything that looks like duration arithmetic in this file belongs in `core/focus-session.ts` instead.

Steps:

1. Write failing test for: `Given Ready, When Start, Then Running with runningSince set`
   Test file: `server/src/routes/focus-session.lifecycle.test.ts`
   Level: unit

   Test intent:
   Given a Ready session (`accumulated_seconds: 0`, `running_since: null`, `version: 1`) and an injected clock fixed at `T0`
   When `PATCH /workspaces/3/focus-session` with `{ action: "start", version: 1 }`
   Then:
   - the response is `200`, `body.session.state` is `"running"`, `runningSince` is `T0` as ISO, `accumulatedSeconds` is still `0`
   - `repo.update` was called with `expectedVersion: 1`
   - `publish` was called once as **two arguments** — `publishEvent(workspaceId, event)` is the real signature (`server/src/realtime.ts:408`), so the assertion is `expect(publish).toHaveBeenCalledWith(3, { type: "focus_session.updated", userId, workspaceId, payload: { session } })`, never a single object
   - the injected `recordFocusActivity()` audit spy was called once with `cardId: null` and `{ kind: "focus_session", action: "start", sessionId, workspaceId, userId }`

   Exercise through:
   - HTTP `PATCH`, via `supertest` against a router built with `createFocusSessionRouter({ repo: fakeRepo, now: () => T0, publish: vi.fn(), recordFocusActivity: vi.fn() })`

   Reuse T4's app builder shape: `express.json()` plus a middleware that sets **both** `req.user` and `req.workspace`. `work-items.test.ts` sets only `req.workspace`, and every `userId` assertion below reads `req.user!.id`.

   Test doubles:
   - fake `FocusSessionRepo`, injected fixed clock, `vi.fn()` publisher, injected `recordFocusActivity()` audit spy
   - mock `../config.js` with `FOCUS_MODE_ENABLED: "true"` and `../middleware/workspace.js` pass-through
   - do NOT mock: `core/focus-session.ts` — its state machine is exactly what this route is supposed to be delegating to

   Expected RED:
   - `PATCH` is not routed — Express returns 404 and `repo.update` is never called

2. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
   Expected failure: `expected 404 to be 200`

3. Implement minimal code to satisfy the test:
   File: `server/src/routes/focus-session.ts` — add the `PATCH` handler reusing T4's active-session helper, handling `start` only, and calling the injected `recordFocusActivity()` audit seam on the successful mutation.

4. Run test — verify PASS: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`

5. Write failing test for: `Given Running, When Pause after 10m, Then Paused with ~600 accumulated seconds`
   Test file: `server/src/routes/focus-session.lifecycle.test.ts`
   Level: unit

   Test intent:
   Given a preloaded Running session with `running_since: T0`, `accumulated_seconds: 0`, and a clock at `T0 + 600s`
   When `PATCH { action: "pause", version: N }` is issued as the only mutation in this test
   Then `body.session.state` is `"paused"`, `accumulatedSeconds` is `600`, `runningSince` is `null`, and `recordFocusActivity()` is called once with `action: "pause"`
   The clock is a mutable `let clockNow: Date` closed over by the injected `now: () => clockNow`, advanced between requests. No fake timers — the server never reads a real clock.

   Exercise through: HTTP `PATCH`
   Test doubles: fake repo (its `update` returns the merged row so the second request sees the first one's result), injected advancing clock, `vi.fn()` publisher, injected `recordFocusActivity()` audit spy
   Expected RED: `pause` is unhandled — the response is a 4xx or the session comes back unchanged

6. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
   Expected failure: the pause request is unhandled.

7. Implement `pause` by delegating to `applyAction` and calling `recordFocusActivity()` with `action: "pause"`, then verify PASS: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.

8. Write a separate failing test for: `Given Paused 600s, When Resume 5m then Pause, Then ~900s`
    Test file: `server/src/routes/focus-session.lifecycle.test.ts`
    Level: unit

    Test intent:
    Given a Paused session with `accumulated_seconds: 600`, When `resume` at `T1` then `pause` at `T1 + 300s`, Then `accumulatedSeconds` is `900` and `runningSince` is `null`. Each successful mutation calls `recordFocusActivity()` (`action: "resume"` then `action: "pause"`).

    Exercise through: HTTP `PATCH`
    Test doubles: the advancing injected clock, fake repo, publisher spy, and `recordFocusActivity()` audit spy from the prior cycle
    Expected RED: `resume` is still unhandled.

9. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
    Expected failure: the resume request is unhandled or does not accrue the second interval.

10. Implement `resume` by delegating to `applyAction` and calling `recordFocusActivity()` with `action: "resume"`, then verify PASS: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.

11. Write failing test for: `Given Running on task T, When Finish focus, Then session ends and task status is unchanged`
   Test file: `server/src/routes/focus-session.lifecycle.test.ts`
   Level: unit

   Test intent:
   Given a Running session with `accumulated_seconds: 300`, `running_since: T0`, and a clock at `T0 + 120s`
   When `PATCH { action: "finish", version: N }`
   Then:
   - `repo.update` receives `state: "finished"`, `accumulated_seconds: 420`, `running_since: null`, and `finished_at` set from the clock
   - the response is `200` and `body.session.state` is `"finished"` — the client uses `returnPath` from this payload to navigate back
   - `publish` was called with `payload: { session: null }` — **not** the finished session. The Shared Contract makes `null` the signal that no session is active; publishing the finished row instead would have every other tab's provider adopt it as its current session, contradicting the rule the client relies on. The HTTP response still carries the finished session so the acting tab can read `returnPath` off it
   - **no task-mutating repo method exists or is called** — finishing focus must not touch the card's or tracker item's status

   Exercise through: HTTP `PATCH`
   Test doubles: fake repo, injected clock, `vi.fn()` publisher, and injected `recordFocusActivity()` audit spy
   Expected RED: `finish` is unhandled

12. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
    Expected failure: `finish` is unhandled.

13. Implement `finish`, then verify PASS: accrue through `applyAction`, persist `finished`, publish `payload.session: null`, call `recordFocusActivity()` exactly once with the namespaced focus payload, and assert that no card/task row is touched. Run `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.

14. Write failing test for: `Given stale version, When mutation, Then HTTP 409 and the client can refresh`
   Test file: `server/src/routes/focus-session.lifecycle.test.ts`
   Level: unit

   Test intent:
   Given the stored session is at `version: 4` and `repo.update` returns `null` for `expectedVersion: 3` (the guard matched no row)
   When `PATCH { action: "resume", version: 3 }`
   Then:
   - the response status is `409`, never 500
   - the body is `{ code: "version_conflict", session }` where `session` is the **current** server state at version 4, so the losing tab can reconcile without a second round trip
   - `publish` was NOT called — a rejected write changed nothing

   Exercise through: HTTP `PATCH`
   Test doubles: fake repo returning `null` from `update`, then resolving the current row from `findActive`; injected clock; `vi.fn()` publisher
   Expected RED: a failed update currently throws or returns 500, and no session is echoed back

15. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
    Expected failure: a failed update throws or returns 500 without the current session.

16. Implement the `version_conflict` branch, then verify PASS: return the current active session with 409 and do not publish. Run `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.

17. Write a separate failing test for: an illegal transition is refused without corrupting state
    Test file: `server/src/routes/focus-session.lifecycle.test.ts`
    Level: unit

   Test intent:
   Independent RED case A: Given a Running session at the correct `version`, When `PATCH { action: "start", version: N }` is sent, Then `InvalidFocusTransitionError` becomes `409 { code: "invalid_transition", session }`, never 500, and neither `repo.update` nor `publish` is called. Unknown-action validation is a separate cycle below.

    Exercise through: HTTP `PATCH`
    Test doubles: fake repo, injected clock, `vi.fn()` publisher. Do NOT mock the core module — the thrown error is the thing being translated
    Expected RED: the error escapes the handler as an unhandled rejection or a 500

18. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
    Expected failure: the error escapes or becomes a 500.

19. Implement the invalid-transition translation, then verify PASS: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.

19a. Write/run a separate RED→implementation→PASS cycle for an unknown `action`: Given a valid active session, When `PATCH` carries an unsupported action, Then the response is `400`, with no update or publish. This is input validation, not a state conflict.
    Test file: `server/src/routes/focus-session.lifecycle.test.ts`
    Level: unit
    Exercise through: HTTP `PATCH` against the route
    Test doubles: fake repo, fixed clock, flag-on config, pass-through membership middleware, and publisher spy
    Expected RED: unsupported actions are currently passed to the core or become a 500 instead of a 400.
    Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`

20. Refactor while green (bounded):
    - Rule of three: `load session → apply → update → publish → serialize` now runs for four actions. It must exist once as a single parameterized path, not four copy-pasted blocks
    - If `focus-session.ts` approaches ~300 lines, extract the serializer and the error translation into the mapped `server/src/routes/focus-session-serialize.ts`
    - Refactor only within `server/src/routes/focus-session.ts` (plus that extraction if it happens)
    - Re-run both `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts` and `npm run test --workspace=server -- src/routes/focus-session.test.ts` — both must stay PASS

21. Commit:
    `git add server/src/routes/focus-session.ts server/src/routes/focus-session.lifecycle.test.ts`
    If Step 20 extracted `server/src/routes/focus-session-serialize.ts`, additionally run `git add server/src/routes/focus-session-serialize.ts` before committing.
    `git commit -m "feat(focus): add focus session lifecycle transitions with optimistic locking"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Lifecycle (all five `✓` criteria plus the `✗` Start-failure criterion); rule: Concurrency (`✗ Given stale version, When mutation, Then HTTP 409 and client refreshes`); "Story: Session lifecycle" Rule 2 (Finish does not complete the task)
- `.claude/rules/error-handling.md` — 409 for conflicts (optimistic locking), 400 for malformed input, 500 only for the unexpected
- `server/src/core/focus-session.ts` (T2) — `applyAction(snapshot, action, now)` and `InvalidFocusTransitionError`
- `server/src/routes/focus-session.ts` (T4) — the factory, repo interface, active-session helper, and serializer this task extends
- `server/src/routes/work-items.test.ts` — route-test harness
- `server/src/routes/cards.ts` — existing optimistic-locking 409 precedent on `version`

## WHY THIS APPROACH

Complexity: standard
Justification: two files, but four actions × three outcomes (success, stale version, illegal transition) is real branching, and the 409 body contract is what the client's conflict recovery in T7 depends on.

## SANDWICH CONTEXT

[CRITICAL: no duration arithmetic in this file. Every transition goes through `applyAction(snapshot, action, now())` from `server/src/core/focus-session.ts`. A second implementation of the accrual rule here will drift from the one T2 tested, and the two will disagree about how much time a user worked.]

You are implementing the focus session lifecycle transitions for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — server-authoritative active time (`accumulated_seconds` + `running_since`), optimistic locking on `version`, SSE fan-out to other tabs.
Files in scope: `server/src/routes/focus-session.ts`, `server/src/routes/focus-session.lifecycle.test.ts` — no other files (plus a serializer extraction if Step 13 triggers one).
Test framework: Vitest, node environment, `supertest`. Single file: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.
Available after: T4 (router factory, repo, serializer, SSE event type), T2 (state machine), T1 (schema), T3 (flag).
Architecture rule: NodeNext ESM — relative imports carry `.js`. A stale write returns 409, never 500. Finishing focus must never mutate the task's status. Every lifecycle mutation calls the injected `recordFocusActivity()` audit seam with `cardId: null` and the namespaced focus payload; it must not write a card/task row, and dedicated `focus_events` remains deferred to issue #107.

[RESTATE: all time math goes through `core/focus-session.ts` — this file computes no durations of its own.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given Ready session with 0 accumulated seconds, When Start then Pause 10 minutes later, Then `accumulatedSeconds` is 600 and the timer is stopped
Given Paused session with 600 accumulated seconds, When Resume then Pause 5 minutes later, Then `accumulatedSeconds` is 900
Given Running session on a task in "In Progress", When Finish focus, Then the session ends and no task-status write occurs
[derived] Given a Finish, When the SSE event is published, Then `payload.session` is `null`, matching the Shared Contract that other tabs' providers depend on
Given a session at version 4, When a mutation arrives with version 3, Then the response is `409 { code: "version_conflict", session }` carrying the current version-4 session
[derived] Given Ready session, When Start, Then `runningSince` is set to the request time and `accumulatedSeconds` stays 0
[must-not] Given a Running session, When `start` is requested, Then the timer must NOT restart — respond `409 { code: "invalid_transition", session }` with no write
[must-not] Given a stale-version request, When it is rejected, Then the server must NOT publish an SSE event — nothing changed
[must-not] Given any lifecycle action, When it succeeds, Then the handler must NOT write to `cards` or `tracker_items`
[derived] Given a `PATCH` body with an unrecognized `action`, Then the response is 400

All tests PASS. Commit exists with message matching `feat(focus): add focus session lifecycle transitions with optimistic locking`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- All four actions share one parameterized path, not four copy-pasted handlers
- 409 responses carry the current session so the losing tab reconciles in one round trip
- Every successful mutation publishes `focus_session.updated` with `userId`, called as `publishEvent(workspaceId, event)` — two arguments
- Every successful `start` / `pause` / `resume` / `finish` calls the injected `recordFocusActivity()` audit seam
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — the load/apply/update/publish/serialize path exists once
- Commit message follows conventional commits format

Must-not-have:
- Duration arithmetic outside `core/focus-session.ts`
- A `new Date()` or `Date.now()` in any handler — use the injected `now()`
- The `switch` action — T6 owns it
- Any write to `cards`, `tracker_items`, `settings`, or `workspace_settings`
- a card/task row or a `focus_events` write; the required `recordFocusActivity()` audit call remains namespaced to focus
- 500 responses for a stale version or an illegal transition

Open question risks:
- Assumption: an illegal transition is a 409 (`invalid_transition`), on the reasoning that it conflicts with current server state and the client recovers the same way it does from a version conflict. If a 400 is preferred, only the status code changes → note it, do not block.
- Assumption: logout while Running keeps accruing. Nothing here auto-pauses; if that assumption breaks, a new action is needed → report NEEDS_CONTEXT.

Rollback note:
- With `FOCUS_MODE_ENABLED=false`, `PATCH` 404s along with the rest of the router. T4 mounts both the flag gate and the membership check router-level (`router.use(...)`), so a verb added here is gated the moment it is routed — no per-route wiring needed. Confirm this by reading the top of `focus-session.ts` before adding `PATCH`; if either gate turns out to be per-route, fix that first.

Red flags:
- Work outside the listed files → DONE_WITH_CONCERNS
- Duration math written in the route → STOP
- A task-status write on Finish → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, both focus route suites and `npm run test` are green, commit created
Uncertain when: the 409-for-illegal-transition choice is disputed, or the logout-while-Running assumption breaks
Escalate when: satisfying a scenario appears to require mutating the task, or duplicating the accrual rule in the route
