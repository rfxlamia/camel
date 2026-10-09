# Closeout — 2026-08-01-workspace-pivot-scope

- **Plan:** docs/pocket/plans/2026-08-01-workspace-pivot-scope
- **Type:** flat
- **Started:** 2026-08-03  ·  **Closed:** 2026-08-03
- **Baseline SHA:** 4ea6a542590a3d3d44a7c18f6f9fdc83a9f0f8ff  ·  **Final SHA:** 7c4e7a1a88480dd2b5d60c16589e80dc75899fc1
- **Result:** CLOSED — all phases DONE, all reviewable tasks REVIEW_PASS

## Phases

### Phase 1 — execution-plan.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T1 | Add date-fns and shared board-view helpers | 10e6a4bf54afbd280729d6d651293c899e6313de | REVIEW_PASS |
| T2 | BoardContext view-mode state and persistence | 44410e9743c8b48e6b345f97444764e8353d6bc2 | REVIEW_PASS |
| T3 | ViewSwitcher and BoardPage view routing | 0608118d3d3f6b7c4631865e407f35bcf1d5985e | REVIEW_PASS |
| T4 | List view (read-only grouped table) | f18c2d13e0122c89e03f3587d4967a8c3fc77bba | REVIEW_PASS |
| T5 | Calendar view display and day-cell navigation | 3a349e06fa8f74ebc8fd6fac7eae888b37837652 | REVIEW_PASS |
| T6 | Calendar drag-to-reschedule with version conflict UI | fa14ae1248256a46b915a5206b01965009be5fd1 | REVIEW_PASS |
| T7 | Unscheduled tray bidirectional drag | 7c4e7a1a88480dd2b5d60c16589e80dc75899fc1 | REVIEW_PASS |

_SHA range: 4ea6a542590a3d3d44a7c18f6f9fdc83a9f0f8ff..7c4e7a1a88480dd2b5d60c16589e80dc75899fc1_

## Carried Forward

Non-blocking observations from review — accepted at close, recorded for follow-up.

- **T1** (Minor): readBoardViewMode returns raw localStorage values without validating BoardViewMode union — client/src/lib/boardViewPrefs.ts:17-20
- **T2** (Minor): useState initializer reads workspace key "0" before activeWorkspaceId resolves — client/src/context/BoardContext.tsx:171-173
- **T2** (Minor): no test for localStorage-blocked mount/reload fallback — client/src/context/BoardContext.viewMode.test.tsx
- **T5** (Minor): onOpenCard prop unused; CalendarView uses useNavigate directly — client/src/components/CalendarView.tsx:22
- **T5** (Minor): CalendarDayModal Escape handler on backdrop without tabIndex/focus trap — client/src/components/CalendarDayModal.tsx:17
- **T6** (Minor): date cells use div role=button vs native button — weaker keyboard semantics — client/src/components/CalendarView.tsx:98-115
- **T6** (Minor): CalendarConflictNotice timer can reset on re-render — client/src/components/CalendarConflictNotice.tsx:8-10
- **T6** (Minor): 409 server-state adoption not asserted in drag tests — client/src/components/CalendarView.drag.test.tsx
- **T6** (Minor): overflow +N more cards not draggable from grid — client/src/components/CalendarView.tsx:110-161
- **T7** (Minor): no integration test for tray vs grid placement — client/src/components/UnscheduledTray.test.tsx
- **T7** (Minor): tray conflict test omits 3s dismiss timer assertion — client/src/components/UnscheduledTray.test.tsx:216
- **T7** (Minor): unused saveCard/onConflict props on UnscheduledTray — client/src/components/UnscheduledTray.tsx:45-46

## Skipped Tasks

_None_
