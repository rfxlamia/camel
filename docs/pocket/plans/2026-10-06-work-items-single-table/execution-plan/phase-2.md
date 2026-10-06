# Work items single table (merge tracker_items into cards) — Board scope filters on aggregate readers (Phase 2 of 6)

**Date:** 2026-10-06
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T3, T4, T5, T23, T25}
**Unlocks next:** Phase 3

---

## Task List

Total: 5 tasks | Prerequisite phases must be complete before starting

- **T3:** Board scope filters on aggregate readers [depends: T2] → [tasks/T3-board-scope-filters-on-aggregate-readers.md](tasks/T3-board-scope-filters-on-aggregate-readers.md)
- **T4:** Reject column-less items on /cards endpoints [depends: T2] → [tasks/T4-reject-column-less-items-on-cards-endpoints.md](tasks/T4-reject-column-less-items-on-cards-endpoints.md)
- **T5:** Reject column-less items in core paths [depends: T2] → [tasks/T5-reject-column-less-items-in-core-paths.md](tasks/T5-reject-column-less-items-in-core-paths.md)
- **T23:** Build-id reload hook for open tabs [depends: T2, T14] → [tasks/T23-build-id-reload-hook-for-open-tabs.md](tasks/T23-build-id-reload-hook-for-open-tabs.md)
- **T25:** Maintenance rehearsal on camel-ggf (main agent only) [depends: T15] → [tasks/T25-maintenance-rehearsal-on-camel-ggf-main-agent-only.md](tasks/T25-maintenance-rehearsal-on-camel-ggf-main-agent-only.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
