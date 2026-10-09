# Task T12 — Workspace switch guard

**Phase:** 3
**Depends:** T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 12: Workspace switch guard [depends: T7]

## OBJECTIVE

Block a workspace switch while focus state is still hydrating or any focus session is active (Ready, Running, or Paused) and tell the user what to do. Extend the existing pure guard `getSwitchAttemptState` rather than adding a second gate somewhere else.

Files (six — this list, the scope line, and the `git add` in Step 12 must stay identical):
- Modify: `client/src/lib/workspaceSwitcher.ts`
- Modify: `client/src/layout/sidebar/WorkspaceSwitcher.tsx`
- Modify: `client/src/context/BoardContext.tsx`
- Test: `client/src/lib/workspaceSwitcher.test.ts` (exists — extend it)
- Test: `client/src/layout/sidebar/WorkspaceSwitcher.test.tsx` (**Create** — does not exist yet)
- Test: `client/src/context/BoardContext.focusGuard.test.tsx` (Create)

`getSwitchAttemptState` has **two** callers — `BoardContext.tsx` (~line 373) and `WorkspaceSwitcher.tsx` (~line 115). Both must forward the new inputs, which is why the switcher component and its new test file are in scope.

**Wiring, decided here so it is not rediscovered mid-task.** `BoardProvider` is the parent of `FocusSessionProvider`, so it cannot read focus state directly. T7 owns and initializes `hasActiveFocusSession`, `focusSessionHydrated`, and their setters in `BoardContext`, and its provider effects drive those setters. This task consumes that plumbing only: add the pure guard inputs and the context routing/blocked branches. No task in T12 may redefine the fields, add a second effect, or edit `FocusSessionContext.tsx`.

Steps:

1. Write failing test for: `Given any active session, When a workspace switch is attempted, Then it is blocked until Finish`
   Test file: `client/src/lib/workspaceSwitcher.test.ts`
   Level: unit

   Test intent:
   Given `getSwitchAttemptState({ activeWorkspaceId: 1, targetWorkspaceId: 2, hasUnsavedCardEdits: false, hasActiveFocusSession: true, focusSessionHydrated: true })`
   Then the result is `{ status: "focus-blocked" }` — a distinct status from `confirm-required`, because this one has no "switch anyway" path: the user must finish focus
   And Given `focusSessionHydrated: false`, Then the result is `{ status: "focus-loading" }` — the provider has not proved that the target workspace is safe to enter yet
   And Given `hasActiveFocusSession: false`, `focusSessionHydrated: true`, and no unsaved edits, Then the result is `{ status: "switch", workspaceId: 2 }` as today
   And Given both `hasActiveFocusSession: true` and `hasUnsavedCardEdits: true` with hydration complete, Then the focus block wins — it is the guard the user cannot dismiss
   And Given `activeWorkspaceId === targetWorkspaceId` with a session active, Then the result is `{ status: "noop" }` — switching to the workspace you are already in is not a switch

   Exercise through: the exported `getSwitchAttemptState` function
   Test doubles: none — pure function
   Expected RED: `hasActiveFocusSession` and `focusSessionHydrated` are not part of `SwitchAttemptInput`; the existing signature ignores them and returns `{ status: "switch" }`

2. Run test — verify FAIL: `npm run test --workspace=client -- src/lib/workspaceSwitcher.test.ts`
   Expected failure: `expected { status: 'switch', workspaceId: 2 } to deeply equal { status: 'focus-blocked' }`

3. Implement minimal code to satisfy the test:
   File: `client/src/lib/workspaceSwitcher.ts` — add `hasActiveFocusSession: boolean` and `focusSessionHydrated: boolean` to `SwitchAttemptInput`; add `{ status: "focus-loading" }` and `{ status: "focus-blocked" }` to the union; check `noop` first, then hydration, then the active-session block, then unsaved edits.

4. Run test — verify PASS: `npm run test --workspace=client -- src/lib/workspaceSwitcher.test.ts`

5. Write a failing test for: `Given the BoardContext focus flags, When WorkspaceSwitcher selects a target, Then it forwards both flags to the pure guard`
   Test file: `client/src/layout/sidebar/WorkspaceSwitcher.test.tsx` — **create this file**; the sidebar has no test for this component today (only `navItems.test.ts` and `useSidebarMode.test.tsx` exist there)
   Level: unit (component, jsdom)

   Test intent:
   Given `useBoard()` returns `hasActiveFocusSession: true` and `focusSessionHydrated: false`, When the workspace switcher opens and workspace 2 is selected, Then `getSwitchAttemptState` receives both flags and the component does not invent a second guard or confirmation path. The existing `attemptSwitchWorkspace(2)` remains the single effectful call.
   Exercise through: the rendered `WorkspaceSwitcher` and its accessible workspace button/menu option
   Test doubles: `vi.hoisted` mocks for `useBoard`, `workspaceSwitcher` helpers, and invite actions; render the real `WorkspaceSwitcher`
   Expected RED: `WorkspaceSwitcher.tsx` calls `getSwitchAttemptState` without the new focus fields.

6. Run test — verify FAIL: `npm run test --workspace=client -- src/layout/sidebar/WorkspaceSwitcher.test.tsx`
   Expected failure: the helper was called without `hasActiveFocusSession` and `focusSessionHydrated`.

7. Implement the component wiring, then verify PASS: in `client/src/layout/sidebar/WorkspaceSwitcher.tsx`, destructure both flags from `useBoard()` and pass them to `getSwitchAttemptState`; do not add a second block in the component. Run `npm run test --workspace=client -- src/layout/sidebar/WorkspaceSwitcher.test.tsx`.

   **Dropdown behavior on the new statuses — decided here.** The component's existing line reads `if (state.status !== "confirm-required") setOpen(false);`. Leave that condition exactly as it is: on `focus-blocked` and `focus-loading` the dropdown **closes** and the user reads the warning toast the context raises. Keeping the menu open would imply another workspace is selectable, which is the opposite of what the guard means. Assert this in the new test — do not treat it as incidental.

8. Write failing test for: the guard is wired end to end and the user is told what to do
   Test file: `client/src/context/BoardContext.focusGuard.test.tsx`
   Level: integration

   Test intent:
   Independent integration cases:
   - Case A: Given a `BoardProvider` whose `hasActiveFocusSession` is `true`, When `attemptSwitchWorkspace(2)` is called, Then the active and persisted workspace remain unchanged and a calm finish-first warning appears.
   - Case B: Given `hasActiveFocusSession` is `false` and hydration is complete, When `attemptSwitchWorkspace(2)` is called, Then the switch proceeds as before.
   The cases have separate test names and RED/PASS assertions.

   Exercise through:
   - a probe component calling `useBoard()` inside `BoardProvider`, driving `setHasActiveFocusSession` then `attemptSwitchWorkspace`

   Test doubles:
   - mocked `../api` via `vi.hoisted`; `MockEventSource` stub as in `client/src/context/BoardContext.viewMode.test.tsx`
   - do NOT mock: `getSwitchAttemptState` — the point is that the context actually routes through the pure guard

   Expected RED:
   - the switch goes through; `activeWorkspaceId` becomes 2

9. Run test — verify FAIL: `npm run test --workspace=client -- src/context/BoardContext.focusGuard.test.tsx`
   Expected failure: `expected 2 to be 1`

10. Implement:
   File: `client/src/context/BoardContext.tsx` — consume the T7-owned `hasActiveFocusSession` and `focusSessionHydrated` values, pass both flags into `getSwitchAttemptState` inside `attemptSwitchWorkspace`, and handle `status: "focus-loading"` and `status: "focus-blocked"` with calm warnings and an immediate return without switching. Do not add or modify the provider effects; T7 owns those.
   Verify PASS: `npm run test --workspace=client -- src/context/BoardContext.focusGuard.test.tsx`.

11. Refactor while green (bounded):
   - Rule of three: the guard logic stays in the pure `workspaceSwitcher.ts` function — resist adding a second check inside `WorkspaceSwitcher.tsx` or the sidebar; one gate, one place
   - `BoardContext.tsx` gains only the guard arguments and two blocked branches; the flags/setters/effects remain T7-owned
   - `WorkspaceSwitcher.tsx` only forwards context inputs to the pure guard; it has no focus policy
   - Re-run `npm run test --workspace=client -- src/lib/workspaceSwitcher.test.ts`, `npm run test --workspace=client -- src/layout/sidebar/WorkspaceSwitcher.test.tsx`, and `npm run test --workspace=client -- src/context/BoardContext.focusGuard.test.tsx`, plus the full client suite — all must stay PASS

12. Commit:
    `git add client/src/lib/workspaceSwitcher.ts client/src/lib/workspaceSwitcher.test.ts client/src/layout/sidebar/WorkspaceSwitcher.tsx client/src/layout/sidebar/WorkspaceSwitcher.test.tsx client/src/context/BoardContext.tsx client/src/context/BoardContext.focusGuard.test.tsx`
   `git commit -m "feat(focus): block workspace switch while a focus session is active"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Guards (`✓ Given any session state, When workspace switch attempted, Then blocked until Finish`); "Story: Workspace and access guards"; Implementation Notes ("extend `getSwitchAttemptState` (`workspaceSwitcher.ts`) with `hasActiveFocusSession` — block until Finish"); Open Questions row on workspace switch + unsaved card edits
- `client/src/lib/workspaceSwitcher.ts` (lines 6–41) — `SwitchAttemptInput`, `SwitchAttemptState`, `getSwitchAttemptState`
- `client/src/lib/workspaceSwitcher.test.ts` — the existing pure-function test file to extend
- `client/src/context/BoardContext.tsx` (lines ~72–73, ~340–402) — `hasUnsavedCardEdits` / `setHasUnsavedCardEdits` and `attemptSwitchWorkspace`, the pattern this task mirrors
- `client/src/context/BoardContext.viewMode.test.tsx` — `MockEventSource` needed to render `BoardProvider`
- `docs/pocket/rule/creative-brief.md` — Copy Guidelines, neutral-friendly register for the blocking message

## WHY THIS APPROACH

Complexity: standard
Justification: five files, but each change is small; the judgment is in guard precedence (focus beats unsaved edits) and in the parent/child wiring, both settled above.

## SANDWICH CONTEXT

[CRITICAL: the focus block is not dismissible. Unlike `hasUnsavedCardEdits`, which offers "confirm and switch anyway", an active focus session must be Finished first — switching away would strand a running server-side timer in a workspace the user is no longer in.]

You are implementing the workspace switch guard for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — workspace-scoped personal sessions; leaving the workspace requires finishing focus.
Files in scope: `client/src/lib/workspaceSwitcher.ts`, `client/src/lib/workspaceSwitcher.test.ts`, `client/src/layout/sidebar/WorkspaceSwitcher.tsx`, `client/src/layout/sidebar/WorkspaceSwitcher.test.tsx`, `client/src/context/BoardContext.tsx`, `client/src/context/BoardContext.focusGuard.test.tsx` — no other files; T7 owns the provider fields/effects consumed here.
Test framework: Vitest + `@testing-library/react`, jsdom. Commands: `npm run test --workspace=client -- src/lib/workspaceSwitcher.test.ts` and `npm run test --workspace=client -- src/context/BoardContext.focusGuard.test.tsx`. Test paths are workspace-scoped AND workspace-relative — a root `npm run test -- client/src/...` does NOT filter and exits 1 with `No test files found`, indistinguishable from a real RED. Never quote a multi-word `-t` filter: npm strips the quotes and the run can exit 0 having skipped every test; use a regex dot per space.
Available after: T7 (provider plus parent focus flags/hydration setters). Runs in parallel with T8 and T11 — see Parallelizable Groups.
Architecture rule: the decision lives in the pure function in `workspaceSwitcher.ts`; the context only routes to it and reacts. `BoardProvider` never imports `FocusSessionContext` — state flows up via the setter, as `hasUnsavedCardEdits` already does. Client imports carry no extension.

[RESTATE: `focus-blocked` has no "switch anyway" path — the user must Finish focus first.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given an active session in any state (Ready, Running, or Paused) in workspace W1, When a switch to W2 is attempted, Then the switch is blocked and the user is told to finish focus first
[derived] Given no active session and no unsaved edits, When a switch is attempted, Then it proceeds unchanged
[derived] Given both an active session and unsaved card edits, When a switch is attempted, Then the focus block takes precedence
[derived] Given the target workspace is the active one, When a switch is attempted with a session active, Then the result is `noop`
[derived] Given `WorkspaceSwitcher` renders with both focus flags from `useBoard()`, When a workspace is selected, Then `getSwitchAttemptState` receives `hasActiveFocusSession` and `focusSessionHydrated`
[derived] Given a `focus-blocked` or `focus-loading` result, When the switcher handles it, Then the dropdown closes — only `confirm-required` keeps it open
[must-not] Given a blocked switch, When it is refused, Then `activeWorkspaceId` and the persisted workspace id must NOT change
[must-not] Given a blocked switch, When the user is informed, Then the UI must NOT offer a "switch anyway" path

All tests PASS under an unfiltered `npm run test`. Commit exists with message matching `feat(focus): block workspace switch while a focus session is active`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- One gate, in the pure `getSwitchAttemptState` — not duplicated in the switcher component or sidebar
- Focus block takes precedence over the unsaved-edits confirm
- A visible message, not a silent no-op
- Tests written BEFORE implementation (TDD — not after)
- Unmount-clear of `hasActiveFocusSession` / `focusSessionHydrated` stays in T7 Step 18 — do not reopen `FocusSessionContext.tsx` to add it here
- Commit message follows conventional commits format

Must-not-have:
- `BoardContext` importing `FocusSessionContext` — that inverts the provider tree
- A second focus check anywhere outside `getSwitchAttemptState`; T12 does not add a provider-side check
- Auto-finishing the session to let a switch through — the user decides
- Blocking navigation between routes inside the same workspace; only workspace switching is guarded

Open question risks:
- Assumption: focus and unsaved-edits guards stay separate, with focus winning. The spec's open question floats a combined dialog if both fire; this plan takes precedence over combination → note it, do not build the combined dialog.

Rollback note:
- Flag off ⇒ no session is ever created ⇒ `hasActiveFocusSession` stays `false` and switching behaves exactly as it does today. Verify rather than assume.

Red flags:
- Work outside the six listed files → DONE_WITH_CONCERNS
- A dismissible focus block → STOP
- `BoardContext` importing the focus provider → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: a combined focus + unsaved-edits dialog is required
Escalate when: the guard appears to need `BoardContext` to read focus state directly
