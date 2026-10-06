# Task T14 — BACKGROUND_JOBS switch

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 14: BACKGROUND_JOBS switch [prereq]

## OBJECTIVE
Add one env switch that pauses schedulers, agent workers, latency reporter and Redis subscribers so the new server can run behind maintenance without side effects.

Steps:
1. First, grep `server/src/index.ts`, `modules/notifications/scheduler.ts`, `core/work-item-latency.ts:50` and `rg "setInterval|subscribe\("` to list every background starter; record the list in the task report.
2. Write failing test for: "BACKGROUND_JOBS=off starts no timers or subscribers"  (the function lives in the new import-safe module `server/src/background-jobs.ts`; importing it must not start the HTTP listener, the pool or Redis)
   Test file: `server/src/background-jobs.test.ts`
   Level: unit
   Test intent: Given `BACKGROUND_JOBS=off` / When the exported `startBackgroundJobs()` (extracted from `index.ts`) runs with fake timers / Then no scheduler, cleanup, latency reporter or Redis subscription is created; with the variable unset or `on`, all are created as today
   Exercise through: `startBackgroundJobs()` imported from `background-jobs.ts`; observation: `vi.getTimerCount()` for timers plus module-boundary spies on the scheduler starter, latency reporter starter and Redis subscribe
   Test doubles: fake timers (`vi.useFakeTimers`), Redis client mocked at the module boundary (`vi.mock("./db/redis.js")`), starters spied via `vi.mock`; do not mock `startBackgroundJobs`
   Expected RED: `startBackgroundJobs` is not exported
3. Run test — verify FAIL: `npm run test --workspace=server -- src/background-jobs.test.ts`
4. Extract the starters into `server/src/background-jobs.ts`, guarded by `process.env.BACKGROUND_JOBS !== "off"`, and call it from `index.ts`. Verify PASS, refactor while green (re-run the same command), run `npm run typecheck --workspace=server`, then commit: `git commit -m "feat(server): add BACKGROUND_JOBS switch"`.
5. Write failing test for: "HTTP and SSE stay active under off"
   Test file: `server/src/background-jobs.test.ts` (second `describe`, source contract)
   Level: unit (source contract)
   Test intent: Given the sources of `index.ts` and `background-jobs.ts` / When read as text / Then `BACKGROUND_JOBS` appears only in `background-jobs.ts`, and `index.ts` still calls `listen` and mounts the SSE routes unconditionally
   Exercise through: `fs.readFileSync`
   Test doubles: none
   Expected RED: none expected after step 4; this is a labeled regression guard (today `index.ts` has no `BACKGROUND_JOBS` reference and already calls `listen` and mounts SSE). Prove it can fail: temporarily add a `BACKGROUND_JOBS` check inside `index.ts` (or wrap `listen` in a condition), confirm RED, then restore
6. Run test — verify the temporary-sabotage RED, then PASS on the restored code (`npm run test --workspace=server -- src/background-jobs.test.ts`), refactor while green (re-run the same command), then commit: `git commit -m "test(server): pin background-jobs gating"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 3; Appendix B.7 (`off` pauses scheduler, agent workers and Redis subscribers; default on)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: touches startup wiring; behavior with the switch unset must be byte-identical to today.

## SANDWICH CONTEXT
[CRITICAL: With the variable unset, startup behavior must be unchanged; with `off`, no background work may start.]
You are implementing the background-jobs switch for the cutover.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: server/src/background-jobs.ts (new), server/src/index.ts, modules/notifications/scheduler.ts, core/work-item-latency.ts (only if needed; if T12 also touches it, whichever merges first wins and the other rebases), new test
Available after: none (independent)
Architecture rule: 300-on-touch; `.js` extensions
[RESTATE: Unset = unchanged; off = nothing starts.]

## DELIVERABLE
Given `BACKGROUND_JOBS=off`, When the server starts, Then no background starter runs
Given unset/on, Then all start as before

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Report lists every starter found
Must-not-have:
  - Redis/SSE topology changes; disabling the HTTP/SSE endpoints
Open question risks:
  - Where the notification scheduler is started was not found by the scan → NEEDS_CONTEXT
Rollback note:
  - Revert commit.
Red flags:
  - Behavior difference with the variable unset → STOP

## STOP CONDITIONS
Done when: both scenarios pass and typecheck green
Uncertain when: a worker starts from a module import side effect
Escalate when: a starter cannot be gated without refactoring
