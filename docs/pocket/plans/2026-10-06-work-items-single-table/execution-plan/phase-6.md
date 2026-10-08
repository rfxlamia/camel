# Work items single table (merge tracker_items into cards) — Rehearsal on a production dump (main agent only) (Phase 6 of 6)

**Date:** 2026-10-06
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 5 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T18, T19, T20, T21, T22}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 5 tasks | Prerequisite phases must be complete before starting

- **T18:** Rehearsal on a production dump (main agent only) [depends: T17] → [tasks/T18-rehearsal-on-a-production-dump-main-agent-only.md](tasks/T18-rehearsal-on-a-production-dump-main-agent-only.md)
- **T19:** Cutover on camel-ggf (main agent only) [depends: T18, T24, T25] → [tasks/T19-cutover-on-camel-ggf-main-agent-only.md](tasks/T19-cutover-on-camel-ggf-main-agent-only.md)
- **T20:** Contract: schema removal [depends: T19] → [tasks/T20-contract-schema-removal.md](tasks/T20-contract-schema-removal.md)
- **T21:** Contract: remove shim code, checks and docs [depends: T20] → [tasks/T21-contract-remove-shim-code-checks-and-docs.md](tasks/T21-contract-remove-shim-code-checks-and-docs.md)
- **T22:** Contract: rename cards to work_items [depends: T21] → [tasks/T22-contract-rename-cards-to-work-items.md](tasks/T22-contract-rename-cards-to-work-items.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
