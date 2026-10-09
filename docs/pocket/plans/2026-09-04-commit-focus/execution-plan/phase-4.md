# Commit Focus (Personal Focus Mode) — `/focus` route + `FocusPage` (Phase 4 of 4)

**Date:** 2026-09-04
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 3 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T9, T13, T10}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T9:** `/focus` route + `FocusPage` [depends: T8] → [tasks/T9-focus-route-focuspage.md](tasks/T9-focus-route-focuspage.md)
- **T13:** Live auto-finish guards — task deleted, access revoked [depends: T12, T14] [test-risk] → [tasks/T13-live-auto-finish-guards-task-deleted-access-revoked.md](tasks/T13-live-auto-finish-guards-task-deleted-access-revoked.md)
- **T10:** Entry points — "Focus on this task" + confirm-switch [depends: T6, T9] → [tasks/T10-entry-points-focus-on-this-task-confirm-switch.md](tasks/T10-entry-points-focus-on-this-task-confirm-switch.md)

---

## Dispatch Order

This is **not** a fully parallel group. `T10` depends on `T9` — dispatched together, T10's unit tests
would go green against a `/focus` route that does not exist yet.

```
[T9 ∥ T13]  →  T10
```

T9 (`FocusPage.tsx`, `App.tsx`) and T13 (`FocusSessionContext.tsx`) touch disjoint files and may run
in parallel. T10 starts only after T9 is DONE.

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- **Unfiltered** `npm run test` from the repo root is green — not a `--workspace` or `-t` filtered run.
  A path-filtered or `-t`-filtered command can exit 0 having run nothing; this is the only test command
  in the phase that cannot lie.
- `npm run typecheck` from the repo root is green
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
