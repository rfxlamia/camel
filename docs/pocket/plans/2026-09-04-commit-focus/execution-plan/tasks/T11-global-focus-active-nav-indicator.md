# Task T11 — Global "Focus active" nav indicator

**Phase:** 3
**Depends:** T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 11: Global "Focus active" nav indicator [depends: T7]

## OBJECTIVE

Add a persistent re-entry affordance to the app header: when a focus session is active, a **"Focus active"** control appears and returns the user to `/focus` with the session preserved.

Files:
- Create: `client/src/layout/FocusIndicator.tsx`
- Modify: `client/src/layout/AppLayout.tsx`
- Test: `client/src/layout/FocusIndicator.test.tsx`

It mounts in the header's right-hand cluster beside `PresenceBar` (`AppLayout.tsx` line ~88).

Steps:

1. Write failing test for: `Given an active session and the user on /board, When "Focus active" is clicked, Then they return to /focus with the session preserved`
   Test file: `client/src/layout/FocusIndicator.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given `useFocusSession()` reports an active session in any of Ready, Running, or Paused
   When the component renders
   Then a control labelled **"Focus active"** is present, and clicking it calls `navigate("/focus")`
   And no focus API call is made — re-entry is pure navigation; the provider already holds the session, so returning must never re-fetch or disturb the running timer

   Exercise through: `screen.getByRole("button", { name: /focus active/i })` and `fireEvent.click`

   Test doubles:
   - mock `../context/FocusSessionContext` via `vi.hoisted`; mock `react-router`'s `useNavigate`; mock `../context/BoardContext` for `focusModeEnabled`
   - do NOT mock: the indicator component

   Expected RED:
   - `client/src/layout/FocusIndicator.tsx` does not exist

2. Run test — verify FAIL: `npm run test --workspace=client -- src/layout/FocusIndicator.test.tsx`
   Expected failure: `Failed to resolve import "./FocusIndicator"`

3. Implement minimal code to satisfy the test:
   File: `client/src/layout/FocusIndicator.tsx` — the control and its navigation.

4. Run test — verify PASS: `npm run test --workspace=client -- src/layout/FocusIndicator.test.tsx`

5. Write failing test for: the indicator is absent when there is nothing to return to
   Test file: `client/src/layout/FocusIndicator.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given `session: null`, Then nothing is rendered — a permanently visible chrome element for a feature the user is not using is exactly the ambient pressure this feature is meant to avoid
   And Given `focusModeEnabled: false` with a session somehow present, Then nothing is rendered
   And Given the session is still loading, Then nothing is rendered — no flicker of an indicator that may not apply

   Exercise through: `screen.queryByRole("button", { name: /focus active/i })`
   Test doubles: mocked context in each configuration
   Expected RED: the control renders unconditionally

6. Run test — verify FAIL, implement the gates, verify PASS: `npm run test --workspace=client -- src/layout/FocusIndicator.test.tsx`

7. Mount it: in `client/src/layout/AppLayout.tsx`, render `<FocusIndicator />` in the header's right-hand cluster beside `<PresenceBar />` (line ~88). The file gains the import and the element and nothing else. Verify: `npm run test` and `npm run typecheck --workspace=client`.

8. Refactor while green (bounded):
   - Rule of three: nothing is duplicated three times; no extraction
   - Keep `FocusIndicator.tsx` well under ~300 lines
   - Re-run `npm run test --workspace=client -- src/layout/FocusIndicator.test.tsx` — must stay PASS

9. Commit:
   `git add client/src/layout/FocusIndicator.tsx client/src/layout/FocusIndicator.test.tsx client/src/layout/AppLayout.tsx`
   `git commit -m "feat(focus): add global focus active nav indicator"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — "Story: Global re-entry" (the sole GWT); Scope → In-Scope ("Global **Focus active** indicator in nav for re-entry"); Out-of-Scope ("Focus leaderboard or surveillance-style timer UX")
- `docs/pocket/rule/creative-brief.md` — **design authority**. Badge / Tag or Button — Ghost styling; `sm` 13px label; primary-600 text on transparent, hover `primary-100`; calm, low-pressure presentation
- `client/src/layout/AppLayout.tsx` (lines ~73–91) — the header structure and the `PresenceBar` mount point
- `client/src/context/FocusSessionContext.tsx` (T7) — `useFocusSession()`

## WHY THIS APPROACH

Complexity: lightweight
Justification: one small component plus one mount line; the only judgment is what NOT to show, which is stated explicitly below.

## SANDWICH CONTEXT

[CRITICAL: the indicator renders only when a session actually exists. An always-present focus chrome element turns a deliberate personal tool into ambient pressure — the exact "surveillance-style timer UX" the spec puts out of scope.]

You are implementing the global focus re-entry indicator for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — a dedicated `/focus` surface, with a nav affordance so the user can leave and come back without losing the session.
Files in scope: `client/src/layout/FocusIndicator.tsx`, `client/src/layout/FocusIndicator.test.tsx`, `client/src/layout/AppLayout.tsx` — no other files.
Test framework: Vitest + `@testing-library/react`, jsdom. Single file: `npm run test --workspace=client -- src/layout/FocusIndicator.test.tsx`. Test paths are workspace-scoped AND workspace-relative — a root `npm run test -- client/src/...` does NOT filter and exits 1 with `No test files found`, indistinguishable from a real RED. Never quote a multi-word `-t` filter: npm strips the quotes and the run can exit 0 having skipped every test; use a regex dot per space.
Available after: T7 (provider). Runs in parallel with T8 and T12 — see Parallelizable Groups.
Architecture rule: read session state through `useFocusSession()` only — no `api` import, no lifecycle mutations. This control navigates; it never starts, pauses, or finishes anything. Client imports carry no extension. UI decisions come from `docs/pocket/rule/creative-brief.md`.

[RESTATE: render nothing unless a session exists — no persistent focus chrome.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given an active session and the user navigated to `/board`, When "Focus active" is clicked, Then the user returns to `/focus` and the session is preserved
[derived] Given no active session, When the header renders, Then no indicator appears
[derived] Given the session is still loading, When the header renders, Then no indicator appears
[must-not] Given `focusModeEnabled: false`, When the header renders, Then the indicator must NOT appear
[must-not] Given the indicator is clicked, When re-entry happens, Then it must NOT call a focus API endpoint or mutate the session

All tests PASS under an unfiltered `npm run test`. Commit exists with message matching `feat(focus): add global focus active nav indicator`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Exact spec copy: "Focus active"
- Rendered only when a session exists, loading has settled, and the flag is on
- Reachable by accessible role and name
- `AppLayout.tsx` gains only the import and the element
- Tests written BEFORE implementation (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- Lifecycle controls in the nav — Start/Pause/Resume/Finish live on the focus surface
- Any other member's focus state — this is a personal indicator
- Productivity scoring, streaks, or idle callouts
- Focus API calls

Open question risks:
- Assumption: the indicator shows a label only, not a live duration. A ticking clock in persistent chrome pulls toward the surveillance UX the spec rejects. If a duration is wanted, it is an additive change to this component → not a blocker.

Rollback note:
- Flag off ⇒ nothing renders; `AppLayout` is otherwise unchanged.

Red flags:
- Work outside the three listed files → DONE_WITH_CONCERNS
- An always-visible indicator → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: a live duration in the nav is requested
Escalate when: re-entry appears to require re-fetching or mutating the session
