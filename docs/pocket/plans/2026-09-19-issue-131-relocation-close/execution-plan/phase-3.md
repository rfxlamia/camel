# Issue #131 folder relocation close — Relocate agent wave-1 (no BoardContext importers) (Phase 3 of 5)

**Date:** 2026-09-19
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T7, T8, T9}
**Unlocks next:** Phase 4

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T7:** Relocate agent wave-1 (no BoardContext importers) [depends: T6] → [tasks/T7-relocate-agent-wave-1-no-boardcontext-importers.md](tasks/T7-relocate-agent-wave-1-no-boardcontext-importers.md)
- **T8:** Relocate server chat [depends: T7] → [tasks/T8-relocate-server-chat.md](tasks/T8-relocate-server-chat.md)
- **T9:** Relocate board wave-1 (no ContextPanel) [depends: T8 + Hotfix #2 shared workspace-reset helper] → [tasks/T9-relocate-board-wave-1-no-contextpanel.md](tasks/T9-relocate-board-wave-1-no-contextpanel.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 4 ONLY after this gate passes.
