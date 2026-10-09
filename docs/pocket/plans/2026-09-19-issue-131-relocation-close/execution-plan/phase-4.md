# Issue #131 folder relocation close — Relocate focus wave-2 (BoardContext consumers) (Phase 4 of 5)

**Date:** 2026-09-19
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 3 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T10, T11, T12}
**Unlocks next:** Phase 5

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T10:** Relocate focus wave-2 (BoardContext consumers) [depends: T9] → [tasks/T10-relocate-focus-wave-2-boardcontext-consumers.md](tasks/T10-relocate-focus-wave-2-boardcontext-consumers.md)
- **T11:** Relocate board wave-2 (ContextPanel) [depends: T10] → [tasks/T11-relocate-board-wave-2-contextpanel.md](tasks/T11-relocate-board-wave-2-contextpanel.md)
- **T12:** Relocate agent wave-2 (BoardContext consumers, stream/sync + llm cluster) [depends: T11 + Hotfix #2 shared workspace-reset helper] → [tasks/T12-relocate-agent-wave-2-boardcontext-consumers-llm-cluster.md](tasks/T12-relocate-agent-wave-2-boardcontext-consumers-llm-cluster.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 5 ONLY after this gate passes.
