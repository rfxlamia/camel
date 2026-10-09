# Board / Tracker schema unify (additive shared vocab) — Test-command preflight (Phase 1 of 3)

**Date:** 2026-08-30
**Original plan:** ../execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T0, T1, T2}
**Unlocks next:** Phase 2

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T0:** Test-command preflight [prereq] → [tasks/T0-test-command-preflight.md](tasks/T0-test-command-preflight.md)
- **T1:** Column-to-slot mapping helper [depends: T0] → [tasks/T1-column-to-slot-mapping-helper.md](tasks/T1-column-to-slot-mapping-helper.md)
- **T2:** Schema, slot seed, indexes, and idempotent backfill [depends: T1] → [tasks/T2-schema-slot-seed-indexes-and-idempotent-backfill.md](tasks/T2-schema-slot-seed-indexes-and-idempotent-backfill.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
