# Complete shared 400 validation (#197, #198, #199) — Add integerIdArray and dedupe workspaceIdParam (Phase 4 of 5)

**Date:** 2026-10-09
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 3 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T11, T12, T13}
**Unlocks next:** Phase 5

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T11:** Add integerIdArray and dedupe workspaceIdParam [depends: T10] → [tasks/T11-add-integeridarray-and-dedupe-workspaceidparam.md](tasks/T11-add-integeridarray-and-dedupe-workspaceidparam.md)
- **T12:** Extract tracker reference parsers and use integerIdArray [depends: T11] → [tasks/T12-extract-tracker-reference-parsers-and-use-integeridarray.md](tasks/T12-extract-tracker-reference-parsers-and-use-integeridarray.md)
- **T13:** Share the lock-reference extractor and pin create rejection [depends: T11] [test-risk] → [tasks/T13-share-the-lock-reference-extractor-and-pin-create-rejection.md](tasks/T13-share-the-lock-reference-extractor-and-pin-create-rejection.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 5 ONLY after this gate passes.
