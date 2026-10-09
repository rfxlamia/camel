# Task Field Tags for Create Flows — Execution Index

**Date:** 2026-09-02
**Spec:** `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`
**Source Plan:** ../execution-plan.md
**source-sha256:** 593b174991592d48c8aa9611b7f009647e96567ef89565717fe5873cc7ef774a
**Total Tasks:** 12
**Total Phases:** 3

---

## Execution Flow

```
T1,T3(PARALLEL)→T2,T6,T7(PARALLEL)→T4,T5,T8,T9,T10(PARALLEL)→T11,T12(PARALLEL)
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — Client create and field-error contracts (T1, T3, T2, T6, T7)
- **Phase 2:** [phase-2.md](phase-2.md) — Composite task title editor and command popover (T4, T5, T8)
- **Phase 3:** [phase-3.md](phase-3.md) — Race-safe project removal (T9, T10, T11, T12)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | Client create and field-error contracts | Phase 1 | [T1-client-create-and-field-error-contracts.md](tasks/T1-client-create-and-field-error-contracts.md) | [prereq] |
| T3 | Transactional task metadata validation and workspace lock primitives | Phase 1 | [T3-transactional-task-metadata-validation-and-workspace-lock-primitives.md](tasks/T3-transactional-task-metadata-validation-and-workspace-lock-primitives.md) | [prereq] |
| T2 | Shared task metadata draft reducer | Phase 1 | [T2-shared-task-metadata-draft-reducer.md](tasks/T2-shared-task-metadata-draft-reducer.md) | [depends: T1] |
| T6 | Atomic Board card creation backend | Phase 1 | [T6-atomic-board-card-creation-backend.md](tasks/T6-atomic-board-card-creation-backend.md) | [depends: T3] [test-risk] |
| T7 | Strict Tracker item creation backend | Phase 1 | [T7-strict-tracker-item-creation-backend.md](tasks/T7-strict-tracker-item-creation-backend.md) | [depends: T3] [parallel: T6] [test-risk] |
| T4 | Composite task title editor and command popover | Phase 2 | [T4-composite-task-title-editor-and-command-popover.md](tasks/T4-composite-task-title-editor-and-command-popover.md) | [depends: T2] |
| T5 | Workspace metadata catalog and field definitions | Phase 2 | [T5-workspace-metadata-catalog-and-field-definitions.md](tasks/T5-workspace-metadata-catalog-and-field-definitions.md) | [depends: T2] [parallel: T4] |
| T8 | Race-safe member removal | Phase 2 | [T8-race-safe-member-removal.md](tasks/T8-race-safe-member-removal.md) | [depends: T6, T7] [test-risk] |
| T9 | Race-safe project removal | Phase 3 | [T9-race-safe-project-removal.md](tasks/T9-race-safe-project-removal.md) | [depends: T6, T7] [parallel: T8] [parallel: T10] [test-risk] |
| T10 | Race-safe phase removal | Phase 3 | [T10-race-safe-phase-removal.md](tasks/T10-race-safe-phase-removal.md) | [depends: T6, T7] [parallel: T8] [test-risk] |
| T11 | Board Add Card tag integration | Phase 3 | [T11-board-add-card-tag-integration.md](tasks/T11-board-add-card-tag-integration.md) | [depends: T1, T4, T5, T6] [test-risk] |
| T12 | Tracker New Item tag integration | Phase 3 | [T12-tracker-new-item-tag-integration.md](tasks/T12-tracker-new-item-tag-integration.md) | [depends: T1, T4, T5, T7] [parallel: T11] [test-risk] |
