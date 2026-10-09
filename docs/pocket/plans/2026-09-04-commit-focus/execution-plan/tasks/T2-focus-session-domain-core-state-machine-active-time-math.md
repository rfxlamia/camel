# Task T2 — Focus session domain core — state machine + active-time math

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 2: Focus session domain core — state machine + active-time math [prereq]

## OBJECTIVE

Create the pure domain module that owns focus session state transitions and active-time accounting. This is the single source of truth for "how much active time has this session accrued" and "is this transition legal" — T4 and T5 both import it rather than reimplementing the math in route handlers.

Files:
- Create: `server/src/core/focus-session.ts`
- Test: `server/src/core/focus-session.test.ts`

The module exports, at minimum:
- `type FocusSessionState = "ready" | "running" | "paused" | "finished"`
- `type FocusAction = "start" | "pause" | "resume" | "finish"`
- `type FocusSnapshot = { state: FocusSessionState; accumulatedSeconds: number; runningSince: Date | null }`
- `elapsedSeconds(snapshot: FocusSnapshot, now: Date): number`
- `applyAction(snapshot: FocusSnapshot, action: FocusAction, now: Date): FocusSnapshot`
- an error type for illegal transitions (`InvalidFocusTransitionError extends Error`, setting `this.name` in the constructor)

`.claude/rules/error-handling.md` describes this shape as `WipLimitExceededError`, but no such class exists in the codebase — do not go looking for it. The real precedents are `RetryError` (`server/src/agent/ticket-intake/retry.ts:18`) and `LinearApiError` (`server/src/agent/ticket-intake/linear-client.ts:12`).

**`now` is always an explicit parameter.** This module must never call `Date.now()` or `new Date()`. That is what makes the "waits 10 active minutes" scenarios testable without fake timers.

Steps:

1. Write failing test for: `Given Ready, When Start, Then Running with runningSince set`
   Test file: `server/src/core/focus-session.test.ts`
   Level: unit

   Test intent:
   Independent RED case A: Given a Ready snapshot and fixed base time `T0`, When `applyAction(snapshot, "start", T0)`, Then state is `"running"`, `runningSince` equals `T0`, and `accumulatedSeconds` remains `0`. The pause/accrual case is a separate cycle below.

   Exercise through:
   - the exported `applyAction` function

   Test doubles:
   - none — `now` is passed in as a plain `Date`
   - do NOT mock: the clock, `applyAction`, or `elapsedSeconds`

   Expected RED:
   - `server/src/core/focus-session.ts` does not exist — the import fails to resolve

2. Run test — verify FAIL: `npm run test --workspace=server -- src/core/focus-session.test.ts`
   Expected failure: `Failed to resolve import "./focus-session.js"`

3. Implement minimal code to satisfy RED case A:
   File: `server/src/core/focus-session.ts`
   Implement: the types above plus `applyAction` handling `start` and `pause` only. Accumulate with `Math.round((now.getTime() - runningSince.getTime()) / 1000)`.

4. Run test — verify PASS: `npm run test --workspace=server -- src/core/focus-session.test.ts`

5. Write a separate failing test for: `Given Running 0s, When Pause after 10m, Then Paused 600s`
   Test file: `server/src/core/focus-session.test.ts`
   Level: unit

   Test intent:
   Independent RED case B: Given a Running snapshot with `runningSince: T0` and zero accumulated seconds, When `applyAction(s, "pause", T0 + 600s)`, Then state is `"paused"`, `runningSince` is `null`, and `accumulatedSeconds` is `600`. Resume accrual is a separate cycle below.

   Exercise through: `applyAction`
   Test doubles: none
   Expected RED: `pause` is not yet a handled action — `applyAction` throws or returns the snapshot unchanged

6. Run test — verify FAIL, implement `pause`, then verify PASS: `npm run test --workspace=server -- src/core/focus-session.test.ts`

7. Write a separate failing test for: `Given Paused 600s, When Resume 5m then Pause, Then ~900s`
   Test file: `server/src/core/focus-session.test.ts`
   Level: unit

   Test intent:
   Independent RED case C: Given a Paused snapshot with `accumulatedSeconds: 600`, When `applyAction(s, "resume", T0)` then `applyAction(result, "pause", T0 + 300s)`, Then resume sets Running without accruing and the second action ends Paused at `900` seconds.

   Exercise through: `applyAction`
   Test doubles: none
   Expected RED: `resume` is not yet a handled action.

8. Run test — verify FAIL, implement `resume`, then verify PASS: `npm run test --workspace=server -- src/core/focus-session.test.ts`

8a. Write a separate failing test for: `Given Running, When read mid-flight, Then duration = accumulated + time since runningSince`
    Test file: `server/src/core/focus-session.test.ts`
    Level: unit

    Test intent:
    Independent RED case D: Given Running with `accumulatedSeconds: 1200` and `runningSince: T0`, When `elapsedSeconds(snapshot, T0 + 90s)`, Then it returns `1290`. Use separate test cases for Paused (returns `1200`) and Ready (returns `0`) so neither is hidden in the Running GWT.

    Exercise through: `elapsedSeconds`
    Test doubles: none
    Expected RED: `elapsedSeconds` is not exported yet.

8b. Run test — verify FAIL, implement `elapsedSeconds`, then verify PASS: `npm run test --workspace=server -- src/core/focus-session.test.ts`

9. Write a separate failing test for: `Given Running, When Finish, Then session closes with accrued time`
   Test file: `server/src/core/focus-session.test.ts`
   Level: unit

   Test intent:
   Independent RED case E: Given Running with `accumulatedSeconds: 300` and `runningSince: T0`, When `applyAction(s, "finish", T0 + 120s)`, Then state is `"finished"`, `runningSince` is `null`, and `accumulatedSeconds` is `420`. Paused and Ready finish behavior is covered by separate test cases in the same file.

   Exercise through: `applyAction`
   Test doubles: none
   Expected RED: `finish` is not a handled action

10. Run test — verify FAIL, implement Running `finish`, then verify PASS: `npm run test --workspace=server -- src/core/focus-session.test.ts`

10a. Write, run, and pass separate RED→implementation→PASS cases for finishing Paused without accrual and finishing Ready at zero. Keep these cases independent from the Running finish case.
    Test file: `server/src/core/focus-session.test.ts`
    Level: unit
    Exercise through: `applyAction`, with one independent test case for Paused and one for Ready
    Test doubles: none
    Expected RED: the new `finish` branch does not yet handle each non-running state.

11. Write independent failing test cases for: each illegal transition is rejected
    Test file: `server/src/core/focus-session.test.ts`
    Level: unit

   Test intent:
   Each row below is its own GWT test case with its own RED assertion and PASS assertion: Given the listed state, When the listed illegal action is applied, Then `applyAction` throws `InvalidFocusTransitionError` and the input snapshot is not mutated. Cover at least: `start` from `running`; `start` from `paused` (must use `resume`); `resume` from `ready`; `resume` from `running`; `pause` from `ready`; `pause` from `paused`; and each action from `finished`. A table-driven implementation is fine, but it must preserve one independently reported test case per row.

    Exercise through: `applyAction`
    Test doubles: none
    Expected RED: illegal transitions currently fall through and return a snapshot instead of throwing

12. Run test — verify FAIL for every illegal-transition case, implement the transition table + error, then verify PASS for every case: `npm run test --workspace=server -- src/core/focus-session.test.ts`

13. Refactor while green (bounded):
    - Rule of three: if the "accrue in-flight seconds" computation appears in `pause`, `finish`, and `elapsedSeconds`, extract one private helper inside this module — do NOT create a generic `utils.ts`
    - This file must stay well under ~300 lines and every exported function under ~50
    - Refactor only within `server/src/core/focus-session.ts`
    - Re-run `npm run test --workspace=server -- src/core/focus-session.test.ts` — must stay PASS

14. Commit:
    `git add server/src/core/focus-session.ts server/src/core/focus-session.test.ts`
    `git commit -m "feat(focus): add focus session state machine and active-time math"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Lifecycle, all five GWT scenarios under "Story: Session lifecycle" (Rule 1 active time only, Rule 2 finish preserves task status)
- `server/src/core/position.ts` + `position.test.ts` — the no-I/O, no-clock module convention; `positionBetween` throws (a builtin `RangeError`) on an impossible input
- `server/src/core/wip.ts` — the *other* convention in `core/`: `checkWipLimit` returns `{ allowed, reason }` instead of throwing. This task deliberately picks throwing, because an illegal transition is a client bug rather than an expected outcome. T5 owns mapping `InvalidFocusTransitionError` to an HTTP status
- `server/src/agent/ticket-intake/retry.ts:18`, `server/src/agent/ticket-intake/linear-client.ts:12` — the two real custom `Error` subclasses in this repo
- `server/src/core/work-item-debt.ts` — kebab-case file naming used throughout `server/src/core/`
- `.claude/rules/error-handling.md` — typed business-logic error class shape (`WipLimitExceededError`)

## WHY THIS APPROACH

Complexity: standard
Justification: one file, but it encodes a four-state machine with an accrual invariant and is the shared dependency of two later route tasks. Getting the transition table wrong here surfaces as wrong timer numbers three tasks downstream.

## SANDWICH CONTEXT

[CRITICAL: this module must never read the clock. `now: Date` is a required parameter on every function that needs a time. A single `Date.now()` inside makes the route tests in T4/T5 and the timer tests in T7 unable to assert exact durations.]

You are implementing the focus session domain core for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — server-authoritative timer stored as `accumulated_seconds` + `running_since`; active time only, pauses excluded.
Files in scope: `server/src/core/focus-session.ts`, `server/src/core/focus-session.test.ts` — no other files.
Test framework: Vitest, node environment. Single file: `npm run test --workspace=server -- src/core/focus-session.test.ts`.
Available after: none (prereq). Runs in parallel with T1 and T3.
Architecture rule: **this module** must be pure — no database, no Express, no Redis, no imports from `../routes/` or `../db/`. Note that `server/src/core/` as a directory is not uniformly pure (`allocate-card-identity.ts`, `tracker-vocabulary-seed.ts` and `work-item-debt.ts` import `../db/kysely.js`; `board-card-status-change.ts` also imports `../routes/helpers.js`). Follow `position.ts` and `wip.ts`, not those. Server is NodeNext ESM, so relative imports in the test file carry `.js` (`from "./focus-session.js"`).

[RESTATE: never call `Date.now()` or `new Date()` inside this module — `now: Date` is always passed in.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given Ready session with 0 accumulated seconds, When Start then Pause 10 minutes later, Then accumulated seconds is 600
Given Paused session with 600 accumulated seconds, When Resume then Pause 5 minutes later, Then accumulated seconds is 900
Given Running session with 1200 accumulated seconds and `runningSince` = T0, When duration is read at T0+90s, Then it is 1290
Given Running session with 300 accumulated seconds, When Finish 120s later, Then state is finished and accumulated seconds is 420
[derived] Given Paused session, When duration is read at any later time, Then it does not advance
[derived] Given Ready session, When duration is read, Then it is 0
[must-not] Given a Running session, When `start` is applied, Then the module must NOT silently restart the timer — it must throw `InvalidFocusTransitionError`
[must-not] Given a Finished session, When any action is applied, Then the module must NOT produce a new active state — it must throw

All tests PASS. Commit exists with message matching `feat(focus): add focus session state machine and active-time math`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- `now: Date` is an explicit parameter on `elapsedSeconds` and `applyAction`
- Paused time never accrues — this is the whole point of the feature's "active time only" promise
- Illegal transitions throw a typed error, not a generic `Error`
- Input snapshots are treated as immutable — `applyAction` returns a new object
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — no accrual logic duplicated 3+ times in this file
- Commit message follows conventional commits format

Must-not-have:
- Any import of `../db/`, `../routes/`, `express`, or `kysely`
- `Date.now()` / `new Date()` anywhere in the module
- The `switch` action — that is a route-level transaction concern (T5), not a snapshot transition
- Anything that changes the task's own status (Finish must not complete the task)

Open question risks:
- Assumption: logging out while Running keeps accruing time until Pause/Finish. This module encodes that by simply not knowing about sessions — if the product wants auto-pause on logout, that is a new action here → report NEEDS_CONTEXT rather than inventing one.

Rollback note:
- Pure module, no persistence. Deleting the file is a complete rollback.

Red flags:
- Work outside the two listed files → DONE_WITH_CONCERNS
- A clock read inside the module → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` is green, commit created
Uncertain when: the logout-while-Running assumption proves wrong
Escalate when: the state machine appears to need database access, or a transition cannot be expressed without knowing the task
