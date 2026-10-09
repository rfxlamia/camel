# Board / Tracker schema unify (additive shared vocab) — Execution Index

**Date:** 2026-08-30
**Spec:** docs/pocket/spec/2026-08-29-board-tracker-schema-unify/additive-shared-vocab.md
**Source Plan:** ../execution-plan.md
**source-sha256:** f8ab68adfa330bcfe42906c0fa52d50afe6640f84951d2350546c20ef1181de1
**Total Tasks:** 11
**Total Phases:** 3

---

## Execution Flow

```
T0→T1→T2→T3,T6(PARALLEL)→T4,T7(PARALLEL)→T5→T8→T9→T10
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — Test-command preflight (T0, T1, T2)
- **Phase 2:** [phase-2.md](phase-2.md) — Shared vocabulary/card response and batched hydration (T3, T6, T4, T7)
- **Phase 3:** [phase-3.md](phase-3.md) — Card move updates status_id (T5, T8, T9, T10)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T0 | Test-command preflight | Phase 1 | [T0-test-command-preflight.md](tasks/T0-test-command-preflight.md) | [prereq] |
| T1 | Column-to-slot mapping helper | Phase 1 | [T1-column-to-slot-mapping-helper.md](tasks/T1-column-to-slot-mapping-helper.md) | [depends: T0] |
| T2 | Schema, slot seed, indexes, and idempotent backfill | Phase 1 | [T2-schema-slot-seed-indexes-and-idempotent-backfill.md](tasks/T2-schema-slot-seed-indexes-and-idempotent-backfill.md) | [depends: T1] |
| T3 | Shared vocabulary/card response and batched hydration | Phase 2 | [T3-shared-vocabulary-card-response-and-batched-hydration.md](tasks/T3-shared-vocabulary-card-response-and-batched-hydration.md) | [depends: T2] |
| T6 | Column overlay and transactional is_done remap | Phase 2 | [T6-column-overlay-and-transactional-is-done-remap.md](tasks/T6-column-overlay-and-transactional-is-done-remap.md) | [depends: T2] [parallel: T3] |
| T4 | Key/status allocation and final status NOT NULL | Phase 2 | [T4-key-status-allocation-and-final-status-not-null.md](tasks/T4-key-status-allocation-and-final-status-not-null.md) | [depends: T3] |
| T7 | Show formatted key on card face and list view | Phase 2 | [T7-show-formatted-key-on-card-face-and-list-view.md](tasks/T7-show-formatted-key-on-card-face-and-list-view.md) | [depends: T3] [parallel: T4] |
| T5 | Card move updates status_id | Phase 3 | [T5-card-move-updates-status-id.md](tasks/T5-card-move-updates-status-id.md) | [depends: T4] |
| T8 | PATCH card priority, labels, project, and phase | Phase 3 | [T8-patch-card-priority-labels-project-and-phase.md](tasks/T8-patch-card-priority-labels-project-and-phase.md) | [depends: T5] |
| T9 | Board panel pickers and dirty-state protection | Phase 3 | [T9-board-panel-pickers-and-dirty-state-protection.md](tasks/T9-board-panel-pickers-and-dirty-state-protection.md) | [depends: T8] |
| T10 | Canonical migration smoke, fixture sweep, and final regression gate | Phase 3 | [T10-canonical-migration-smoke-fixture-sweep-and-final-regression-gate.md](tasks/T10-canonical-migration-smoke-fixture-sweep-and-final-regression-gate.md) | [depends: T4, T5, T6, T7, T8, T9] |
