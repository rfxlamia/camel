# Work items single table (merge tracker_items into cards) — Merged-table integration verification (Phase 5 of 6)

**Date:** 2026-10-06
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 4 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T13, T16, T17}
**Unlocks next:** Phase 6

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T13:** Merged-table integration verification [depends: T10, T11, T12] → [tasks/T13-merged-table-integration-verification.md](tasks/T13-merged-table-integration-verification.md)
- **T16:** Cutover snapshot and verify script [depends: T13] → [tasks/T16-cutover-snapshot-and-verify-script.md](tasks/T16-cutover-snapshot-and-verify-script.md)
- **T17:** Cutover and restore scripts plus checklist [depends: T14, T15, T16] → [tasks/T17-cutover-and-restore-scripts-plus-checklist.md](tasks/T17-cutover-and-restore-scripts-plus-checklist.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 6 ONLY after this gate passes.
