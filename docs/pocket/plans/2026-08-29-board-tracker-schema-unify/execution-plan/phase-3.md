# Board / Tracker schema unify (additive shared vocab) — Card move updates status_id (Phase 3 of 3)

**Date:** 2026-08-30
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T5, T8, T9, T10}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

- **T5:** Card move updates status_id [depends: T4] → [tasks/T5-card-move-updates-status-id.md](tasks/T5-card-move-updates-status-id.md)
- **T8:** PATCH card priority, labels, project, and phase [depends: T5] → [tasks/T8-patch-card-priority-labels-project-and-phase.md](tasks/T8-patch-card-priority-labels-project-and-phase.md)
- **T9:** Board panel pickers and dirty-state protection [depends: T8] → [tasks/T9-board-panel-pickers-and-dirty-state-protection.md](tasks/T9-board-panel-pickers-and-dirty-state-protection.md)
- **T10:** Canonical migration smoke, fixture sweep, and final regression gate [depends: T4, T5, T6, T7, T8, T9] → [tasks/T10-canonical-migration-smoke-fixture-sweep-and-final-regression-gate.md](tasks/T10-canonical-migration-smoke-fixture-sweep-and-final-regression-gate.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
