# Tracker Row Inline Property Editing — Shared per-item mutation queue module (Phase 1 of 3)

**Date:** 2026-08-28
**Original plan:** ../execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T3}
**Unlocks next:** Phase 2

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T1:** Shared per-item mutation queue module [prereq] → [tasks/T1-shared-per-item-mutation-queue-module.md](tasks/T1-shared-per-item-mutation-queue-module.md)
- **T2:** Wire status change through the shared queue [depends: T1] → [tasks/T2-wire-status-change-through-the-shared-queue.md](tasks/T2-wire-status-change-through-the-shared-queue.md)
- **T3:** Build TrackerRowDatePopover + formatDateRange helper [depends: T1] → [tasks/T3-build-trackerrowdatepopover-formatdaterange-helper.md](tasks/T3-build-trackerrowdatepopover-formatdaterange-helper.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
