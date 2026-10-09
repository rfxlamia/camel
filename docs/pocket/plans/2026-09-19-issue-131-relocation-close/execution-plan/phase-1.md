# Issue #131 folder relocation close — Extract client kernel chrome and cross-cutting files (Phase 1 of 5)

**Date:** 2026-09-19
**Original plan:** ../execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T3}
**Unlocks next:** Phase 2

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T1:** Extract client kernel chrome and cross-cutting files [prereq] → [tasks/T1-extract-client-kernel-chrome-and-cross-cutting-files.md](tasks/T1-extract-client-kernel-chrome-and-cross-cutting-files.md)
- **T2:** Extract server kernel card-assignees and card-response [depends: T1] → [tasks/T2-extract-server-kernel-card-assignees-and-card-response.md](tasks/T2-extract-server-kernel-card-assignees-and-card-response.md)
- **T3:** Move auth screens into pages [depends: T2] → [tasks/T3-move-auth-screens-into-pages.md](tasks/T3-move-auth-screens-into-pages.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
