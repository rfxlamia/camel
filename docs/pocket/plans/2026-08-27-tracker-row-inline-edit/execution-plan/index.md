# Tracker Row Inline Property Editing — Execution Index

**Date:** 2026-08-28
**Spec:** docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md
**Source Plan:** ../execution-plan.md
**source-sha256:** 933806babb83aae31f1533f44700a6f59f15c41e1096705f7284a4c7b045d6ee
**Total Tasks:** 11
**Total Phases:** 3

---

## Execution Flow

```
T1→T2,T3(PARALLEL)→T4→T5→T6→T7,T8(PARALLEL)→T9→T10→T11
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — Shared per-item mutation queue module (T1, T2, T3)
- **Phase 2:** [phase-2.md](phase-2.md) — Wire date popover into TrackerRow + TrackerPage (T4, T5, T6)
- **Phase 3:** [phase-3.md](phase-3.md) — Labels/members isolated eager fetch (T7, T8, T9, T10, T11)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | Shared per-item mutation queue module | Phase 1 | [T1-shared-per-item-mutation-queue-module.md](tasks/T1-shared-per-item-mutation-queue-module.md) | [prereq] |
| T2 | Wire status change through the shared queue | Phase 1 | [T2-wire-status-change-through-the-shared-queue.md](tasks/T2-wire-status-change-through-the-shared-queue.md) | [depends: T1] |
| T3 | Build TrackerRowDatePopover + formatDateRange helper | Phase 1 | [T3-build-trackerrowdatepopover-formatdaterange-helper.md](tasks/T3-build-trackerrowdatepopover-formatdaterange-helper.md) | [depends: T1] |
| T4 | Wire date popover into TrackerRow + TrackerPage | Phase 2 | [T4-wire-date-popover-into-trackerrow-trackerpage.md](tasks/T4-wire-date-popover-into-trackerrow-trackerpage.md) | [depends: T3] |
| T5 | Project/phase inline edit | Phase 2 | [T5-project-phase-inline-edit.md](tasks/T5-project-phase-inline-edit.md) | [depends: T4] |
| T6 | Priority inline edit | Phase 2 | [T6-priority-inline-edit.md](tasks/T6-priority-inline-edit.md) | [depends: T5] |
| T7 | Labels/members isolated eager fetch | Phase 3 | [T7-labels-members-isolated-eager-fetch.md](tasks/T7-labels-members-isolated-eager-fetch.md) | [depends: T6] |
| T8 | Toggle-diff resolver helper | Phase 3 | [T8-toggle-diff-resolver-helper.md](tasks/T8-toggle-diff-resolver-helper.md) | [depends: T6] |
| T9 | Wire assignee/label pickers into TrackerRow + TrackerPage | Phase 3 | [T9-wire-assignee-label-pickers-into-trackerrow-trackerpage.md](tasks/T9-wire-assignee-label-pickers-into-trackerrow-trackerpage.md) | [depends: T7, T8] |
| T10 | Mobile kebab menu | Phase 3 | [T10-mobile-kebab-menu.md](tasks/T10-mobile-kebab-menu.md) | [depends: T9] |
| T11 | TrackerRow.test.tsx — unit regression suite | Phase 3 | [T11-trackerrow-test-tsx-unit-regression-suite.md](tasks/T11-trackerrow-test-tsx-unit-regression-suite.md) | [depends: T10] |
