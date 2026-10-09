# Task T4 — Focus session route — read + create

**Phase:** 2
**Depends:** T1, T2, T3, T15
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 4: Focus session route — read + create [depends: T1, T2, T3, T15]

## OBJECTIVE

Create the focus session HTTP surface for reading the current session and committing to a task: `GET` and `POST` with action `focus`. Establish the router factory, the data-access seam, the serializer, and the SSE event type that T5 and T6 then extend.

Files:
- Create: `server/src/routes/focus-session.ts`
- Create: `server/src/routes/focus-session-repo.ts`
- Modify: `server/src/routes.ts`
- Modify: `server/src/realtime.ts`
- Test: `server/src/routes/focus-session.test.ts`

**Structure — build it this way, T5 and T6 depend on it:**

`focus-session-repo.ts` exports `type FocusSessionRepo` and `createFocusSessionRepo(db)`. The interface is the only place Kysely appears:
- `findActive(userId, workspaceId): Promise<FocusSessionRow | null>` — the row where `state <> 'finished'`
- `insert(input): Promise<FocusSessionRow>`
- `update(id, patch, expectedVersion): Promise<FocusSessionRow | null>` — returns `null` when the version guard matched no row
- `findTask(source, taskId, workspaceId): Promise<{ id: number; keyNumber: number | null; title: string; workspaceName: string } | null>` — resolves a board card (`cards`, `deleted_at IS NULL`) or a tracker item (`tracker_items`, `deleted_at IS NULL`) scoped to the workspace, joining `workspaces.name` in the same query

  The display key is **not** stored. It is `formatKey(derivePrefix(workspaceName), keyNumber)` — both exported and pure from `server/src/core/tracker-key.ts`. Import them into `focus-session.ts`; do not re-derive the prefix and do not copy `getWorkspacePrefix` (it is module-private in `tracker-items.ts`). `derivePrefix` yields **1-2 characters** (`KEY_PATTERN = /^([A-Z?]{1,2})-(\d+)$/`), so every fixture in this task uses a 2-character key such as `CA-42` — a 3-character key like `CAM-42` cannot be produced and would fail `parseKeyFromUrl` on the client's `tracker/:key` route. Board cards may have `key_number NULL`; their return path uses the card id, so `task_key` is nullable for `source: "board"`.

This repo must stay logic-free — queries and row mapping only. Every decision lives in the route or in `core/focus-session.ts`, both of which are tested.

`focus-session.ts` exports `createFocusSessionRouter(deps)` plus a default `focusSessionRouter` built from the real repo:

```ts
type FocusAuditAction =
  | "focus" | "switch" | "start" | "pause" | "resume" | "finish" | "auto_finish";

type RecordFocusActivity = (input: {
  actor: AuthUser;
  workspaceId: number;
  sessionId: number;
  action: FocusAuditAction;
}) => Promise<void>;

createFocusSessionRouter(deps: {
  repo: FocusSessionRepo;
  now?: () => Date;
  publish?: typeof publishEvent;
  recordFocusActivity?: RecordFocusActivity;
})
```

The audit seam is this **narrow domain type**, not `typeof recordActivity`. The raw helper's signature is `recordActivity(dbExec, actor, workspaceId, eventType, opts)` — passing it directly would force a Kysely executor into the handler, contradicting "Kysely appears only in the repo", and its `eventType` union has no focus member. The default implementation lives in one place at the bottom of `focus-session.ts` and is the only thing that touches `db`:

```ts
const defaultRecordFocusActivity: RecordFocusActivity = ({ actor, workspaceId, sessionId, action }) =>
  recordActivity(db, actor, workspaceId, "focus_session", {
    cardId: null,
    payload: { kind: "focus_session", action, sessionId, workspaceId, userId: actor.id },
  });
```

`"focus_session"` is a real member of the `recordActivity` event-type union and is excluded from the workspace activity feed — both are delivered by **T15, which must be complete before this task starts**. Do not use `"update"`: it is indistinguishable from a card edit and would render in every member's feed. Tests construct their own router with a fake repo, a fixed clock, a publisher spy, and a `vi.fn()` audit spy — they never mock Kysely, and they assert against the narrow input object, not the five-argument helper.

Steps:

1. Write the first independent failing test for: `Given no session, When GET, Then null`
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit

   Test intent:
   Independent RED case A: Given a router built with a repo whose `findActive` resolves `null`, When `GET /workspaces/3/focus-session` is requested by a member, Then the response is `200 { session: null }`. This case has no feature-gate or membership assertion; those are separate RED cycles below.

   Exercise through:
   - HTTP, via `supertest` against `express().use("/workspaces/:workspaceId", createFocusSessionRouter({ repo: fakeRepo, now, publish }))`, following the harness in `server/src/routes/work-items.test.ts`

   **Harness gap — read before copying `work-items.test.ts`.** Its `createApp` injects `req.workspace` but never `req.user`. Every focus assertion about `userId` reads `req.user!.id`, and the real `requireWorkspaceMember` reads it too, so the suite crashes before asserting anything. The app builder in this file needs both, plus a JSON body parser for the `POST`/`PATCH` cycles:
   ```ts
   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
     req.user = { id: 7, username: "ana", display_name: "Ana" } as AuthUser;
     req.workspace = { workspaceId: 3, role: "member" };
     next();
   });
   app.use("/workspaces/:workspaceId", router);
   ```
   In production `requireAuth` is applied once on the parent `api` router (`server/src/routes.ts:42`), so the focus router never mounts it itself. `req.user` is typed `AuthUser` (`server/src/auth.js`) and is what `defaultRecordFocusActivity` forwards to `recordActivity` as its `actor` — read the real `AuthUser` shape before writing the fixture rather than casting a guess, so the seam does not typecheck in the test and fail in production.

   Test doubles:
   - fake `FocusSessionRepo` — a plain object of `vi.fn()`s
   - mock `../config.js` to flip `FOCUS_MODE_ENABLED`
   - mock `../middleware/workspace.js` `requireWorkspaceMember` as a pass-through for this member case
   - injected `publish: vi.fn()` and `now: () => FIXED_DATE`
   - do NOT mock: the router, the serializer, or `core/focus-session.ts`

   Expected RED:
   - `server/src/routes/focus-session.ts` does not exist — the import fails to resolve

2. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
   Expected failure: `Failed to resolve import "./focus-session.js"`

3. Implement minimal code to satisfy RED case A:
   File: `server/src/routes/focus-session-repo.ts` — the interface and the Kysely implementation.
   File: `server/src/routes/focus-session.ts` — the factory, a `Router({ mergeParams: true })` instance, and `GET` returning `{ session: null }`.

   **Both gates are mounted router-level, not per-route:**
   ```ts
   const router = Router({ mergeParams: true });
   router.use(requireFocusModeEnabled);   // 404 when FOCUS_MODE_ENABLED !== "true"
   router.use(requireWorkspaceMember);    // 404 for non-members
   ```
   This is load-bearing for T5 and T6, whose rollback notes both say the flag 404 is "inherited from T4's guard". A per-route gate on `GET` alone ships `POST` and `PATCH` ungated and makes the Rollback Plan's first step silently fail. Router-level `.use()` covers every verb by construction, including verbs T5 and T6 have not added yet.

4. Run test — verify PASS: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

4a. Write/run a separate RED→implementation→PASS cycle for the non-member gate: with a 404-responding `requireWorkspaceMember` stub, `GET` returns exactly `404 { error: "Not found" }`. The test uses the actual `express().use("/workspaces/:workspaceId", router)` mount and fails until the middleware is mounted on the GET route.
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit (HTTP route)
   Exercise through: `supertest` against the actual workspace parent mount
   Test doubles: 404 `requireWorkspaceMember` stub, fake repo, fixed clock, flag-on config, and publisher spy
   Expected RED: the middleware is absent from the GET route and the request reaches the handler.
   Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

4b. Write/run a separate RED→implementation→PASS cycle for the disabled-feature gate: with `FOCUS_MODE_ENABLED=false` and membership allowed, `GET` returns exactly `404 { error: "Not found" }`. Keep this as an independent test case.
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit (HTTP route)
   Exercise through: `supertest` against the same workspace parent mount
   Test doubles: pass-through membership stub, flag-off config, fake repo, fixed clock, and publisher spy
   Expected RED: the route currently returns the no-session 200 response instead of the feature-off 404.
   Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

5. Write failing test for: `Given Running session, When GET, Then state and duration restored from server`
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit

   Test intent:
   Given `findActive` resolves a row `{ state: "running", accumulated_seconds: 1200, running_since: T0, version: 4, task_source: "board", task_id: 481, task_key: "CA-42", return_path: "/board/card/481" }` and `findTask` resolves that card
   When `GET /workspaces/3/focus-session` is requested with the injected clock at `T0 + 90s`
   Then the response is `200` and `body.session` matches the Shared Contract DTO exactly: camelCase keys, `state: "running"`, `accumulatedSeconds: 1200`, `runningSince` as an ISO string, `version: 4`, `source: "board"`, `taskId: 481`, `taskKey: "CA-42"`, `returnPath: "/board/card/481"`, `finishedAt: null`

   Note: the response carries the **stored** `accumulatedSeconds` plus `runningSince`. It does not pre-compute the live total — the client derives that. This keeps one authority for the number and lets the client tick between polls.

   Exercise through: HTTP `GET`
   Test doubles: fake repo, fixed clock, `vi.fn()` publisher
   Expected RED: `GET` currently always returns `{ session: null }`

6. Run test — verify FAIL, implement the serializer + the `findActive` branch, verify PASS: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

7. Write failing test for: `Given board card C, When "Focus on this task", Then Ready session persisted with {source: "board", id: C.id}`
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit

   Test intent:
   Given no active session and `findTask` resolving the target
   When `POST /workspaces/3/focus-session` with `{ action: "focus", source: "board", taskId: 481 }`
   Then:
   - the response is `201` and `body.session.state` is `"ready"` with `accumulatedSeconds: 0`, `runningSince: null`, `version: 1`
   - `repo.insert` was called with `return_path: "/board/card/481"` and `task_key` taken from the resolved task
   - `publish` was called once as **two arguments** — `publishEvent(workspaceId, event)` is the real signature (`server/src/realtime.ts:408`), so the assertion is `expect(publish).toHaveBeenCalledWith(3, { type: "focus_session.updated", userId, workspaceId, payload: { session } })`, never a single object. `userId` must be present, because the client's privacy filter depends on it
   Exercise through: HTTP `POST`
   Test doubles: fake repo, fixed clock, `vi.fn()` publisher, and injected `recordFocusActivity()` audit spy. Do NOT mock the return-path construction — that is the behavior under test
   Expected RED: `POST` is not routed yet — 404 from Express itself, with `insert` never called

8. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
   Expected failure: `POST` is not routed and Express returns 404.

9. Implement the minimal no-active board focus branch, then verify PASS: add the `POST` route, resolve the board task by source and id, insert the Ready row, serialize it, publish the exact event shape, and call the injected `recordFocusActivity()` audit seam once with the namespaced focus payload. Assert that no card/task row is written. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts` — expected PASS for the board case.

10. Write a separate failing test for: `Given tracker item T, When "Focus on this task", Then Ready session preserves tracker identity and return path`
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit

    Test intent:
    Given no active session and `findTask` resolving tracker item `CA-42`
    When `POST /workspaces/3/focus-session` has `{ action: "focus", source: "tracker", taskId: 77 }`
    Then the response is `201`, `source` is `"tracker"`, `taskId` is `77`, and `returnPath` is `/tracker/CA-42`; `repo.insert` receives the tracker task key.

    Exercise through: HTTP `POST`
    Test doubles: fake repo, fixed clock, `vi.fn()` publisher
    Expected RED: the board-only implementation does not yet branch to the tracker task lookup.

11. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: the tracker request is rejected or resolves the wrong return path.

12. Implement the source-specific tracker branch, then verify PASS: reuse the same no-active path, branch `findTask` on `source`, and construct `/tracker/<taskKey>` without a key-number-only lookup. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts` — expected PASS.

13. Write a separate failing test for: `Given a task id that resolves in no table for this workspace, When focus is requested, Then 404 and no insert`
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit

    Test intent:
    Given no active session and `findTask` resolves `null`
    When the focus POST is requested
    Then the response is `404 { error: "Not found" }`, `repo.insert` is not called, and `publish` is not called.

    Exercise through: HTTP `POST`
    Test doubles: fake repo, fixed clock, `vi.fn()` publisher
    Expected RED: the route currently attempts to insert without a resolvable task.

14. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: the route returns success or reaches `repo.insert`.

15. Implement the missing-task 404 branch, then verify PASS: reject a null `findTask` result before building the insert. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts` — expected PASS.

16. Write a separate failing test for: `Given the user previously finished task T, When focus is requested again, Then a new Ready session starts at zero`
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit

    Test intent:
    Given `findActive` resolves `null` because the old row is finished and `findTask` resolves the same task
    When focus is requested
    Then a new row is inserted with `state: "ready"`, `accumulatedSeconds: 0`, and `version: 1`; the finished row is never revived.

    Exercise through: HTTP `POST`
    Test doubles: fake repo whose `findActive` explicitly models the partial-index query, fixed clock, `vi.fn()` publisher
    Expected RED: the finished-session path is not yet asserted and may incorrectly reuse the old row.

17. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: the new-row assertion fails or the old finished row is returned.

18. Verify the finished-row behavior PASS: keep `findActive` limited to `state <> 'finished'`, insert a fresh Ready row, and run `npm run test --workspace=server -- src/routes/focus-session.test.ts`.

19. Write failing test for: `Given Ready session on task T, When focus on T again, Then session remains Ready` (idempotent re-focus)
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit

   Test intent:
   Given `findActive` resolves an existing session on `{ source: "board", task_id: 481 }` in any non-finished state
   When `POST` with `{ action: "focus", source: "board", taskId: 481 }`
   Then:
   - the response is `201` carrying the existing session unchanged — same `id`, same `version`, same `state`, same `accumulatedSeconds`
   - `repo.insert` was NOT called — re-focusing must never reset a running timer to zero
   - `publish` was NOT called — nothing changed, so no tab should be told anything did

   Exercise through: HTTP `POST`
   Test doubles: fake repo, fixed clock, `vi.fn()` publisher
   Expected RED: the handler inserts unconditionally, so `insert` is called and a fresh `version: 1` session comes back

20. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: the handler inserts a fresh row and publishes an event.

21. Implement the idempotent branch, then verify PASS: compare `(source, taskId)`, return the existing active session unchanged, and do not insert or publish. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts`.

22. Write failing test for: focusing a **different** task while a session is active is refused
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit

    Test intent:
    Given `findActive` resolves an active session on task A
    When `POST` with `{ action: "focus", source: "board", taskId: <B, different from A> }`
    Then:
    - the response is `409 { code: "session_active", session: <session on A> }`
    - `repo.insert` was NOT called and session A is untouched

    This is what makes the client's confirm-then-switch dialog possible: the plain `focus` action can never silently discard an in-flight session. Replacing it requires the explicit `switch` action (T6).

    Exercise through: HTTP `POST`
    Test doubles: fake repo, fixed clock, `vi.fn()` publisher
    Expected RED: the handler treats any active session as a re-focus, or inserts a second one

23. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: the handler treats any active session as a re-focus or inserts a second one.

24. Implement the conflict branch, then verify PASS: return `409 { code: "session_active", session }` without changing session A. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts`.

24a. Write/run a separate RED→implementation→PASS cycle for `POST` body validation: Given a member with the flag on, When the body carries an unrecognized `action`, a `source` outside `"board" | "tracker"`, or a non-integer `taskId`, Then the response is `400` with no `findTask`, `insert`, or `publish` call. Without this the bad `source` reaches the insert and trips the `task_source` CHECK constraint, surfacing as a 500 — the status code `.claude/rules/error-handling.md` reserves for the unexpected. T5 Step 19a is the `PATCH` counterpart; this is the `POST` one.
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit (HTTP route)
    Exercise through: `supertest` `POST` against the workspace parent mount
    Test doubles: fake repo, fixed clock, flag-on config, pass-through membership stub, publisher spy
    Expected RED: the handler destructures the body without validating it and proceeds to the task lookup.
    Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

25. Write failing test for: `Given active session on task T, When T no longer resolves, Then session auto-finishes on read`
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit

    Test intent:
    Given `findActive` resolves an active session and `findTask` resolves `null` (the task was soft-deleted, or the user lost access, while nobody was watching)
    When `GET /workspaces/3/focus-session` is requested
   Then:
   - `repo.update` was called finishing that session — `state: "finished"`, `finished_at` set from the injected clock, `running_since` cleared, in-flight time accrued via `core/focus-session.ts` `applyAction(..., "finish", now)`
   - the response is `200 { session: null, autoFinished: { reason: "task_missing", taskKey: "CA-42" } }`
   - `publish` was called so any other open tab drops the session too
   - the injected `recordFocusActivity()` audit seam was called once with `action: "auto_finish"` and the session/workspace/user identifiers; no card/task row was written

    Exercise through: HTTP `GET`
    Test doubles: fake repo, fixed clock, `vi.fn()` publisher. Do NOT mock `core/focus-session.ts` — the accrual on auto-finish is part of what this proves
    Expected RED: `GET` returns the session as-is with no `autoFinished` field and never calls `update`

26. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: `GET` returns the active session unchanged and never calls `repo.update`.

27. Implement the auto-finish-on-read branch, then verify PASS: apply `finish` through `core/focus-session.ts` with the injected clock, update atomically, publish `payload.session: null`, and return the `autoFinished` response. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts`.

27a. Write/run a separate RED→implementation→PASS cycle for the auto-finish losing its version guard: Given `findActive` resolves an active session, `findTask` resolves `null`, and `repo.update` resolves `null` (a second tab polled `GET` concurrently and finished the row first), When `GET` is requested, Then the response is `200 { session: null }`, `publish` is NOT called, and `recordFocusActivity()` is NOT called — never a 500, never a serialization of `null`. Two tabs polling the same dead task is the ordinary case, not a rare race.
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit (HTTP route)
    Exercise through: `supertest` `GET`
    Test doubles: fake repo whose `update` resolves `null`, fixed clock, publisher spy, `recordFocusActivity()` spy
    Expected RED: the handler passes the `null` update result to the serializer and throws, producing a 500.
    Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

28. Register and wire up:
    - `server/src/realtime.ts` — add `"focus_session.updated"` to the `BoardEvent["type"]` union. Reuse the existing `payload?: Record<string, unknown>` field for the session; do not add a bespoke top-level field
    - `server/src/routes.ts` — import `focusSessionRouter` from `./routes/focus-session.js` and mount `api.use("/workspaces/:workspaceId", focusSessionRouter)` beside the other workspace-scoped routers
    - Verify the router is `Router({ mergeParams: true })` (also specified in Step 3) and the mounting test uses the actual `/workspaces/:workspaceId` parent so `requireWorkspaceMember` reads the inherited `workspaceId`; then run `npm run test` and `npm run typecheck --workspace=server`

29. Refactor while green (bounded):
    - Rule of three: the "load active session, 404 if none" preamble will appear again in T5 and T6 — extract it now as a named helper inside `focus-session.ts` (e.g. `loadActiveSessionOr404`), not a generic `utils.ts`
    - Keep `focus-session.ts` under ~300 lines and every handler under ~50; if the serializer grows, move it to a named `serializeFocusSession` function in the same file
    - Refactor only within `focus-session.ts` and `focus-session-repo.ts`
    - Re-run `npm run test --workspace=server -- src/routes/focus-session.test.ts` — must stay PASS

30. Commit:
    `git add server/src/routes/focus-session.ts server/src/routes/focus-session-repo.ts server/src/routes/focus-session.test.ts server/src/routes.ts server/src/realtime.ts`
    `git commit -m "feat(focus): add focus session read and create endpoints"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Focus entry (all four criteria including the `✗` non-member 404); "Story: Focus on a task" Rule 1 and Rule 2; Implementation Notes on `return_path`, idempotent re-focus, and never resolving a task by `key_number` alone
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — why `findTask` must branch on `source` and query `cards` or `tracker_items` explicitly
- `server/src/routes/work-items.test.ts` — the `express()` + `supertest` + `vi.mock` route-test harness this task reuses
- `server/src/routes/helpers.ts` — `createScopedBoardService` / `createWorkspaceAccessService` establish the dependency-injected factory convention
- `server/src/routes/tracker-projects.ts` — router file layout: column tuples, row types, `serializeX` functions, `publishEvent` usage
- `server/src/middleware/workspace.ts` — `requireWorkspaceMember` returns 404 (not 403) for non-members
- `server/src/realtime.ts` — `BoardEvent` union and `publishEvent` signature
- `server/src/core/focus-session.ts` (from T2) — `applyAction` / `elapsedSeconds`, both taking `now: Date`

## WHY THIS APPROACH

Complexity: standard
Justification: five files, and the handler carries real branching — active vs. absent session, same vs. different task, resolvable vs. dead task. It also fixes the seams (repo interface, clock injection, event shape) that two later tasks build on, so the design decisions here outlive the task.

## SANDWICH CONTEXT

[CRITICAL: never read the clock inside a handler. The router is built by `createFocusSessionRouter({ repo, now, publish })`; `now()` is the only time source, and tests inject a fixed one. A `new Date()` inside a handler makes every duration assertion in T5 untestable.]

You are implementing the focus session read and create endpoints for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — server-persisted `focus_sessions` with optimistic locking; SSE keeps tabs and devices in sync.
Files in scope: `server/src/routes/focus-session.ts`, `server/src/routes/focus-session-repo.ts`, `server/src/routes/focus-session.test.ts`, `server/src/routes.ts`, `server/src/realtime.ts` — no other files.
Test framework: Vitest, node environment, `supertest` for HTTP. Single file: `npm run test --workspace=server -- src/routes/focus-session.test.ts`.
Available after: T1 (`focus_sessions` table + Kysely types), T2 (`core/focus-session.ts`), T3 (`config.FOCUS_MODE_ENABLED`).
Architecture rule: NodeNext ESM — every relative import carries `.js`. A task is identified by `(source, taskId)`, never by `key_number` alone (ADR #103). Non-members get 404, never 403. Every mutation calls the injected `recordFocusActivity()` audit seam with `cardId: null` and a namespaced focus payload; it must not mutate `cards` or `tracker_items`, and must not add a deferred `focus_events` table.

[RESTATE: `now()` is injected — no handler may call `new Date()` or `Date.now()` directly.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given board card C, When `POST { action: "focus", source: "board", taskId: C.id }`, Then a Ready session is persisted with `source: "board"`, `taskId: C.id`, `returnPath: "/board/card/<C.id>"`, `accumulatedSeconds: 0`
Given tracker item T with key CA-42, When focused, Then the session carries `source: "tracker"` and `returnPath: "/tracker/CA-42"`
Given a Ready session on task T, When focus is requested on T again, Then the same session is returned unchanged and no row is inserted
Given a previously Finished session on task T, When focus is requested on T again, Then a new Ready session at 0 accumulated seconds is created rather than the finished one being revived
Given Running session with 1200 accumulated seconds, When `GET`, Then `state`, `accumulatedSeconds`, `runningSince`, and `version` come back for the client to restore from
[must-not] Given a non-member, When any focus endpoint is called, Then the response must NOT be 403 or 200 — it must be `404 { error: "Not found" }`
[must-not] Given `FOCUS_MODE_ENABLED=false`, When any focus endpoint is called by a member, Then it must NOT succeed — 404
[must-not] Given an active session on task A, When focus is requested on a different task B, Then the server must NOT finish A or create a session on B — it must return `409 { code: "session_active", session }`
[derived] Given an active session whose task no longer resolves, When `GET`, Then the session is auto-finished with in-flight time accrued and the response is `{ session: null, autoFinished: { reason: "task_missing", taskKey } }`
[derived] Given a task id that resolves in no table for this workspace, When focus is requested, Then the response is 404 and nothing is inserted
[derived] Given a `POST` body with an unrecognized `action`, an invalid `source`, or a non-integer `taskId`, Then the response is 400 with no lookup, insert, or publish
[derived] Given an auto-finish on read whose `repo.update` loses the version guard, Then the response is `200 { session: null }` — not a 500
[must-not] Given a tracker task key, When a fixture or a `return_path` is written, Then it must NOT use a 3-character prefix — `derivePrefix` yields 1-2 characters, so `CA-42` is valid and `CAM-42` is not

All tests PASS. Commit exists with message matching `feat(focus): add focus session read and create endpoints`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Both the feature flag and the membership check are mounted router-level (`router.use(...)`), so every verb — including the ones T5 and T6 add later — is gated by construction
- `publish` is called as `publishEvent(workspaceId, event)` — two arguments, matching `server/src/realtime.ts:408`
- Every SSE publish includes `userId` — the client's privacy filter has nothing else to key on
- The audit seam is the narrow `RecordFocusActivity` domain type; the `db`-bound default lives in exactly one place and uses `eventType: "focus_session"`
- The display key comes from `formatKey(derivePrefix(workspaceName), keyNumber)` in `core/tracker-key.ts` — never a second prefix derivation
- `findTask` branches on `source` and queries `cards` or `tracker_items` explicitly, excluding soft-deleted rows
- The repo stays logic-free: queries and row mapping only
- The response DTO matches the Shared Contract exactly — camelCase, ISO timestamps, `finishedAt: null` when open
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — the active-session preamble is extracted once, not pasted into three handlers
- Commit message follows conventional commits format

Must-not-have:
- `PATCH` handlers or the `switch` action — T5 and T6 own those
- a direct card/task mutation or a `focus_events` table write; the audit call is required and must remain namespaced as a focus-session event
- Resolving a task by `key_number` without its `source`
- Kysely usage anywhere outside `focus-session-repo.ts` — the one exception is the `db`-bound `defaultRecordFocusActivity` at the bottom of the file, which no handler calls directly
- `typeof recordActivity` as the injected audit type, or `eventType: "update"` for a focus row
- A copy of `getWorkspacePrefix` from `tracker-items.ts`
- Any change to `cards` or `tracker_items`

Open question risks:
- Assumption: `GET` returns the stored `accumulatedSeconds` + `runningSince` and lets the client derive the live total. If the product needs a server-computed total in the payload, that is an additive field → report NEEDS_CONTEXT rather than changing the stored semantics.
- Assumption: auto-finish on read is the server's job (not the client's). T13 assumes this is already handled for the load path.

Rollback note:
- With `FOCUS_MODE_ENABLED=false` every endpoint here 404s, which is the Rollback Plan's first step. Verify that explicitly.

Red flags:
- Work outside the six listed files → DONE_WITH_CONCERNS
- A clock read inside a handler → STOP
- A cross-table FK or a `key_number`-only lookup → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=server` are green, commit created
Uncertain when: the client-derives-duration assumption proves wrong, or auto-finish-on-read turns out to belong on the client
Escalate when: the handler appears to need a dedicated `focus_events` table (deferred to issue #107), a change to `cards`/`tracker_items`, or a `key_number`-only task lookup. Do not escalate to skip `recordFocusActivity()` — the injected namespaced audit seam is required on every focus mutation.
