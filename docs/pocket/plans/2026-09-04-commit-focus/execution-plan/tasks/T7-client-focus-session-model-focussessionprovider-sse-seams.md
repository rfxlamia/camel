# Task T7 — Client focus session model — `FocusSessionProvider` + SSE seams

**Phase:** 3
**Depends:** T6
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 7: Client focus session model — `FocusSessionProvider` + SSE seams [depends: T6]

## OBJECTIVE

Build the client's model of the focus session: the `FocusSession` type, the `api.focus.*` methods, the three `BoardContext` fan-out seams the feature needs, and a `FocusSessionProvider` that owns session state, lifecycle actions, conflict recovery, and cross-tab sync. Every focus UI task consumes it through `useFocusSession()` and never calls the focus API directly.

**A provider, not a bare hook.** Three surfaces read this state — the focus page (T9), the nav indicator (T11), and the workspace-switch guard (T12). A per-caller hook would fetch once per mount and let the page and the indicator drift apart between SSE echoes. One provider mounted inside `BoardProvider` gives every consumer the same session object.

Files:
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/context/BoardContext.tsx`
- Create: `client/src/context/FocusSessionContext.tsx`
- Modify: `client/src/App.tsx`
- Test: `client/src/context/FocusSessionContext.test.tsx`
- Test: `client/src/context/BoardContext.focusSeams.test.tsx`

`FocusSessionProvider` wraps the router inside `BoardProvider` in `client/src/App.tsx`, so the session is available everywhere a logged-in user can navigate. `useFocusSession()` is the consumer hook, throwing outside the provider exactly as `useBoard()` does.

**Three seams, not one.** `BoardContext` fans out `tracker.*` today through the existing `subscribeTrackerEvents`, and nothing else. This task adds the other three fan-outs the focus feature needs downstream, each with its own control-flow rule:

| Seam | Events | Consumed by | Control flow after fan-out |
|---|---|---|---|
| `subscribeFocusEvents` | `focus_session.updated` | this provider | `return` — a focus event must not also schedule a board refresh |
| `subscribeCardEvents` | `card.*` | T9 (refresh the surface on a board-card update), T13 (auto-finish on delete) | **fall through** to `scheduleRefresh()` — that fall-through is what refreshes the board on every card change today |
| `subscribeMembershipEvents` | `membership.removed` | T13 (auto-finish on access loss) | fan out **first**, then let the existing redirect logic run unchanged |

None of these three exists today — only the `tracker.*` fan-out does. Verified in `client/src/context/BoardContext.tsx`: the `onmessage` handler branches on `tracker.` and returns, but every `card.*` event falls straight through to `scheduleRefresh()` with no subscriber notified, and `membership.removed` is handled inline with a redirect and fans out to nobody. Without the card seam, half of the spec's `Rule: Work context` SSE criterion — the `source: "board"` half, which is the primary entry point — has nothing to hook into. Without the membership seam, the spec's `Rule: Guards` access-revoked criterion has nothing to hook into.

Adding all three here — in the one task that owns the `BoardContext` SSE branch, upstream of T9, T12, and T13 — is what keeps every later task's "no changes to `BoardContext.tsx`" rule honest.

**The 409 contract, settled — read this before writing the conflict cycles.** Phase 2 already shipped all three conflict responses in `server/src/routes/focus-session.ts`; nothing here is an open question.

| Code | Where | Body | Client behavior |
|---|---|---|---|
| `version_conflict` | PATCH (~line 480) and POST switch (~line 363) | `{ code, session }` where `session` is `current ? serialize(current) : null` | adopt the body value **verbatim, including `null`** — a `null` means the server has no active session, so clearing local state is the correct reconciliation. Never refetch. Clear `actionError` |
| `session_active` | POST focus (~line 393) | `{ code, session }` — always populated | adopt the session, then rethrow the typed `ApiError` so T10 can show its confirm-switch dialog |
| `invalid_transition` | PATCH (~line 464) | `{ code, session }` | **not** a special case — falls through to the generic retryable `actionError` path built in Steps 25–27. Do not add a third branch |

The nullable `version_conflict` session is the reason the adoption path must accept `FocusSession | null` rather than assuming a row. A refetch fallback is explicitly out of scope.

`subscribeFocusEvents(handler): () => void` mirrors the existing `subscribeTrackerEvents` on `BoardContext` exactly — a `useRef` set of handlers, a `useCallback` subscribe returning an unsubscribe, and a dispatch branch in the `EventSource` `onmessage` for `data.type === "focus_session.updated"`. Copy that shape; do not invent a second pattern.

Steps:

1. Write failing test for: `focus_session.updated` reaches subscribers and does NOT trigger a board refresh
   Test file: `client/src/context/BoardContext.focusSeams.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given a `BoardProvider` with an active workspace and a handler registered through `subscribeFocusEvents`
   When `MockEventSource` emits the literal Shared-Contract `focus_session.updated` payload
   Then:
   - the handler receives it
   - the board's debounced refresh does **not** run — this branch `return`s, unlike the `card.*` one
   And Given the handler is unsubscribed, When another such event arrives, Then it is not called

   Exercise through: the `subscribeFocusEvents` value on the context, driven by `MockEventSource`
   Test doubles: `MockEventSource` via `vi.stubGlobal`, mocked `../api`, `vi.useFakeTimers()` advanced past the debounce; do NOT mock `BoardProvider`'s `onmessage` handler
   Expected RED: `subscribeFocusEvents` is not on the context; the handler is never called

2. Run test — verify FAIL: `npm run test --workspace=client -- src/context/BoardContext.focusSeams.test.tsx`
   Expected failure: `subscribeFocusEvents is not a function`

3. Implement, then verify PASS: in `client/src/context/BoardContext.tsx`, add the `subscribeFocusEvents` field, subscriber ref, unsubscribe callback, and `focus_session.updated` branch that fans out and returns. Run `npm run test --workspace=client -- src/context/BoardContext.focusSeams.test.tsx` — expected PASS.

4. Write failing test for: `card.*` events reach subscribers without breaking the board refresh
   Test file: `client/src/context/BoardContext.focusSeams.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given a `BoardProvider` with an active workspace and handlers registered through `subscribeCardEvents` and the pre-existing `subscribeTrackerEvents`
   When a `card.updated` event `{ type: "card.updated", actor, cardId: 481, payload: { key: "CAM-42" } }` arrives
   Then the card handler receives it and the board's debounced refresh still runs — the card branch must fan out and fall through to `scheduleRefresh()`
   And Given a `tracker.updated` event `{ type: "tracker.updated", actor, trackerItemId: 77 }`, Then the card handler is not called and the tracker handler is called
   And Given a registered handler is unsubscribed, Then later events do not call it

   Exercise through: both subscription values on a real `BoardProvider`, driven by `MockEventSource` and a clock advance past the debounce
   Test doubles: `MockEventSource` via `vi.stubGlobal`, mocked `../api`, `vi.useFakeTimers()`; do NOT mock `BoardProvider`'s `onmessage` handler
   Expected RED: `subscribeCardEvents` is not on the context; the card handler is never called

5. Run test — verify FAIL: `npm run test --workspace=client -- src/context/BoardContext.focusSeams.test.tsx`
   Expected failure: `subscribeCardEvents is not a function`

6. Implement, then verify PASS: add `cardEventSubscribers`, its subscribe callback, the context field, and a `data.type.startsWith("card.")` branch that fans out and falls through to `scheduleRefresh()`. Run the seam test and then `npm run test` — both must PASS.

6a. Write/run a separate RED→implementation→PASS cycle for `card.deleted` on the real provider: Given a handler registered through `subscribeCardEvents`, When `MockEventSource` emits `{ type: "card.deleted", actor, cardId: 481, payload }`, Then the handler receives it and `scheduleRefresh()` still runs.
    Test file: `client/src/context/BoardContext.focusSeams.test.tsx`
    Level: unit (component, jsdom)
    Exercise through: `subscribeCardEvents` on a real `BoardProvider`, driven by `MockEventSource`
    Test doubles: `MockEventSource` via `vi.stubGlobal`, mocked `../api`, `vi.useFakeTimers()`; do NOT mock `BoardProvider`'s `onmessage` handler
    Expected RED: a `card.updated`-only branch never calls the subscriber. Do not treat T13's stubbed registry as covering this seam.
    Run FAIL then PASS: `npm run test --workspace=client -- src/context/BoardContext.focusSeams.test.tsx -t card.deleted.fans.out`

6b. Write/run a separate RED→implementation→PASS cycle for `tracker.deleted` on the real provider: Given a handler registered through the pre-existing `subscribeTrackerEvents`, When `{ type: "tracker.deleted", actor, trackerItemId: 77 }` arrives, Then the tracker handler is called. T13's live-delete GWTs cannot substitute for this — they stub the registry.
    Test file: `client/src/context/BoardContext.focusSeams.test.tsx`
    Level: unit (component, jsdom)
    Exercise through: `subscribeTrackerEvents` on a real `BoardProvider`, driven by `MockEventSource`
    Test doubles: `MockEventSource` via `vi.stubGlobal`, mocked `../api`; do NOT mock `onmessage`
    Expected RED: a `tracker.updated`-only branch never calls the subscriber.
    Run FAIL then PASS: `npm run test --workspace=client -- src/context/BoardContext.focusSeams.test.tsx -t tracker.deleted.fans.out`

7. Write failing test for: `membership.removed` reaches subscribers without breaking the existing workspace redirect
   Test file: `client/src/context/BoardContext.focusSeams.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given a `BoardProvider` with an active workspace and a handler registered through `subscribeMembershipEvents`
   When `{ type: "membership.removed", userId: currentUser.id, workspaceId: activeWorkspaceId, workspaceName: "Removed Workspace" }` arrives, once where `getRemovalRedirect` returns a redirect and once where it returns `null`
   Then:
   - the subscriber receives the event in both cases
   - the redirect case still shows the warning toast and switches workspace
   - a removal event for a different user does not call the subscriber

   Exercise through: the `subscribeMembershipEvents` value on a real `BoardProvider`, driven by `MockEventSource`
   Test doubles: `MockEventSource` via `vi.stubGlobal`, mocked `../api`, workspace fixtures producing both redirect outcomes; do NOT mock `getRemovalRedirect` or `BoardProvider`'s `onmessage` handler
   Expected RED: `subscribeMembershipEvents` is not on the context; the handler is never called

8. Run test — verify FAIL: `npm run test --workspace=client -- src/context/BoardContext.focusSeams.test.tsx`
   Expected failure: `subscribeMembershipEvents is not a function`

9. Implement, then verify PASS: add `membershipEventSubscribers`, its subscribe callback, the context field, and a fan-out at the **top** of the existing `membership.removed` block before `getRemovalRedirect`, without returning from the fan-out. Leave the redirect logic unchanged. Run the seam test and then `npm run test` — both must PASS.

10. Write failing test for: `Given Running session with 1200 accumulated seconds, When the app loads, Then state restores from the server`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Independent RED case A only: Given `api.focus.get` resolves a Running session, When a probe calls `useFocusSession()` during load and after resolution, Then the initial value is `session: null, loading: true` and the settled value adopts the session with `loading: false`. The null and auto-finished responses are separate cycles below.

    Exercise through: `renderHook(() => useFocusSession(), { wrapper })` where `wrapper` nests `FocusSessionProvider` inside a `BoardContext` stub
    Test doubles: mocked `../api` via `vi.hoisted`; stubbed `BoardContext` with `activeWorkspaceId`, `user`, `showToast`, `setHasActiveFocusSession`, `setFocusSessionHydrated`, and an in-memory `subscribeFocusEvents`; do NOT mock `FocusSessionProvider` or its reducer
    Expected RED: `client/src/context/FocusSessionContext.tsx` does not exist — the import fails

11. Run test — verify FAIL: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`
    Expected failure: `Failed to resolve import "../context/FocusSessionContext"`.

12. Implement the minimal load path, then verify PASS: create the provider, call `api.focus.get(activeWorkspaceId)` on mount, adopt the session payload, and keep `session` null while loading. Do **not** yet toast on `autoFinished` and do not implement mutation actions. Run `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx -t restores.from.the.server`.

12a. Write/run a separate RED→implementation→PASS case for a successful `{ session: null }` response: the provider settles empty without an error or toast.
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)
    Exercise through: `renderHook` and a resolved `api.focus.get` response with `session: null`
    Test doubles: mocked `api.focus.get`, stubbed BoardContext, and real provider reducer
    Expected RED: the load path does not yet prove the successful empty response is silent.
    Run FAIL then PASS: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx -t session.null.silent`

12b. Write/run a separate RED→implementation→PASS case for `autoFinished`: the provider settles empty and emits only the task-missing warning toast.
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)
    Exercise through: `renderHook` and a resolved `api.focus.get` response with `autoFinished`
    Test doubles: mocked `api.focus.get`, stubbed BoardContext `showToast`, and real provider reducer
    Expected RED: Step 12 adopted the payload without toasting, so `showToast` is not called. Do not use "provider does not exist" as this case's RED.
    Run FAIL then PASS: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx -t autoFinished.toast`

13. Write a separate failing test for: `Given focus GET rejects 404, When the provider loads, Then it stays silent with session null and hydration complete`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Given `api.focus.get` rejects `new ApiError("Not found", 404, "not_found")`, When the provider loads, Then no error or toast is exposed, `session` is `null`, and `setFocusSessionHydrated(true)` is called. A 404 from the disabled/non-member gate is normal absence, not a visible failure.
    Exercise through: `renderHook(() => useFocusSession(), { wrapper })` and the rejected GET promise
    Test doubles: mocked `api.focus.get`, stubbed BoardContext setters and `showToast`; do not mock the provider
    Expected RED: the provider exposes the 404 as an action/load error or never marks hydration complete.

14. Run test — verify FAIL: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`
    Expected failure: the 404 rejection is surfaced or hydration remains false.

15. Implement silent 404 load handling, then verify PASS: treat only GET 404 as an empty session, preserve unexpected errors, and mark the workspace hydrated in a `finally` path. Run `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`.

16. Write a separate failing test for: `Given the active workspace changes, When the new GET is pending, Then the old session is cleared and focus hydration is unknown`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: integration (hook, jsdom)

    Test intent:
    Given a loaded session in workspace 3, When `activeWorkspaceId` changes to 4 and `api.focus.get(4)` is pending, Then the provider immediately exposes `session: null`, `loading: true`, calls `setHasActiveFocusSession(false)`, and calls `setFocusSessionHydrated(false)`; it must not expose workspace 3's session. This is one workspace-change GWT. A separate stale-response test then resolves workspace 3 late and proves it is ignored, while workspace 4 is adopted and hydration becomes true.
    Exercise through: `renderHook` with a rerender that changes `activeWorkspaceId`, followed by controlled promise resolution
    Test doubles: deferred `api.focus.get` promises keyed by workspace id; stubbed BoardContext flags/setters; do not mock the provider
    Expected RED: the provider only loads on mount and leaves stale workspace-3 state visible.

17. Run test — verify FAIL: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`
    Expected failure: the old session remains or the hydration setter is not driven.

18. Implement workspace-scoped hydration, then verify PASS: T7 owns the `focusSessionHydrated` and `hasActiveFocusSession` state/setters exposed by `BoardContext`; key the load effect by `activeWorkspaceId`, clear state before each load, invalidate late responses, set `focusSessionHydrated(false)` before the request and true after success/404, and clear both parent flags on unmount. T12 consumes these fields and must not redefine them. Run `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`.

18a. Write/run a separate RED→implementation→PASS cycle proving the **real** `BoardProvider` exposes the four focus fields: Given a probe calling `useBoard()` inside a real `BoardProvider`, Then `hasActiveFocusSession` is `false`, `focusSessionHydrated` is `false`, and `setHasActiveFocusSession` / `setFocusSessionHydrated` are functions.
     Test file: `client/src/context/BoardContext.focusSeams.test.tsx`
     Level: unit (component, jsdom)
     Exercise through: a probe component reading `useBoard()` inside a real `BoardProvider`
     Test doubles: `MockEventSource` via `vi.stubGlobal`, mocked `../api`; do not stub `BoardContext`
     Expected RED: every other T7 test stubs `BoardContext`, so nothing yet proves the real provider carries these fields — the probe reads `undefined`. T12 is forbidden from adding them, so if this is not covered here the gap reaches Phase 4 with only typecheck standing behind it.
     Run FAIL then PASS: `npm run test --workspace=client -- src/context/BoardContext.focusSeams.test.tsx -t focus.flags.on.the.real.provider`

19. Write failing test for: provider exposes `focus()` and `switchTo()` with the server's POST contract
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Independent GWT case A: Given no current session, When `focus({ source: "board", taskId: 481 })` runs, Then `api.focus.post(3, { action: "focus", source: "board", taskId: 481 })` is called and Ready is adopted. Independent GWT case B: Given an active session on task A at version 2, When `switchTo({ source: "tracker", taskId: 77, version: 2 })` runs, Then the switch POST contract is used and Ready task 77 is adopted.
    Exercise through: `renderHook` actions and observed provider state
    Test doubles: mocked `api.focus.post`, stubbed BoardContext with active workspace and session flags; do not mock action functions
    Expected RED: the provider has no POST action functions yet.

20. Run test — verify FAIL: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`
    Expected failure: `focus` or `switchTo` is undefined.

21. Implement the parameterized POST action path, then verify PASS: expose `focus` and `switchTo`, adopt successful `{ session }` without optimistic state, and keep the active workspace in every request. Run `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`.

22. Write failing test for: lifecycle actions drive the server and adopt its response
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Independent GWT cases for `start`, `pause`, and `resume`: each sends its own action with the current version and adopts the returned session. A separate finish case verifies that `finish()` returns the finished payload while storing `session: null` and clearing the active-session flag. Do not combine lifecycle actions into one assertion.
    Exercise through: `renderHook` and one provider action per test case
    Test doubles: mocked `api.focus.patch` with action-specific responses; stubbed BoardContext setters; do not mock the provider
    Expected RED: lifecycle action functions are absent.

23. Run test — verify FAIL: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`
    Expected failure: lifecycle callbacks are undefined.

24. Implement the parameterized PATCH lifecycle path, then verify PASS: route all four actions through one runner, never update optimistically, and special-case finish to return the server payload while storing null. Run `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`.

25. Write failing test for: `Given Ready, When Start fails 5xx, Then stays Ready and exposes a retryable error`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Given Ready with `runningSince: null`, `api.focus.patch` rejects status 500. Then the session remains Ready, no timer state is invented, `actionError` is exposed, and a later `start()` can be attempted again.
    Exercise through: `renderHook` and the `start()` action, then a second retry
    Test doubles: mocked `api.focus.patch` that rejects once with status 500 and resolves on retry; stubbed BoardContext; do not mock the provider
    Expected RED: the rejection escapes or no retryable error state exists.

26. Run test — verify FAIL: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`
    Expected failure: unhandled rejection or missing `actionError`.

27. Implement retryable 5xx handling, then verify PASS: catch mutation failures into `actionError`, preserve the last server session, allow retry, and keep the error clear on success. Run `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`.

28. Write failing test for: `Given stale version, When mutation, Then version_conflict adopts the body session silently`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Given version 3 and a `409 { code: "version_conflict", session: <version 4> }`, `resume()` adopts version 4 without a GET round trip or user-facing error, and the next action sends version 4.
    Exercise through: `renderHook`, `resume()`, and the subsequent lifecycle action
    Test doubles: mocked `api.focus.patch` rejecting with an `ApiError` carrying status 409, code, and body session; no GET fallback; do not mock the provider
    Expected RED: `ApiError` lacks the body session or treats the conflict as a generic error.

29. Run test — verify FAIL: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`
    Expected failure: the stale session remains or a visible error appears.

30. Implement `version_conflict` recovery, then verify PASS: extend `ApiError`/`request()` with the response session, adopt it, clear `actionError`, and resolve the conflict path without surfacing it. Run `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`.

30a. Write/run a separate RED→implementation→PASS cycle for a **null** `version_conflict` body: Given a local session at version 3, When `pause()` rejects `409 { code: "version_conflict", session: null }` — the shape the server returns when `findActive` finds nothing — Then the provider clears `session` to `null`, clears `actionError`, issues no GET, and surfaces no error. This is the real server contract (`session: current ? serialize(current) : null`), not a hypothetical.
     Test file: `client/src/context/FocusSessionContext.test.tsx`
     Level: unit (hook, jsdom)
     Exercise through: `renderHook` and the rejected `pause()` promise
     Test doubles: mocked `api.focus.patch` rejecting with an `ApiError` whose body session is `null`; mocked `api.focus.get` asserted not called; do not mock the provider
     Expected RED: Step 30 adopted a session object, so a `null` body either throws, is treated as a generic error, or leaves version 3 in place. Do not use "no conflict handling exists" as this case's RED.
     Run FAIL then PASS: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx -t version_conflict.null`

31. Write a separate failing test for: `Given focus() receives 409 session_active, When the caller handles it, Then the provider adopts the current session and preserves the typed conflict`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Given no local session and `focus()` rejects `409 { code: "session_active", session: <task A> }`, Then the provider adopts task A and rethrows the typed `ApiError` with `code: "session_active"` so T10 can show its confirmation dialog. This is intentionally different from `version_conflict`, which is reconciled silently.
    Exercise through: `renderHook` and the rejected `focus()` promise
    Test doubles: mocked `api.focus.post` rejecting with a typed `ApiError` containing the current session; stubbed BoardContext; do not mock the provider
    Expected RED: the provider swallows both 409 codes identically or loses the embedded session.

32. Run test — verify FAIL: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`
    Expected failure: the conflict code is lost or the caller cannot distinguish it.

33. Implement the explicit 409 split, then verify PASS: `version_conflict` resolves after adoption (including a `null` body); `session_active` adopts the session, clears stale local state, and rethrows without a generic error toast. Every other 409 code — `invalid_transition` included — falls through to the generic `actionError` path from Step 27; do not add a third branch. Run `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`.

33a. Write/run a separate RED→implementation→PASS cycle for POST `switchTo` `version_conflict`: Given an active session at version 2, When `switchTo(...)` rejects `409 { code: "version_conflict", session: <version 4> }`, Then the provider adopts version 4 silently (same as PATCH `resume()`), clears `actionError`, and the next action sends version 4. A POST runner that does not share the PATCH conflict branch would surface a generic error on confirm-switch.
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)
    Exercise through: `renderHook` and the rejected `switchTo()` promise
    Test doubles: mocked `api.focus.post` rejecting with a typed `ApiError` containing status 409, `code: "version_conflict"`, and body session; do not mock the provider
    Expected RED: only the PATCH path adopts the 409 body, so `switchTo` leaves the stale session or exposes a generic error.
    Run FAIL then PASS: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx -t switchTo.version_conflict`

34. Write failing test for SSE Case A only: `Given Running in tab A, When tab B pauses, Then tab A shows Paused`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: integration

    Test intent:
    Given a Running session for user 7 in workspace 3, When the in-memory `subscribeFocusEvents` registry delivers `{ type: "focus_session.updated", userId: 7, workspaceId: 3, payload: { session: <Paused> } }`, Then the provider shows Paused with the event's duration and `api.focus.get` is not called. This cycle proves only the matching-user pause-sync path.

    Exercise through: `renderHook`, the real `subscribeFocusEvents` callback registry, and controlled event delivery
    Test doubles: stubbed BoardContext with `user.id`, `activeWorkspaceId`, and an in-memory subscriber; mocked `api.focus.get` asserted not called; do not mock the provider event handler
    Expected RED: the provider does not subscribe, so a matching Paused event does not change state

35. Run test — verify FAIL for SSE Case A only: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx -t tab.B.pauses`
    Expected failure: delivered matching events do not change the provider.

36. Implement subscribe/unsubscribe through `BoardContext` and apply a matching-user `payload.session`. Do not yet handle `payload.session: null` or other `userId`s as part of this cycle. Run PASS: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx -t tab.B.pauses`.

36a. Write a failing test for SSE Case B only: matching-user `payload.session: null` clears local state
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: integration
    Test intent: Given a populated session for user 7, When a matching `focus_session.updated` arrives with `payload.session: null`, Then `session` becomes null and no refetch runs.
    Exercise through: the same `subscribeFocusEvents` registry
    Test doubles: stubbed BoardContext subscriber; mocked `api.focus.get` asserted not called; do not mock the handler
    Expected RED: the Case A applier ignores null payloads or treats them as a no-op, so `session` stays populated. Do not use "no subscription exists" as Case B's RED.

36b. Run test — verify FAIL for Case B only: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx -t payload.session.null`
    Expected failure: the populated session remains after a null payload.

36c. Implement null-payload clearing, then verify PASS: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx -t payload.session.null`

36d. Write a failing test for SSE Case C only: another user's event must not change local state
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: integration
    Test intent: Given a Running session for user 7, When `focus_session.updated` arrives with `userId: 9` and a Paused payload, Then the current session is unchanged and no refetch runs.
    Exercise through: the same `subscribeFocusEvents` registry
    Test doubles: stubbed BoardContext with `user.id: 7`; mocked `api.focus.get` asserted not called
    Expected RED: the Case A/B applier does not filter on `event.userId === user.id`, so user 9's event is applied. Do not use "no subscription exists" as Case C's RED — that would already pass.

36e. Run test — verify FAIL for Case C only: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx -t other.user.focus.event`
    Expected failure: user 9's event changes the current session.

36f. Implement the `event.userId === user.id` privacy filter, then verify PASS: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx -t other.user.focus.event`. Re-run Cases A and B `-t` filters so they stay PASS. Keep the provider on the current workspace.

37. Refactor while green (bounded):
    - Rule of three: route the four PATCH lifecycle actions through one parameterized `runPatchAction(action)` helper, and keep POST `focus`/`switchTo` parameterized with one explicit 409 split
    - Three new subscriber registries now sit beside the existing tracker one, so extract a named `createSubscriberRegistry()` helper inside `BoardContext.tsx` and use it for all four. The real-provider coverage is in Steps 1, 4, and 7, including the pre-existing tracker seam.
    - `BoardContext.tsx` is ~761 lines: add only the three subscriber registries, callbacks, focus/card branches, membership fan-out, the focus flags/setters, and context fields. T7 owns these parent fields; no focus business logic belongs there.
    - Keep `FocusSessionContext.tsx` under ~300 lines.
    - Re-run `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`, `npm run test --workspace=client -- src/context/BoardContext.focusSeams.test.tsx`, and the full client suite — all must stay PASS.

38. Mount the provider: in `client/src/App.tsx`, wrap the authenticated router in `<FocusSessionProvider>` inside `BoardProvider`. Verify: `npm run test` and `npm run typecheck --workspace=client`.

39. Commit — **two commits at the seam already present in the step order**. Seven files and ~20 RED/GREEN cycles in one commit is not reviewable; Steps 1–9 and Steps 10–38 are independently coherent, so split there. Both must exist for this task to be DONE.

    Commit 1 — the `BoardContext` seams (Steps 1–9, plus 18a's assertions once written):
    `git add client/src/context/BoardContext.tsx client/src/context/BoardContext.focusSeams.test.tsx`
    `git commit -m "feat(focus): add focus, card, and membership SSE seams to BoardContext"`

    Commit 2 — the provider and its mount (Steps 10–38):
    `git add client/src/types.ts client/src/api.ts client/src/context/FocusSessionContext.tsx client/src/context/FocusSessionContext.test.tsx client/src/App.tsx`
    `git commit -m "feat(focus): add focus session provider and SSE seams"`

    If Step 18/18a's focus flags land in `BoardContext.tsx` after Commit 1, amend them into Commit 2 by including `client/src/context/BoardContext.tsx` there as well — never leave the tree dirty between the two.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Concurrency (both criteria); rule: Lifecycle (`✗ Start fails 5xx`, `✓ refresh restores state`); "Story: Cross-tab and cross-device sync"; Design Decision → Sync row ("payload includes `userId` — client **must** filter to current user")
- `client/src/context/BoardContext.tsx` — `TrackerEventHandler` (line ~57), the `subscribeTrackerEvents` callback (~270) and its context field (~753), the `onmessage` dispatch this task mirrors (~543), the `tracker.*` fan-out branch (~592–600), the `membership.removed` block whose conditional `return` at ~575 dictates where the membership fan-out must sit (~561–579), and the `scheduleRefresh()` fall-through every non-returning branch lands on (~608)
- `client/src/hooks/useNotifications.ts` + `useNotifications.test.ts` — hook + `MockEventSource` testing convention
- `client/src/context/BoardContext.viewMode.test.tsx` and `BoardContext.focusFlag.test.tsx` — existing real-`BoardProvider` test setups to copy
- `client/src/pages/TrackerDetailPage.test.tsx` — `vi.hoisted` API-mocking convention
- `client/src/api.ts` — `request<T>` helper and `ApiError` (exported at line ~872; carries `status` and `code`)
- `server/src/routes/focus-session.ts` — the shipped 409 responses this provider reconciles against; read the three-row table above before the conflict cycles
- `client/src/types.ts` — `WorkItemSource` already exists as `"board" | "tracker"`; reuse it rather than declaring a second union

## WHY THIS APPROACH

Complexity: standard
Justification: seven files, and the provider is the single point where three failure modes converge — action rejection, version conflict, and a workspace-wide broadcast that must be filtered by user. Every downstream UI task assumes this behaves correctly.

## SANDWICH CONTEXT

[CRITICAL: `focus_session.updated` is broadcast to the whole workspace. The hook MUST ignore any event whose `userId` is not the current user's. Without that filter, one member's focus session appears in another member's UI — the exact "shared/workspace-wide focus" outcome the spec puts out of scope.]

You are implementing the client focus session model for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — server-authoritative session; the client adopts server payloads and never invents state optimistically.
Files in scope: `client/src/types.ts`, `client/src/api.ts`, `client/src/context/BoardContext.tsx`, `client/src/context/BoardContext.focusSeams.test.tsx`, `client/src/context/FocusSessionContext.tsx`, `client/src/context/FocusSessionContext.test.tsx`, `client/src/App.tsx` — no other files.
Test framework: Vitest + `@testing-library/react`, jsdom. Single file: `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx` — workspace-scoped AND workspace-relative. A root `npm run test -- client/src/...` does NOT filter: it exits 1 with `No test files found`, which is indistinguishable from a real RED. Never quote a multi-word `-t` filter — npm strips the quotes and the run can exit 0 having skipped every test; use a regex dot per space (`-t tab.B.pauses`).
Available after: T6 (full server API incl. `switch`), T3 (`focusModeEnabled` on `BoardContext`).
Architecture rule: client imports carry NO file extension. `noUnusedLocals` / `noUnusedParameters` are on — an unused import fails typecheck. React hooks rules (`useExhaustiveDependencies`, `useHookAtTopLevel`) are enforced in `client/src/`. Do not add focus logic to `BoardContext.tsx` beyond the SSE fan-out.

[RESTATE: filter every `focus_session.updated` event on `userId === user.id` — a workspace broadcast must never leak another member's session into this UI.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a Running session with 1200 accumulated seconds, When the hook mounts, Then state and duration restore from the server response
Given two tabs and a Running session, When a `focus_session.updated` event for this user arrives with a Paused session, Then the hook shows Paused with the correct duration and issues no refetch
Given a stale version, When an action returns 409, Then the hook adopts the session from the 409 body and the next action sends the new version
Given a Ready session, When Start rejects with 5xx, Then the session stays Ready, no timer state is invented, and a retryable error is exposed
[derived] Given `api.focus.get` resolves `{ session: null }`, When the provider mounts, Then `session` is `null` and no error is surfaced
[derived] Given the load response carries `autoFinished: { reason: "task_missing" }`, When the provider mounts, Then `session` is `null` AND a task-missing warning toast is shown
[derived] Given `finish()` resolves a finished session, When it settles, Then the provider's `session` is `null` — the finished payload is returned to the caller, not stored
[derived] Given an event with `payload.session: null`, When it arrives for this user, Then `session` becomes `null`
[derived] Given a handler registered via `subscribeCardEvents`, When a `card.updated` event arrives, Then the handler is called AND the board's debounced refresh still runs
[derived] Given a handler registered via `subscribeCardEvents` on a real `BoardProvider`, When `card.deleted` arrives, Then the handler is called AND the board refresh still runs
[derived] Given a handler registered via the pre-existing `subscribeTrackerEvents`, When a `tracker.updated` event arrives, Then it still receives the event after the Step 37 registry extraction
[derived] Given a handler registered via `subscribeTrackerEvents` on a real `BoardProvider`, When `tracker.deleted` arrives, Then the tracker handler is called
[derived] Given `switchTo()` rejects `409 { code: "version_conflict", session }`, When it settles, Then the provider adopts the body session the same way PATCH `resume()` does
[derived] Given a handler registered via `subscribeFocusEvents`, When a `focus_session.updated` event arrives at a real `BoardProvider`, Then the handler is called AND no board refresh is scheduled
[derived] Given a handler registered via `subscribeMembershipEvents`, When a `membership.removed` for this user arrives and `getRemovalRedirect` yields a redirect, Then the handler is called AND the removal toast and workspace switch still happen
[derived] Given the same event where `getRemovalRedirect` yields `null`, When it arrives, Then the handler is still called
[must-not] Given a `card.*` event, When it is fanned out, Then the branch must NOT return early — doing so stops the board refreshing on every card change
[must-not] Given a `membership.removed` event, When the fan-out is placed, Then it must NOT sit after `getRemovalRedirect` — on the redirect path the existing `return` would skip it, leaving the seam dead in production while tests pass on the other path
[must-not] Given a `focus_session.updated` event whose `userId` differs from the current user, When it arrives, Then local session state must NOT change
[derived] Given a lifecycle action rejects `409 { code: "version_conflict", session: null }`, When it settles, Then `session` becomes `null`, no error is surfaced, and no GET is issued
[derived] Given a lifecycle action rejects `409 { code: "invalid_transition" }`, When it settles, Then it is handled by the generic retryable `actionError` path — not by a dedicated branch
[derived] Given a probe reading `useBoard()` inside a real `BoardProvider`, When it renders, Then `hasActiveFocusSession`, `focusSessionHydrated`, and both setters are present on the context
[must-not] Given any lifecycle action, When it is invoked, Then the hook must NOT apply an optimistic state change before the server responds
[must-not] Given a `version_conflict` 409, When it is reconciled, Then the provider must NOT issue a GET refetch — the body is the authority, `null` included

All tests PASS under an **unfiltered** `npm run test` (a path- or `-t`-filtered run in this repo can exit 0 having run nothing). Both commits exist, with messages matching `feat(focus): add focus, card, and membership SSE seams to BoardContext` and `feat(focus): add focus session provider and SSE seams`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- `userId` filter on every incoming focus event
- Server payloads adopted verbatim; no optimistic session construction — except `finish()`, after which `session` is `null` rather than the finished row
- A load response carrying `autoFinished` produces a user-visible warning
- 409 recovery reads the session from the response body — no second round trip — for PATCH lifecycle actions **and** POST `switchTo`, and accepts a `null` body session as "clear local state"
- Only `version_conflict` and `session_active` get dedicated branches; every other 409 code falls through to the generic `actionError` path
- The focus SSE branch in `BoardContext` returns early, so a focus event does not also schedule a board refresh
- The `card.*` branch does the opposite — it fans out `card.updated` **and** `card.deleted` and then falls through to `scheduleRefresh()`
- `subscribeTrackerEvents` receives `tracker.deleted` from a real `BoardProvider`, not only `tracker.updated`
- The `membership.removed` fan-out runs at the TOP of the existing block, before `getRemovalRedirect`, so it fires on both the redirect and the no-redirect path
- All three seams are delivered by this task, so T9 and T13 never need to touch `BoardContext.tsx`
- `subscribeFocusEvents` returns an unsubscribe function and the provider calls it on unmount
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — one parameterized action runner, not four copies
- `useFocusSession()` throws outside the provider, matching `useBoard()`
- Commit message follows conventional commits format

Must-not-have:
- Any presentational UI — the provider renders only `children`; the timer, page, indicator, and entry button are T8–T11
- Focus API calls from anywhere but this provider
- `localStorage` or any browser-local persistence of session state — the server is the authority (Option C was rejected for exactly this)
- Focus business logic inside `BoardContext.tsx`
- A second `"board" | "tracker"` union — reuse `WorkItemSource`

Open question risks:
- None outstanding. The 409 body contract is settled below — do not report NEEDS_CONTEXT for it.

Rollback note:
- With `FOCUS_MODE_ENABLED=false` the API 404s. The hook must treat a 404 on load as "no session" and stay silent, not as an error.

Red flags:
- Work outside the seven listed files → DONE_WITH_CONCERNS
- A missing `userId` filter → STOP
- Optimistic state updates → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: the 409-carries-session assumption proves wrong
Escalate when: cross-tab sync appears to require a second EventSource, or session state appears to need browser-local persistence
