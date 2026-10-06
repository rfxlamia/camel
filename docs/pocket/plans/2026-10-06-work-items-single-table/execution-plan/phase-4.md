# Work items single table (merge tracker_items into cards) — Guard, parity assertions, counter repair and write trigger (Phase 4 of 6)

**Date:** 2026-10-06
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 3 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T8, T9, T10, T11, T12}
**Unlocks next:** Phase 5

---

## Task List

Total: 5 tasks | Prerequisite phases must be complete before starting

- **T8:** Guard, parity assertions, counter repair and write trigger [depends: T7] → [tasks/T8-guard-parity-assertions-counter-repair-and-write-trigger.md](tasks/T8-guard-parity-assertions-counter-repair-and-write-trigger.md)
- **T9:** Merged-table reads and the unified list [depends: T6, T8] → [tasks/T9-merged-table-reads-and-the-unified-list.md](tasks/T9-merged-table-reads-and-the-unified-list.md)
- **T10:** Tracker item writes on the merged table [depends: T1, T9] → [tasks/T10-tracker-item-writes-on-the-merged-table.md](tasks/T10-tracker-item-writes-on-the-merged-table.md)
- **T11:** Project, phase, vocabulary and member-removal paths [depends: T9] → [tasks/T11-project-phase-vocabulary-and-member-removal-paths.md](tasks/T11-project-phase-vocabulary-and-member-removal-paths.md)
- **T12:** My-work, focus and realtime ids on the merged table [depends: T9, T5] → [tasks/T12-my-work-focus-and-realtime-ids-on-the-merged-table.md](tasks/T12-my-work-focus-and-realtime-ids-on-the-merged-table.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 5 ONLY after this gate passes.
