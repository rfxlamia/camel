# Complete shared 400 validation (#197, #198, #199) — Implement inline-400 AST detection (scanSource) (Phase 3 of 5)

**Date:** 2026-10-09
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T8, T9, T10}
**Unlocks next:** Phase 4

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T8:** Implement inline-400 AST detection (scanSource) [depends: T5, T6, T7] → [tasks/T8-implement-inline-400-ast-detection-scansource.md](tasks/T8-implement-inline-400-ast-detection-scansource.md)
- **T9:** Add the guard CLI, tree walk and allowlist [depends: T8] → [tasks/T9-add-the-guard-cli-tree-walk-and-allowlist.md](tasks/T9-add-the-guard-cli-tree-walk-and-allowlist.md)
- **T10:** Wire the guard into package.json, Makefile, CI and CLAUDE.md [depends: T9] → [tasks/T10-wire-the-guard-into-package-json-makefile-ci-and-claude-md.md](tasks/T10-wire-the-guard-into-package-json-makefile-ci-and-claude-md.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 4 ONLY after this gate passes.
