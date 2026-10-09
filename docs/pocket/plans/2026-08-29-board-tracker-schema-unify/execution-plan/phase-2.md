# Board / Tracker schema unify (additive shared vocab) — Shared vocabulary/card response and batched hydration (Phase 2 of 3)

**Date:** 2026-08-30
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T3, T6, T4, T7}
**Unlocks next:** Phase 3

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

- **T3:** Shared vocabulary/card response and batched hydration [depends: T2] → [tasks/T3-shared-vocabulary-card-response-and-batched-hydration.md](tasks/T3-shared-vocabulary-card-response-and-batched-hydration.md)
- **T6:** Column overlay and transactional is_done remap [depends: T2] [parallel: T3] → [tasks/T6-column-overlay-and-transactional-is-done-remap.md](tasks/T6-column-overlay-and-transactional-is-done-remap.md)
- **T4:** Key/status allocation and final status NOT NULL [depends: T3] → [tasks/T4-key-status-allocation-and-final-status-not-null.md](tasks/T4-key-status-allocation-and-final-status-not-null.md)
- **T7:** Show formatted key on card face and list view [depends: T3] [parallel: T4] → [tasks/T7-show-formatted-key-on-card-face-and-list-view.md](tasks/T7-show-formatted-key-on-card-face-and-list-view.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
