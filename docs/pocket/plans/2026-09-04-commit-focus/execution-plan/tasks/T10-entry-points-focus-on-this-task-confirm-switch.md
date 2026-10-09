# Task T10 — Entry points — "Focus on this task" + confirm-switch

**Phase:** 4
**Depends:** T6, T9
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 10: Entry points — "Focus on this task" + confirm-switch [depends: T6, T9]

## OBJECTIVE

Add the entry into focus mode from both task surfaces: a shared `FocusEntryButton` mounted in `ContextPanel` (board card detail) and in the `TrackerDetailPage` header, which commits the task, handles the confirm-then-switch flow when another session is already active, and navigates to `/focus`.

Files:
- Create: `client/src/components/FocusEntryButton.tsx`
- Modify: `client/src/components/ContextPanel.tsx`
- Modify: `client/src/pages/TrackerDetailPage.tsx`
- Test: `client/src/components/FocusEntryButton.test.tsx`

One component, two mount sites. There is no standalone board card menu today (`CardView.tsx` only opens the panel), so the board entry lives in the panel — this is the spec's confirmed placement, not a shortcut.

```
type FocusEntryButtonProps = { source: WorkItemSource; taskId: number; taskKey?: string | null };
```

Steps:

1. Write failing test for: `Given board card C, When "Focus on this task", Then /focus shows C, Ready, source+id persisted`
   Test file: `client/src/components/FocusEntryButton.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given no active session and `focusModeEnabled: true`
   When the button labelled **"Focus on this task"** is clicked with `{ source: "board", taskId: 481 }`
   Then `focus({ source: "board", taskId: 481 })` from `useFocusSession()` was called, and on resolution `navigate("/focus")` was called
   Exercise through:
   - `screen.getByRole("button", { name: /focus on this task/i })` and `fireEvent.click`

   Test doubles:
   - mock `../context/FocusSessionContext` via `vi.hoisted`, exposing `focus`, `switchTo`, `session`
   - mock `react-router`'s `useNavigate`; mock `../context/BoardContext`'s `useBoard` for `focusModeEnabled` and `showToast`
   - do NOT mock: the button component itself

   Expected RED:
   - `client/src/components/FocusEntryButton.tsx` does not exist

2. Run test — verify FAIL: `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`
   Expected failure: `Failed to resolve import "./FocusEntryButton"`

3. Implement the board focus flow, then verify PASS: in `FocusEntryButton.tsx`, call `focus({ source: "board", taskId: 481 })` and navigate to `/focus` only after it resolves. Run `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`.

4. Write a separate failing test for: `Given tracker item T, When "Focus on this task", Then the tracker source and id are preserved`
   Test file: `client/src/components/FocusEntryButton.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given no active session and `focusModeEnabled: true`, When clicked with `{ source: "tracker", taskId: 77, taskKey: "CAM-42" }`, Then `focus({ source: "tracker", taskId: 77 })` is called and successful resolution navigates to `/focus`.
   Exercise through: `screen.getByRole("button", { name: /focus on this task/i })` and the tracker click path
   Test doubles: mocked `useFocusSession` with `focus`/navigation spies and `useBoard` with the flag enabled; do not mock the button
   Expected RED: the board-only fixture/path does not yet prove the tracker identity.

5. Run test — verify FAIL: `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`
   Expected failure: tracker source is not preserved.

6. Implement the source-agnostic entry props, then verify PASS: reuse the same `focus` call for board and tracker without direct API access. Run `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`.

7. Write failing test for: `Given Ready session on task T, When focus on T again, Then navigate to /focus without a confirmation dialog`
   Test file: `client/src/components/FocusEntryButton.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given an active session already on `{ source: "board", taskId: 481 }`
   When the button is clicked for that same task
   Then `navigate("/focus")` was called, no dialog was rendered, and the session's state and accumulated time are unchanged — re-entering focus on the task you are already focused on must never cost the user their running timer

   Exercise through: the click handler and the absence of a dialog in the document
   Test doubles: mocked context reporting an active session on the same task
   Expected RED: the component asks the server unconditionally and a dialog appears, or the timer resets

8. Run test — verify FAIL: `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`
   Expected failure: the component calls the server or renders a dialog for the same task.

9. Implement the same-task short circuit, then verify PASS: compare `source` and `taskId`, navigate directly, and never call `focus` or `switchTo`. Run `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`.

10. Write failing test for: `Given Running on A, When focus on B and confirm, Then the dialog precedes switch and B starts only after confirmation`
   Test file: `client/src/components/FocusEntryButton.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given an active Running session on task A
   When the button is clicked for a different task B
   Then:
   - a confirmation dialog appears naming what happens — the current focus is finished and its time is kept — in the creative brief's neutral-friendly register
   - before confirmation, `switchTo` has not been called
   - when the user confirms, `switchTo({ source, taskId: B, version })` is called and `navigate("/focus")` follows

   `version` is the **currently active session's** `version` — the server's optimistic lock is against the session being replaced, not against B. After `focus()` rejects 409 `session_active` the provider has already adopted that session (`runPost` calls `adoptSession(err.session ?? null)` before rethrowing), so `session.version` from `useFocusSession()` is the correct source. The mocked context fixture must therefore carry a `version`.

   Exercise through: click → dialog → confirm/cancel buttons, by accessible role and name
   Test doubles: mocked context whose `focus` can be made to reject with a 409; `vi.fn()` for `switchTo` and `navigate`
   Expected RED: clicking on a different task calls `focus` and surfaces a raw error, with no dialog

11. Run test — verify FAIL: `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`
    Expected failure: no confirmation dialog appears or `switchTo` is called before confirmation.

12. Implement the confirm-switch dialog and confirmed path, then verify PASS: render an accessible dialog with neutral copy, call `switchTo` only from its confirm action — passing the active session's `version` — and navigate after it resolves. Run `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`.

13. Write a separate failing test for: `Given Paused session on A, When focus on B is cancelled, Then A remains untouched`
    Test file: `client/src/components/FocusEntryButton.test.tsx`
    Level: unit (component, jsdom)

    Test intent:
    Given a Paused session on task A, When the user opens the dialog for B and clicks **Cancel**, Then `switchTo` and `navigate` are not called and the session fixture remains Paused with the same accumulated time.
    Exercise through: click the real dialog's accessible **Cancel** button after opening it for B
    Test doubles: mocked context with a Paused session and spies for `switchTo`/navigate; do not mock the dialog branch
    Expected RED: the cancel path is absent or mutates the session.

14. Run test — verify FAIL: `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`
    Expected failure: cancel invokes the switch or navigation.

15. Implement the cancel path, then verify PASS: close the dialog without calling any provider action and run `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`.

16. Write a separate failing test for: `Given focus() rejects 409 session_active, When the click is handled, Then the confirmation dialog appears`
    Test file: `client/src/components/FocusEntryButton.test.tsx`
    Level: unit (component, jsdom)

    Test intent:
    Given `focus()` rejects an `ApiError` with status 409 and `code: "session_active"` carrying the current session, Then the component opens the same confirmation dialog instead of showing a raw error; it still does not call `switchTo` before confirmation.
    Exercise through: click the real entry button and query the accessible confirmation dialog
    Test doubles: mocked context whose `focus` rejects with a typed `ApiError(409, "session_active")`; mocked `useBoard` flag-on and `useNavigate`; do not mock the component
    Expected RED: the rejection is surfaced as a generic error.

17. Run test — verify FAIL: `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`
    Expected failure: the dialog is not opened for `session_active`.

18. Implement explicit `session_active` handling, then verify PASS: distinguish it from `version_conflict`, reuse the confirmation UI, and leave all other errors in the normal error path. Run `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`.

19. Write failing test for: the entry is hidden when the feature is off
   Test file: `client/src/components/FocusEntryButton.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given `focusModeEnabled: false` on `BoardContext`
   When the component renders
   Then nothing is rendered — no button, no placeholder. This is the client half of the Rollback Plan; without it, disabling the flag leaves a visible button that 404s.

   Exercise through: `screen.queryByRole("button", { name: /focus on this task/i })`
   Test doubles: mocked `useBoard` with the flag off
   Expected RED: the button renders regardless of the flag

20. Run test — verify FAIL: `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`
    Expected failure: the button renders despite the flag being false.

21. Implement the flag gate, then verify PASS: render nothing when `focusModeEnabled` is false. Run `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`.

22. Mount at both entry points:
    - `client/src/components/ContextPanel.tsx` — render `<FocusEntryButton source="board" taskId={card.id} taskKey={...} />` in the panel header action row, beside the existing actions (the `ticketIntakeEnabled` blocks around lines 367–414 show the established placement and gating style)
    - `client/src/pages/TrackerDetailPage.tsx` — render `<FocusEntryButton source="tracker" taskId={item.id} taskKey={item.key} />` in the existing sticky breadcrumb/header strip beside the item key (the current block is around lines 438–466; it is a breadcrumb, not an action row)
    - Each file gains the import and the element and nothing else — no focus logic inline
    - Verify no regression: `npm run test` and `npm run typecheck --workspace=client`

23. Refactor while green (bounded):
    - Rule of three: the "is this the task the session already targets" comparison exists here and on the server (T4, T6). One client-side copy is correct — do not try to share code across the network boundary
    - Keep `FocusEntryButton.tsx` under ~300 lines; if the dialog grows past a simple confirm, extract `FocusSwitchDialog.tsx` and add it to the commit
    - `ContextPanel.tsx` and `TrackerDetailPage.tsx` are already 650+ lines: add only the import and the element
    - Re-run `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx` — must stay PASS

24. Commit:
    `git add client/src/components/FocusEntryButton.tsx client/src/components/FocusEntryButton.test.tsx client/src/components/ContextPanel.tsx client/src/pages/TrackerDetailPage.tsx`
    If Step 23 extracted `client/src/components/FocusSwitchDialog.tsx`, additionally run `git add client/src/components/FocusSwitchDialog.tsx` before committing.
    `git commit -m "feat(focus): add focus entry points with confirm-switch"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Focus entry (board and tracker criteria); rule: Switch task (both criteria); "Story: Focus on a task" incl. idempotent re-focus; Scope → In-Scope on entry placement ("there is no standalone board card menu today"); Implementation Notes on user-facing copy
- `docs/pocket/rule/creative-brief.md` — **design authority**. Button — Secondary for the entry action (`bg-neutral-100`, `text-primary-700`, `border-neutral-300`, radius 6px); CTA style ("Not now" / "Cancel" for secondary actions); neutral-friendly register for the dialog copy
- `client/src/components/ContextPanel.tsx` (lines ~367–414) — flag-gated action placement in the panel header
- `client/src/pages/TrackerDetailPage.tsx` (lines ~438–466) — the existing sticky breadcrumb/header strip where the tracker entry is mounted
- `client/src/context/FocusSessionContext.tsx` (T7) — `useFocusSession()`, `focus`, `switchTo`
- `client/src/types.ts` — `WorkItemSource`

## WHY THIS APPROACH

Complexity: standard
Justification: four files and a three-way branch on click (same task, no session, different session), plus a dialog whose cancel path must provably leave a running timer alone.

## SANDWICH CONTEXT

[CRITICAL: clicking "Focus on this task" while another task is focused must never silently replace the session. The plain `focus` action is refused by the server with 409 `session_active`; only an explicit user confirmation may trigger `switchTo`. Skipping the dialog throws away time the user actually worked.]

You are implementing the focus entry points for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — entry from board card detail and tracker detail; confirm-then-switch when replacing an active session.
Files in scope: `client/src/components/FocusEntryButton.tsx`, `client/src/components/FocusEntryButton.test.tsx`, `client/src/components/ContextPanel.tsx`, `client/src/pages/TrackerDetailPage.tsx` — no other files (plus a dialog extraction if Step 12 triggers one).
Test framework: Vitest + `@testing-library/react`, jsdom. Single file: `npm run test --workspace=client -- src/components/FocusEntryButton.test.tsx`. Test paths are workspace-scoped AND workspace-relative — a root `npm run test -- client/src/...` does NOT filter and exits 1 with `No test files found`, indistinguishable from a real RED. Never quote a multi-word `-t` filter: npm strips the quotes and the run can exit 0 having skipped every test; use an unquoted regex dot per space.
Available after: T9 (`/focus` route exists to navigate to), T6 (server `switch` action), T7 (provider).
Architecture rule: all focus API access goes through `useFocusSession()`. `ContextPanel.tsx` and `TrackerDetailPage.tsx` receive an import and an element — no focus logic inline. Client imports carry no extension; `noUnusedLocals` is on. UI decisions come from `docs/pocket/rule/creative-brief.md`.

[RESTATE: replacing an active session requires explicit user confirmation — never an implicit switch.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given board card C, When "Focus on this task" is clicked, Then a Ready session on C is created and the user lands on `/focus`
Given tracker item T, When "Focus on this task" is clicked, Then the session preserves `source: "tracker"`
Given a Ready session on task T, When "Focus on this task" is clicked on T again, Then the user navigates to `/focus` with no confirmation dialog and the session is unchanged
Given a Running session on task A, When the user focuses task B and confirms, Then `switchTo` is called and the user lands on `/focus`
Given a Paused session on task A, When the user attempts to focus B but cancels, Then session A remains Paused, unchanged, and no navigation occurs
[derived] Given `focus()` rejects with 409 `session_active`, When the click is handled, Then the confirmation dialog is shown rather than a raw error
[must-not] Given `focusModeEnabled: false`, When either surface renders, Then the entry button must NOT appear
[must-not] Given an active session on a different task, When the entry is clicked, Then the component must NOT call `switchTo` before the user confirms

All tests PASS. Commit exists with message matching `feat(focus): add focus entry points with confirm-switch`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Exact spec copy: "Focus on this task"
- Confirmation dialog before any switch; cancel leaves the existing session untouched
- Same-task click short-circuits without a server round trip that could reset the timer
- Flag gate hides the entry entirely when focus mode is off
- Both mount sites gain only an import and an element
- Dialog and button reachable by accessible role and name
- Tests written BEFORE implementation (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- The word "Commit" in any user-facing string
- Direct `api.focus.*` calls — everything goes through `useFocusSession()`
- Focus logic inside `ContextPanel.tsx` or `TrackerDetailPage.tsx`
- Changes to `CardView.tsx` or board layout — the entry lives in the detail surfaces
- A browser `confirm()` — use an in-app dialog consistent with the creative brief

Open question risks:
- Assumption: the confirm dialog is owned by this component. If the workspace-switch dialog (T12) and this one must merge into one combined prompt when both guards fire, that is a follow-up → report NEEDS_CONTEXT rather than restructuring both.

Rollback note:
- With `FOCUS_MODE_ENABLED=false` both entry points disappear, which is the Rollback Plan's user-visible half. Verify explicitly on both surfaces.

Red flags:
- Work outside the listed files → DONE_WITH_CONCERNS
- A switch without confirmation → STOP
- Focus logic added inline to a 650-line file → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: the two confirmation dialogs need to merge
Escalate when: entry placement appears to require a board card menu that does not exist
