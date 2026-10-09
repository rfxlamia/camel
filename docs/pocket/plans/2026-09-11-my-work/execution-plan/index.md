# My Work — Execution Index

**Date:** 2026-09-11
**Spec:** `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
**Source Plan:** ../execution-plan.md
**source-sha256:** 4de2cdf28c38b9ba98046c1cb25f48de3724950b8bb72c1f08ee71e4c2a84132
**Total Tasks:** 11
**Total Phases:** 3

---

## Execution Flow

```
T1→T2,T4,T5(PARALLEL)→T3,T6(PARALLEL)→T7,T9,T11(PARALLEL)→T8→T10
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — Add the My Work wire contract and Fuse.js dependency (T1, T2, T4, T5)
- **Phase 2:** [phase-2.md](phase-2.md) — Extract and implement the source-aware Mark done command (T3, T6, T7)
- **Phase 3:** [phase-3.md](phase-3.md) — Verify cross-unit server acceptance (T9, T11, T8, T10)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
| --- | --- | --- | --- | --- |
| T1 | Add the My Work wire contract and Fuse.js dependency | Phase 1 | [T1-add-the-my-work-wire-contract-and-fuse-js-dependency.md](tasks/T1-add-the-my-work-wire-contract-and-fuse-js-dependency.md) | [prereq] |
| T2 | Implement the server-side personal rollup and global detail read | Phase 1 | [T2-implement-the-server-side-personal-rollup-and-global-detail-read.md](tasks/T2-implement-the-server-side-personal-rollup-and-global-detail-read.md) | [depends: T1] |
| T4 | Build My Work normalization, ordering, pagination, and Fuse search helpers | Phase 1 | [T4-build-my-work-normalization-ordering-pagination-and-fuse-search-helpers.md](tasks/T4-build-my-work-normalization-ordering-pagination-and-fuse-search-helpers.md) | [depends: T1] |
| T5 | Add global My Work navigation | Phase 1 | [T5-add-global-my-work-navigation.md](tasks/T5-add-global-my-work-navigation.md) | [depends: T1] |
| T3 | Extract and implement the source-aware Mark done command | Phase 2 | [T3-extract-and-implement-the-source-aware-mark-done-command.md](tasks/T3-extract-and-implement-the-source-aware-mark-done-command.md) | [depends: T2] [test-risk] |
| T6 | Build the My Work page, list, filters, errors, and responsive rows | Phase 2 | [T6-build-the-my-work-page-list-filters-errors-and-responsive-rows.md](tasks/T6-build-the-my-work-page-list-filters-errors-and-responsive-rows.md) | [depends: T2, T4, T5] |
| T7 | Add global detail sheet and explicit source navigation | Phase 2 | [T7-add-global-detail-sheet-and-explicit-source-navigation.md](tasks/T7-add-global-detail-sheet-and-explicit-source-navigation.md) | [depends: T6] |
| T9 | Verify cross-unit server acceptance | Phase 3 | [T9-verify-cross-unit-server-acceptance.md](tasks/T9-verify-cross-unit-server-acceptance.md) | [depends: T2, T3] [test-risk] |
| T11 | Add My Work observability and performance verification | Phase 3 | [T11-add-my-work-observability-and-performance-verification.md](tasks/T11-add-my-work-observability-and-performance-verification.md) | [depends: T3, T6] [test-risk] |
| T8 | Add client Mark done action and optimistic mutation behavior | Phase 3 | [T8-add-client-mark-done-action-and-optimistic-mutation-behavior.md](tasks/T8-add-client-mark-done-action-and-optimistic-mutation-behavior.md) | [depends: T3, T7] |
| T10 | Verify cross-component client acceptance | Phase 3 | [T10-verify-cross-component-client-acceptance.md](tasks/T10-verify-cross-component-client-acceptance.md) | [depends: T8] [test-risk] |
