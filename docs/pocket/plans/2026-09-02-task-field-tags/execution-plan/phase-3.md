# Task Field Tags for Create Flows — Race-safe project removal (Phase 3 of 3)

**Date:** 2026-09-02
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T9, T10, T11, T12}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

- **T9:** Race-safe project removal [depends: T6, T7] [parallel: T8] [parallel: T10] [test-risk] → [tasks/T9-race-safe-project-removal.md](tasks/T9-race-safe-project-removal.md)
- **T10:** Race-safe phase removal [depends: T6, T7] [parallel: T8] [test-risk] → [tasks/T10-race-safe-phase-removal.md](tasks/T10-race-safe-phase-removal.md)
- **T11:** Board Add Card tag integration [depends: T1, T4, T5, T6] [test-risk] → [tasks/T11-board-add-card-tag-integration.md](tasks/T11-board-add-card-tag-integration.md)
- **T12:** Tracker New Item tag integration [depends: T1, T4, T5, T7] [parallel: T11] [test-risk] → [tasks/T12-tracker-new-item-tag-integration.md](tasks/T12-tracker-new-item-tag-integration.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
