# Complete shared 400 validation (#197, #198, #199) — Single strict workspace-id parser and tighten lenient routes (Phase 5 of 5)

**Date:** 2026-10-09
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 4 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T14, T15, T16}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T14:** Single strict workspace-id parser and tighten lenient routes [depends: T12, T13] → [tasks/T14-single-strict-workspace-id-parser-and-tighten-lenient-routes.md](tasks/T14-single-strict-workspace-id-parser-and-tighten-lenient-routes.md)
- **T15:** Unify username wording [depends: T14] → [tasks/T15-unify-username-wording.md](tasks/T15-unify-username-wording.md)
- **T16:** Verify client parsing; draft issue comment and PR text [depends: T14, T15] → [tasks/T16-verify-client-parsing-draft-issue-comment-and-pr-text.md](tasks/T16-verify-client-parsing-draft-issue-comment-and-pr-text.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
