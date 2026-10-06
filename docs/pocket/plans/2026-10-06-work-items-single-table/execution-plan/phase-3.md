# Work items single table (merge tracker_items into cards) — Event readers tolerate merged events (Phase 3 of 6)

**Date:** 2026-10-06
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T6, T24, T7}
**Unlocks next:** Phase 4

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T6:** Event readers tolerate merged events [depends: T3] → [tasks/T6-event-readers-tolerate-merged-events.md](tasks/T6-event-readers-tolerate-merged-events.md)
- **T24:** Deploy Phase A to camel-ggf (main agent only) [depends: T1, T2, T3, T4, T5, T6, T14, T23, T25] → [tasks/T24-deploy-phase-a-to-camel-ggf-main-agent-only.md](tasks/T24-deploy-phase-a-to-camel-ggf-main-agent-only.md)
- **T7:** Copy block: tracker data into cards [depends: T24] → [tasks/T7-copy-block-tracker-data-into-cards.md](tasks/T7-copy-block-tracker-data-into-cards.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 4 ONLY after this gate passes.
