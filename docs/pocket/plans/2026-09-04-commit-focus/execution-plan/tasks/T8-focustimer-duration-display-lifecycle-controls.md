# Task T8 — `FocusTimer` — duration display + lifecycle controls

**Phase:** 3
**Depends:** T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 8: `FocusTimer` — duration display + lifecycle controls [depends: T7]

## OBJECTIVE

Build the presentational timer component: it renders active time from `accumulatedSeconds` + `runningSince`, ticks once per second while Running, stays static while Ready or Paused, and renders the controls legal for the current state.

Files:
- Create: `client/src/components/FocusTimer.tsx`
- Test: `client/src/components/FocusTimer.test.tsx`

Props only — no data fetching, no `useFocusSession` call. The page (T9) wires the hook to this component. That is what makes every timing assertion here deterministic.

```
type FocusTimerProps = {
  session: FocusSession;
  onStart: () => void; onPause: () => void; onResume: () => void; onFinish: () => void;
  pending?: boolean;
};
```

Steps:

1. Write failing test for: a Running session's display advances with the clock
   Test file: `client/src/components/FocusTimer.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given `vi.useFakeTimers()` with system time at `T0`, and a session whose `runningSince` is the **ISO string** the server sends (`T0.toISOString()`) — matching the Shared Contract DTO and every other timestamp in `client/src/types.ts` — so `{ state: "running", accumulatedSeconds: 1200, runningSince: "<T0 ISO>" }`
   When the component renders and the clock advances 90 seconds
   Then:
   - the initial display reads `20:00` (1200s)
   - after the advance it reads `21:30` (1290s) — derived from `runningSince`, never from counting ticks, so a throttled background tab still shows the right number
   - the format is `MM:SS` under an hour and `H:MM:SS` at or above it

   Exercise through:
   - the rendered output, queried by `screen.getByText` / a `data-testid` on the duration element

   Test doubles:
   - `vi.useFakeTimers()` + `vi.setSystemTime()`; restore with `vi.useRealTimers()` in `afterEach`
   - do NOT mock: the component's own duration computation

   Expected RED:
   - `client/src/components/FocusTimer.tsx` does not exist

2. Run test — verify FAIL: `npm run test --workspace=client -- src/components/FocusTimer.test.tsx`
   Expected failure: `Failed to resolve import "./FocusTimer"`

3. Implement minimal code to satisfy the test:
   File: `client/src/components/FocusTimer.tsx` — a `useEffect` interval that only bumps a re-render counter while `state === "running"`, with the displayed value computed each render as `accumulatedSeconds + (now - Date.parse(runningSince)) / 1000`. Parse the ISO string; do not type the prop as a `Date`. A `Date`-typed fixture would make this cycle pass on a shape the server never sends, and the live display would render `NaN`. Clear the interval on unmount and whenever state leaves Running.

4. Run test — verify PASS: `npm run test --workspace=client -- src/components/FocusTimer.test.tsx`

5. Write failing test for: a Paused session does not advance
   Test file: `client/src/components/FocusTimer.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Independent RED case B: Given `{ state: "paused", accumulatedSeconds: 900, runningSince: null }`, When 10 minutes of fake time pass, Then the display still reads `15:00` and no interval remains scheduled (`vi.getTimerCount()` is 0). Ready is a separate case below.

   Exercise through: rendered output plus `vi.getTimerCount()`
   Test doubles: fake timers
   Expected RED: the interval runs regardless of state, or the paused display drifts

6. Run test — verify FAIL for the Paused case, gate the interval on `state === "running"`, then verify PASS for that case: `npm run test --workspace=client -- src/components/FocusTimer.test.tsx -t Paused`

6a. Write/run a separate RED→implementation→PASS case for Ready: `{ state: "ready", accumulatedSeconds: 0, runningSince: null }` renders `00:00` and schedules no interval.
    Test file: `client/src/components/FocusTimer.test.tsx`
    Level: unit (component, jsdom)
    Exercise through: rendered Ready timer and `vi.getTimerCount()`
    Test doubles: fake timers with system time fixed; do not mock the component
    Expected RED: the component still schedules an interval or does not render the Ready duration.
    Run test after implementation: `npm run test --workspace=client -- src/components/FocusTimer.test.tsx -t Ready`

7. Write independent failing test cases for: controls match each session state
   Test file: `client/src/components/FocusTimer.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Three independent GWT cases with separate test names: Ready renders **Start** only; Running renders **Pause** and **Finish focus**; Paused renders **Resume** and **Finish focus**. Each case separately asserts its legal callback fires once and illegal controls are absent. A fourth independent case sets `pending: true` and asserts every rendered control is disabled.

   Copy is fixed by the spec: **"Start"**, **"Pause"**, **"Resume"**, **"Finish focus"**. Not "Commit", not "Stop", not "Complete".

   Exercise through: `screen.getByRole("button", { name: ... })` and `fireEvent.click`
   Test doubles: `vi.fn()` callbacks
   Expected RED: controls are not rendered

8. Run test — verify FAIL for each state-specific control case, implement the controls, then verify PASS for each case and the pending case: `npm run test --workspace=client -- src/components/FocusTimer.test.tsx`.

9. Refactor while green (bounded):
   - Rule of three: the seconds → `MM:SS` formatter belongs in a named helper. Check `client/src/lib/` first — if nothing suitable exists, create the mapped `client/src/lib/focusDuration.ts` with `formatDuration(seconds)` and `client/src/lib/focusDuration.test.ts`. Never a generic `utils.ts`
   - Keep `FocusTimer.tsx` under ~300 lines and the component under ~50 lines of JSX
   - Re-run `npm run test --workspace=client -- src/components/FocusTimer.test.tsx` — must stay PASS

10. Commit:
    `git add client/src/components/FocusTimer.tsx client/src/components/FocusTimer.test.tsx`
    If Step 9 extracted `client/src/lib/focusDuration.ts` and its test, additionally run `git add client/src/lib/focusDuration.ts client/src/lib/focusDuration.test.ts` before committing.
    `git commit -m "feat(focus): add focus timer display and lifecycle controls"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Lifecycle; Design Decision → Timer display row ("client ticks from server `accumulated_seconds` + `running_since` when Running; reconcile on SSE/refresh"); Implementation Notes on user-facing copy ("Start", "Pause", "Resume", "Finish focus" — avoid "Commit" in UI)
- `docs/pocket/rule/creative-brief.md` — **design authority**. Button — Primary (`bg-primary-600`, white text, hover `primary-700`, focus ring `2px primary-600 offset 2px`), Button — Secondary (`bg-neutral-100`, `text-primary-700`, `border-neutral-300`), disabled (`bg-neutral-200`, `text-neutral-400`, `cursor-not-allowed`). Type scale: `xl` 31px for the duration readout, `sm` 13px for labels. Radius 6px. Tone: calm, neutral-friendly
- `client/src/index.css` — the `@theme` block exposing these as Tailwind v4 utilities (`bg-primary-600`, `text-neutral-700`, `font-sans` = Work Sans)
- `client/src/pages/TrackerDetailPage.tsx` (lines ~405–420) — existing button styling in this codebase
- `client/src/types.ts` — `FocusSession` from T7

## WHY THIS APPROACH

Complexity: lightweight
Justification: one component file plus its test, props-driven with no data access. The only subtlety — derive from `runningSince` rather than counting ticks — is stated explicitly above.

## SANDWICH CONTEXT

[CRITICAL: the displayed duration is computed from `runningSince` on every render, never accumulated by counting interval fires. Browsers throttle timers in background tabs; a tick-counting timer silently under-reports the user's work, which destroys the "trustworthy active time" the whole feature exists to provide.]

You are implementing the focus timer component for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — the server owns `accumulated_seconds` + `running_since`; the client renders from them and reconciles on SSE or refresh.
Files in scope: `client/src/components/FocusTimer.tsx`, `client/src/components/FocusTimer.test.tsx` — no other files (plus a duration-formatter extraction if Step 9 triggers one).
Test framework: Vitest + `@testing-library/react`, jsdom, `vi.useFakeTimers()`. Single file: `npm run test --workspace=client -- src/components/FocusTimer.test.tsx`. Test paths are workspace-scoped AND workspace-relative — a root `npm run test -- client/src/...` does NOT filter and exits 1 with `No test files found`, indistinguishable from a real RED. Never quote a multi-word `-t` filter: npm strips the quotes and the run can exit 0 having skipped every test; use a regex dot per space.
Available after: T7 (`FocusSession` type).
Architecture rule: presentational only — no `useFocusSession`, no `api` import, no routing. Client imports carry no extension. `noUnusedLocals` is on. UI decisions come from `docs/pocket/rule/creative-brief.md`; do not invent colors, radii, or type sizes.

[RESTATE: compute the duration from `runningSince` each render — never by counting interval fires.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a Running session at 1200 accumulated seconds, When 90 seconds pass, Then the display reads 21:30
Given a Paused session at 900 seconds, When 10 minutes pass, Then the display still reads 15:00
[derived] Given a Ready session, When rendered, Then the display reads 00:00 and only a **Start** control is offered
[derived] Given a Running session, When rendered, Then **Pause** and **Finish focus** are offered and each fires its callback once on click
[derived] Given a Paused session, When rendered, Then **Resume** and **Finish focus** are offered
[derived] Given `pending: true`, When rendered, Then every control is disabled
[must-not] Given a Paused or Ready session, When time passes, Then the component must NOT keep an interval scheduled
[must-not] Given any state, When controls render, Then an action illegal from that state must NOT be offered

All tests PASS under an unfiltered `npm run test`. Commit exists with message matching `feat(focus): add focus timer display and lifecycle controls`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Duration derived from `runningSince`, not from tick counting
- Interval cleared on unmount and whenever state leaves Running
- Exact spec copy: "Start", "Pause", "Resume", "Finish focus"
- Colors, type sizes, radius, and focus rings taken from `docs/pocket/rule/creative-brief.md` via the `@theme` utilities in `client/src/index.css`
- Controls reachable by `getByRole("button", { name })` — accessible names, not icon-only buttons
- Tests written BEFORE implementation (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- Any `api` call or `useFocusSession` usage — this component is props-driven
- Task fields beyond what the timer needs: no status, labels, assignees, due date, comments, or checklist
- A surveillance-style presentation — no idle-time callouts, no productivity scoring (explicitly out of scope)
- Hard-coded hex colors or arbitrary font sizes outside the brief's scale
- The word "Commit" in any user-facing string

Open question risks:
- Assumption: a one-second tick is enough. If the design later wants sub-second precision, only the interval changes → not a blocker.

Rollback note:
- Pure presentational component; deleting the file is a complete rollback.

Red flags:
- Work outside the two listed files → DONE_WITH_CONCERNS
- Tick-counted duration → STOP
- Colors or sizes invented outside the creative brief → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: the brief has no token for something the timer needs
Escalate when: rendering correctly appears to require the hook or an API call
