# Work items single table (merge tracker_items into cards) — Shared work-item key allocator (Phase 1 of 6)

**Date:** 2026-10-06
**Original plan:** ../execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T14, T15}
**Unlocks next:** Phase 2

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

- **T1:** Shared work-item key allocator [prereq] → [tasks/T1-shared-work-item-key-allocator.md](tasks/T1-shared-work-item-key-allocator.md)
- **T2:** Expand migration (nullable column_id, new columns, unique key, wiring) [prereq] → [tasks/T2-expand-migration-nullable-column-id-new-columns-unique-key-wiring.md](tasks/T2-expand-migration-nullable-column-id-new-columns-unique-key-wiring.md)
- **T14:** BACKGROUND_JOBS switch [prereq] → [tasks/T14-background-jobs-switch.md](tasks/T14-background-jobs-switch.md)
- **T15:** Maintenance mode config for camel-ggf nginx (local files) [prereq] → [tasks/T15-maintenance-mode-config-for-camel-ggf-nginx-local-files.md](tasks/T15-maintenance-mode-config-for-camel-ggf-nginx-local-files.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
