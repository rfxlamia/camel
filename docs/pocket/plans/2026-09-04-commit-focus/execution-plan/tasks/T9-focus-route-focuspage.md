# Task T9 — `/focus` route + `FocusPage`

**Phase:** 4
**Depends:** T8
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 9: `/focus` route + `FocusPage` [depends: T8]

## OBJECTIVE

Add the `/focus` route and the focus surface itself: redirect away when there is no session, load the committed task by `source`, show title and description and nothing else, mount `FocusTimer`, surface action errors, and navigate back to `returnPath` on Finish.

Files:
- Create: `client/src/pages/FocusPage.tsx`
- Modify: `client/src/App.tsx`
- Test: `client/src/pages/FocusPage.test.tsx`

**Test-name rule.** Several steps below isolate a single case with an **unquoted, dot-separated** `-t` filter (e.g. `-t card.updated.refreshes.title`). npm strips quotes, so a filter with real spaces reaches vitest as `-t <first-word>` plus stray positional filters and reports `Tests N skipped` at **exit 0** — a green gate that ran nothing. Each `it()` title must therefore contain its filter string verbatim (the `.` matches the space), and no two titles in this file may match the same filter.

Steps:

1. Write failing test for: `Given no active session and hydration complete, When /focus is opened directly, Then redirect to /board`
   Test file: `client/src/pages/FocusPage.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Independent RED case A: Given `useFocusSession` reports `{ session: null, loading: false }`, When `FocusPage` renders, Then `navigate("/board", { replace: true })` is called and no error is shown. The loading guard is a separate case below.

   Exercise through:
   - the rendered page plus the mocked `useNavigate` spy

   Test doubles:
   - mock `../context/FocusSessionContext` via `vi.hoisted`
   - mock `react-router`'s `useNavigate` (the `mockNavigate` pattern in `client/src/pages/TrackerDetailPage.test.tsx`)
   - mock `../api`
   - do NOT mock: `FocusPage` or `FocusTimer`

   Expected RED:
   - `client/src/pages/FocusPage.tsx` does not exist

2. Run test — verify FAIL: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`
   Expected failure: `Failed to resolve import "./FocusPage"`

3. Implement minimal code to satisfy RED case A:
   File: `client/src/pages/FocusPage.tsx` — the `useFocusSession()` call and the redirect effect gated on `!loading && session === null`.

   **The redirect effect must not fire on a finish.** Since `finish()` makes `session` become `null` (Shared Contract), the "no session → go to `/board`" effect and the "finished → go to `returnPath`" navigation in Step 11 now key on the *same* state transition, and which one wins is a race the test harness can hide. Gate the effect against it from the start — set a ref immediately before calling `finish()` and have the effect skip while it is set — rather than discovering it when a user lands on `/board` instead of the card they came from.

   **Clear the ref whenever the finish does not navigate.** `finish()` rejects on a 5xx: `handleMutationError` sets `actionError`, `runPatchAction` returns `undefined`, and the provider throws `Error("Finish failed")` with the session still populated. A ref that is only ever set leaves the redirect suppressed for the life of the mount — so when T13 later auto-finishes that same session on a `card.deleted`, the user is stranded on `/focus` with no task and no redirect. Wrap the call so the ref is reset in the failure path (`try { … } finally { … }`, or an explicit reset in the `catch` before the error is surfaced), and only leave it set on the path that actually navigates.

4. Run test — verify PASS for the no-session case: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx -t no.active.session`

4a. Write/run a separate RED→implementation→PASS case for `{ session: null, loading: true }`: no redirect fires while hydration is pending. Keep the effect gated on `!loading`.
    Test file: `client/src/pages/FocusPage.test.tsx`
    Level: unit (component, jsdom)
    Exercise through: rendered `FocusPage` and the mocked `useNavigate` spy while the provider reports loading
    Test doubles: mocked `useFocusSession` with `session: null, loading: true`, mocked `useNavigate`; do not mock the redirect effect
    Expected RED: the page redirects during initial hydration.
    Run test after implementation: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx -t no.redirect.while.hydrating`

5. Write failing test for: `Given a board-sourced focus session, When the surface loads, Then the card title and description are visible`
   Test file: `client/src/pages/FocusPage.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given a session with `source: "board"`, `taskId: 481`
   When the page renders
   Then `api.getCard(workspaceId, 481)` was called — not `api.getWorkItem`, and not a lookup through `BoardContext.columns` — and the card's title and description are rendered
   Loading the task by `(source, id)` rather than by key alone is an ADR #103 requirement, not a style choice.

   Exercise through: rendered output plus the API mocks' call arguments
   Test doubles: mocked `../api`, mocked `useFocusSession` returning a loaded board session, mocked `useNavigate`
   Expected RED: the page renders no task content and calls no board-card API

6. Run test — verify FAIL: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`
   Expected failure: the page does not call `api.getCard` or render the card fields.

7. Implement the board task load, then verify PASS: call `api.getCard(workspaceId, session.taskId)` and render only its title/description data. Run `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`.

8. Write a separate failing test for: `Given a tracker-sourced focus session, When the surface loads, Then the tracker title and description are visible`
   Test file: `client/src/pages/FocusPage.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given `source: "tracker"`, `taskKey: "CAM-42"`, Then `api.getWorkItem(workspaceId, "CAM-42")` is called and the item's title and description render; `api.getCard` is not called.
   `FocusSession.taskKey` is `string | null` while `api.getWorkItem` takes a `string`: a tracker session with a null `taskKey` must surface the same calm task-load error as Step 13, not make an unchecked call.
   Exercise through: rendered `FocusPage` and the tracker API call arguments
   Test doubles: mocked `api.getWorkItem`, mocked `useFocusSession` with a tracker session, and mocked `useNavigate`; do not mock the source branch
   Expected RED: only the board source branch exists.

9. Run test — verify FAIL: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`
   Expected failure: the tracker task is not loaded.

10. Implement the tracker task load, then verify PASS: branch on `source`, use the stored tracker key, and route a null `taskKey` into the Step 13 error state rather than calling the API. Run `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`.

11. Write a separate failing test for: `Given task loading fails, When the surface renders, Then a calm error and route back are available`
    Test file: `client/src/pages/FocusPage.test.tsx`
    Level: unit (component, jsdom)

    Test intent:
    Independent RED case A: Given a board task request rejects, Then the page does not crash, shows the creative-brief error register, and exposes a control that navigates back to `/board`. Add an independent tracker rejection case with its own test name and assertion; do not combine the two source failures.
    Exercise through: rendered page after a rejected `api.getCard` or `api.getWorkItem` promise
    Test doubles: mocked API rejection per source, mocked `useFocusSession`, mocked `useNavigate`; do not mock the page error branch
    Expected RED: rejected task loads are unhandled.

12. Run test — verify FAIL: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`
    Expected failure: the rejected promise produces no calm error state.

13. Implement task-load error state, then verify PASS: catch the request failure, render the error and a `/board` route-back control, and keep the provider session intact. Run `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`.

14. Write failing test for: v1 shows only title, description, and timer/controls
   Test file: `client/src/pages/FocusPage.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given a fully populated task — status, priority, labels, assignees, due date, comments, checklist all present on the loaded object
   When the page renders
   Then:
   - title, description, and the timer controls are present
   - the status name, priority name, every label name, every assignee name, and the due date are **absent** from the document
   - no activity or changelog section is rendered

   This is the spec's confirmed v1 scope. It is asserted as an absence because "we just did not build it yet" and "we deliberately keep it out" look identical until something tests it.

   Exercise through: `screen.queryByText` assertions on the rendered document
   Test doubles: mocked `../api` returning a task with every field populated
   Expected RED: fields other than title and description leak into the render

15. Run test — verify FAIL: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`
    Expected failure: fields outside the v1 scope leak into the render.

16. Restrict the render, then verify PASS: keep only title, description, and the explicit `FocusTimer` mount; run `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`.

17. Write failing test for SSE Case A only: board-sourced title refreshes in place on `/focus`
   Test file: `client/src/pages/FocusPage.test.tsx`
   Level: integration

   This is the second cross-unit scenario from Phase 3 Rule 6: the workspace SSE stream must refresh focus content without unmounting the focus surface.

   Test intent:
   Given a board-sourced page showing task T with title "Old title", When the real-shape `card.updated` event `{ type: "card.updated", actor, cardId: 481, payload: { key: "CAM-42" } }` arrives through `subscribeCardEvents`, Then the title becomes "New title", navigation does not occur, and the timer identity is preserved. Tracker refresh is a separate cycle below.

   Exercise through: the same context subscription seam the page uses in production; deliver the literal event payload shape, not a component internal
   Test doubles: test-controlled `subscribeCardEvents` registry on the stubbed `BoardContext`; mocked `../api` with call-ordered `getCard` responses; do NOT mock the page's own refresh handler
   Expected RED: the title stays "Old title" — the page does not subscribe to card updates

18. Run test — verify FAIL for Case A only: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx -t card.updated.refreshes.title`
    Expected failure: the title stays stale and the timer is not proven to remain mounted.

19. Implement the board in-place refresh only: subscribe through `subscribeCardEvents`, reload only the card data, preserve the `FocusTimer` element identity. Do not yet subscribe to tracker updates. Run PASS: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx -t card.updated.refreshes.title`.

19a. Write a failing test for SSE Case B only: tracker-sourced title refreshes in place
    Test file: `client/src/pages/FocusPage.test.tsx`
    Level: integration
    Test intent: Given a tracker-sourced page showing task T with title "Old title", When `{ type: "tracker.updated", trackerItemId: 77 }` arrives through `subscribeTrackerEvents`, Then the tracker title refreshes in place, navigation does not occur, and the timer identity is preserved.
    Exercise through: the `subscribeTrackerEvents` seam with the literal tracker payload. `TrackerEventHandler` is `{ type: string; payload?: unknown; trackerItemId?: number }` — there is **no** `actor` on tracker events (card events do carry one), and `trackerItemId` is optional, so the handler must guard against `undefined` before comparing it.
    Test doubles: test-controlled tracker registry; mocked `../api` with call-ordered `getWorkItem` responses; do not mock the page handler
    Expected RED: Step 19 subscribed only to card events, so a tracker page keeps "Old title"

19b. Run test — verify FAIL for Case B only: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx -t tracker.updated.refreshes.title`
    Expected failure: the tracker title stays stale.

19c. Implement the tracker in-place refresh, then verify PASS: subscribe through `subscribeTrackerEvents`, reload only the work-item data, preserve timer identity. Run `npm run test --workspace=client -- src/pages/FocusPage.test.tsx -t tracker.updated.refreshes.title`, then re-run Case A's `-t` so it stays PASS.

20. Write failing test for: `Given Ready, When Start fails 5xx, Then the page surfaces a retryable error without inventing timer state`
    Test file: `client/src/pages/FocusPage.test.tsx`
    Level: unit (component, jsdom)

    Test intent:
    Given `useFocusSession` reports a Ready session and an `actionError` after a failed Start, When the page renders, Then the exact calm error copy is visible, the session still reads Ready, and the timer receives no running state.
    Exercise through: rendered output
    Test doubles: mocked `useFocusSession` with a controllable `actionError`
    Expected RED: no error is rendered.

21. Run test — verify FAIL: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`
    Expected failure: the error register is absent or the page invents running state.

22. Implement action-error rendering, then verify PASS: render `actionError` near the timer without changing the provider session, and run `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`.

23. Write a separate failing test for: `Given Finish resolves, When the finished payload contains returnPath, Then the user returns to that exact surface`
    Test file: `client/src/pages/FocusPage.test.tsx`
    Level: unit (component, jsdom)

    Test intent:
    Independent GWT case A: Given `returnPath: "/board/card/481"`, When `finish()` resolves with `{ state: "finished", returnPath }` while provider state becomes null, Then `navigate("/board/card/481")` is called and the no-session redirect does not also call `/board`. Independent GWT case B: Given an empty return path, When finish resolves, Then `/board` is the fallback. Keep the two navigation outcomes as separate test cases.

    **The provider's `finish()` resolves with a flat `FocusSession`, not an API envelope.** `FocusSessionContext.tsx` declares `finish: () => Promise<FocusSession>` and `runPatchAction` already destructures `{ session: next }` off the response before returning it. Read `finished.returnPath` — never `finished.session.returnPath`. The mocked `finish` in this test must resolve the same flat shape: a double that resolves `{ session: {...} }` makes the assertion green while production reads `undefined` and falls back to `/board` on every finish, which is exactly the silent failure the SANDWICH exists to prevent.

    The implementation must pass `session`, `pending`, and `start`/`pause`/`resume`/`finish` callbacks to `FocusTimer`; set the finish-transition ref immediately before invoking `finish()` so the redirect effect cannot race it, and clear it in the failure path (Step 3). `pending` is **not** on the context value — `FocusPage` owns a local `pending` flag that it raises around its own action invocations and lowers when they settle.
    Exercise through: rendered `FocusPage`, a controllable `FocusTimer` callback, and the provider's resolved finish payload
    Test doubles: mocked `useFocusSession` with a resolving `finish` and mocked `useNavigate`; inspect the real page-to-timer prop wiring
    Expected RED: Finish does not navigate to the returned path and the timer wiring is implicit.

24. Run test — verify FAIL: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`
    Expected failure: navigation falls back to `/board` or the timer callbacks are not wired.

25. Implement Finish navigation and explicit timer wiring, then verify PASS: mount `<FocusTimer session={session} pending={pending} onStart={start} onPause={pause} onResume={resume} onFinish={handleFinish} />` where `pending` is the page's own local flag; navigate to `finished.returnPath` off the flat `FocusSession` that `finish()` resolves, and use `/board` only when it is empty. Run `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`.

25a. Write a failing test for: `Given Finish fails, When the session is later cleared, Then the no-session redirect still fires`
    Test file: `client/src/pages/FocusPage.test.tsx`
    Level: unit (component, jsdom)

    Test intent:
    Given a Running session, When the mocked `finish()` rejects (the provider's `Error("Finish failed")` after a 5xx), Then no navigation occurs and the rejection does not escape the page; then, when `useFocusSession` is re-rendered reporting `{ session: null, loading: false }` — the state a T13 guard or a retried Finish produces — `navigate("/board", { replace: true })` fires.
    This is the falsifiable half of Step 3's ref-clearing rule; without it, a ref that is only ever set passes every other test in this file.

    Exercise through: the real `FocusTimer` finish callback, then a re-render of the mocked provider value
    Test doubles: mocked `useFocusSession` whose `finish` rejects and whose `session` is controllable across re-renders; mocked `useNavigate`; do not mock the redirect effect
    Expected RED: the finish-transition ref stays set after the rejection, so the later no-session redirect never fires.

25b. Run test — verify FAIL: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx -t failed.finish.does.not.suppress.redirect`
    Expected failure: `expected "navigate" to be called with "/board"` — the redirect is permanently suppressed.

25c. Implement the ref reset from Step 3, then verify PASS: clear the finish-transition ref on the path that does not navigate. Run `npm run test --workspace=client -- src/pages/FocusPage.test.tsx -t failed.finish.does.not.suppress.redirect`, then re-run the whole file so Steps 4 and 23 stay PASS.

26. Register the route: in `client/src/App.tsx`, add `{ path: "focus", lazy: async () => ({ Component: (await import("./pages/FocusPage")).default }) }` inside the `AppLayout` children, matching the `tracker` and `agent` entries exactly. Verify: `npm run test` and `npm run typecheck --workspace=client`.

27. Refactor while green (bounded):
    - Rule of three: the `source`-based task load (`getCard` vs `getWorkItem`) will be needed again by nothing else in this plan — leave it inline in the page rather than pre-extracting
    - If `FocusPage.tsx` crosses ~300 lines, extract the task-content block into `client/src/components/FocusTaskContent.tsx` and add it to the commit
    - `App.tsx` gains only the route entry — no other change
    - Re-run `npm run test --workspace=client -- src/pages/FocusPage.test.tsx` — must stay PASS

28. Commit:
    `git add client/src/pages/FocusPage.tsx client/src/pages/FocusPage.test.tsx client/src/App.tsx`
    If Step 27 extracted `client/src/components/FocusTaskContent.tsx`, additionally run `git add client/src/components/FocusTaskContent.tsx` before committing.
    `git commit -m "feat(focus): add /focus route and focus surface"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Focus entry (`✓ Given no session, When open /focus directly, Then redirect to /board`); rule: Work context (both criteria); rule: Lifecycle (`✗ Start fails 5xx`, `✓ Finish returns the user to the surface they started from`); Implementation Notes on `return_path` and on loading the task via `api.getCard` / `api.getWorkItem` rather than from `BoardContext.columns`
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — a task is loaded by `(source, id)`, never by key alone
- `docs/pocket/rule/creative-brief.md` — **design authority**. Calm, uncluttered surface; type scale (`xl` 31px page heading, `base` 16px body, `sm` 13px meta); neutral surface `neutral-100`; Error Messages register; Empty State tone
- `client/src/App.tsx` (lines ~64–105) — the `lazy: async () => ({ Component })` route convention this task copies
- `client/src/pages/TrackerDetailPage.tsx` — page layout, task loading, and `mockNavigate` test conventions
- `client/src/api.ts` — `getCard(workspaceId, id)` at line ~194, `getWorkItem(workspaceId, key)` at line ~492
- `client/src/context/FocusSessionContext.tsx` (T7) and `client/src/components/FocusTimer.tsx` (T8)

## WHY THIS APPROACH

Complexity: standard
Justification: three files with branching on session presence, task source, load failure, and action failure — plus a redirect whose timing (after load, not during) is easy to get subtly wrong in a way that logs users out of their own focus session.

## SANDWICH CONTEXT

[CRITICAL: the redirect to `/board` fires only when loading has finished, the session is null, AND the transition was not caused by this page's own `finish()`. Redirecting mid-load throws a user with a live focus session back to the board on every refresh; redirecting on a finish sends them to the board instead of the task they came from, silently defeating the `returnPath` the session has carried since T4.]

You are implementing the `/focus` route and focus surface for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — a dedicated calm surface showing only the committed task; v1 context is title + description + timer/controls, nothing else.
Files in scope: `client/src/pages/FocusPage.tsx`, `client/src/pages/FocusPage.test.tsx`, `client/src/App.tsx` — no other files (plus a task-content extraction if Step 27 triggers one).
Test framework: Vitest + `@testing-library/react`, jsdom. Single file: `npm run test --workspace=client -- src/pages/FocusPage.test.tsx`. Test paths are workspace-scoped AND workspace-relative — a root `npm run test -- client/src/...` does NOT filter and exits 1 with `No test files found`, indistinguishable from a real RED. Never quote a multi-word `-t` filter: npm strips the quotes and the run can exit 0 having skipped every test; use an unquoted regex dot per space.
Available after: T8 (`FocusTimer`), T7 (`useFocusSession`, `FocusSession` type), T6 (full server API).
Architecture rule: load the task by `(source, taskId)` — `api.getCard` for board, `api.getWorkItem(key)` for tracker — never from `BoardContext.columns`, never by `key_number` alone (ADR #103). Any task field edit must route through `client/src/lib/workItemMutations.ts`. Client imports carry no extension; `noUnusedLocals` is on. UI decisions come from `docs/pocket/rule/creative-brief.md`.

[RESTATE: redirect only after loading completes and the session is confirmed null — never mid-load, and never on a finish this page initiated.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given no active session, When `/focus` is opened directly, Then the user is redirected to `/board` with no error
Given a focus session on task T, When the surface loads, Then T's title and description are visible along with the timer and controls
Given a session with `source: "board"`, When the page loads the task, Then `api.getCard(workspaceId, taskId)` is used
Given a session with `source: "tracker"`, When the page loads the task, Then `api.getWorkItem(workspaceId, taskKey)` is used and tracker identity is preserved
Given another user updates T's title, When the SSE event arrives, Then the title refreshes in place and the user stays on `/focus` — proven for a board-sourced session (`card.updated`) and a tracker-sourced one (`tracker.updated`)
Given a Ready session and a failed Start, When the page renders, Then a retryable error is shown and the session still reads Ready
Given `returnPath: "/board/card/481"`, When Finish completes, Then the user is navigated to `/board/card/481`
[derived] Given the session is still loading, When the page renders, Then no redirect fires
[derived] Given Finish fails and the session stays populated, When that session is later cleared (a T13 guard, or a second Finish), Then the no-session redirect still fires — the finish-transition ref must not stay set after a failed finish
[derived] Given the task load fails, When the page renders, Then a calm error state with a route back to the board is shown
[must-not] Given a task with status, labels, assignees, and a due date, When the focus surface renders, Then those fields must NOT appear — v1 is title + description + timer/controls
[must-not] Given an SSE task update, When it is applied, Then the page must NOT unmount the timer or reset the running duration

All tests PASS. Commit exists with message matching `feat(focus): add /focus route and focus surface`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Redirect gated on `!loading && session === null`, and suppressed for a finish-initiated transition
- Task loaded by `(source, id)`, not from board state
- SSE task refresh happens in place — the focus surface is never unmounted by it
- Copy and visuals follow `docs/pocket/rule/creative-brief.md`; the route entry in `App.tsx` uses the existing `lazy` convention
- Tests written BEFORE implementation (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- Status, labels, assignees, due date, activity, checklist, comments, or attachments on the surface
- Direct `api.updateCard` / `api.updateTrackerItem` calls — task edits go through `workItemMutations.ts`
- Any change to `BoardContext.tsx` — `subscribeTrackerEvents` already existed and T7 delivered `subscribeCardEvents`; if a needed seam appears to be missing, that is a T7 defect to report, not something to patch here
- Reading the focused task out of `BoardContext.columns`
- Focus API calls made directly instead of through `useFocusSession`

Open question risks:
- Assumption: title and description are read-only in v1. The spec allows inline edit "if offered"; this plan does not offer it. Adding an editor here would pull in `workItemMutations`, conflict handling, and dirty-state tracking — out of scope. If inline edit is wanted, that is a follow-up task → report NEEDS_CONTEXT rather than building it.

Rollback note:
- With `FOCUS_MODE_ENABLED=false`, `useFocusSession` reports no session and this page redirects to `/board` — the route stays registered but is inert. Confirm that path.

Red flags:
- Work outside the listed files → DONE_WITH_CONCERNS
- Extra task fields rendered → STOP
- A redirect that can fire during loading → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: inline title/description editing turns out to be required for v1
Escalate when: the surface appears to need fields the spec defers, or a task edit path that bypasses `workItemMutations.ts`
