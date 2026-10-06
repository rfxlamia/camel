# Work items single table (merge tracker_items into cards) — Execution Index

**Date:** 2026-10-06
**Spec:** docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
**Source Plan:** ../execution-plan.md
**source-sha256:** 9a8e9ca7397ee6fdea642ff7aab904eb4eec8152ed37ece2532aa8a8328296e9
**Total Tasks:** 25
**Total Phases:** 6

---

## Execution Flow

```
T1,T2,T14,T15(PARALLEL)→T3,T4,T5,T23,T25(PARALLEL)→T6→T24→T7→T8→T9→T10,T11,T12(PARALLEL)→T13→T16→T17→T18→T19→T20→T21→T22
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — Shared work-item key allocator (T1, T2, T14, T15)
- **Phase 2:** [phase-2.md](phase-2.md) — Board scope filters on aggregate readers (T3, T4, T5, T23, T25)
- **Phase 3:** [phase-3.md](phase-3.md) — Event readers tolerate merged events (T6, T24, T7)
- **Phase 4:** [phase-4.md](phase-4.md) — Guard, parity assertions, counter repair and write trigger (T8, T9, T10, T11, T12)
- **Phase 5:** [phase-5.md](phase-5.md) — Merged-table integration verification (T13, T16, T17)
- **Phase 6:** [phase-6.md](phase-6.md) — Rehearsal on a production dump (main agent only) (T18, T19, T20, T21, T22)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | Shared work-item key allocator | Phase 1 | [T1-shared-work-item-key-allocator.md](tasks/T1-shared-work-item-key-allocator.md) | [prereq] |
| T2 | Expand migration (nullable column_id, new columns, unique key, wiring) | Phase 1 | [T2-expand-migration-nullable-column-id-new-columns-unique-key-wiring.md](tasks/T2-expand-migration-nullable-column-id-new-columns-unique-key-wiring.md) | [prereq] |
| T14 | BACKGROUND_JOBS switch | Phase 1 | [T14-background-jobs-switch.md](tasks/T14-background-jobs-switch.md) | [prereq] |
| T15 | Maintenance mode config for camel-ggf nginx (local files) | Phase 1 | [T15-maintenance-mode-config-for-camel-ggf-nginx-local-files.md](tasks/T15-maintenance-mode-config-for-camel-ggf-nginx-local-files.md) | [prereq] |
| T3 | Board scope filters on aggregate readers | Phase 2 | [T3-board-scope-filters-on-aggregate-readers.md](tasks/T3-board-scope-filters-on-aggregate-readers.md) | [depends: T2] |
| T4 | Reject column-less items on /cards endpoints | Phase 2 | [T4-reject-column-less-items-on-cards-endpoints.md](tasks/T4-reject-column-less-items-on-cards-endpoints.md) | [depends: T2] |
| T5 | Reject column-less items in core paths | Phase 2 | [T5-reject-column-less-items-in-core-paths.md](tasks/T5-reject-column-less-items-in-core-paths.md) | [depends: T2] |
| T23 | Build-id reload hook for open tabs | Phase 2 | [T23-build-id-reload-hook-for-open-tabs.md](tasks/T23-build-id-reload-hook-for-open-tabs.md) | [depends: T2, T14] |
| T25 | Maintenance rehearsal on camel-ggf (main agent only) | Phase 2 | [T25-maintenance-rehearsal-on-camel-ggf-main-agent-only.md](tasks/T25-maintenance-rehearsal-on-camel-ggf-main-agent-only.md) | [depends: T15] |
| T6 | Event readers tolerate merged events | Phase 3 | [T6-event-readers-tolerate-merged-events.md](tasks/T6-event-readers-tolerate-merged-events.md) | [depends: T3] |
| T24 | Deploy Phase A to camel-ggf (main agent only) | Phase 3 | [T24-deploy-phase-a-to-camel-ggf-main-agent-only.md](tasks/T24-deploy-phase-a-to-camel-ggf-main-agent-only.md) | [depends: T1, T2, T3, T4, T5, T6, T14, T23, T25] |
| T7 | Copy block: tracker data into cards | Phase 3 | [T7-copy-block-tracker-data-into-cards.md](tasks/T7-copy-block-tracker-data-into-cards.md) | [depends: T24] |
| T8 | Guard, parity assertions, counter repair and write trigger | Phase 4 | [T8-guard-parity-assertions-counter-repair-and-write-trigger.md](tasks/T8-guard-parity-assertions-counter-repair-and-write-trigger.md) | [depends: T7] |
| T9 | Merged-table reads and the unified list | Phase 4 | [T9-merged-table-reads-and-the-unified-list.md](tasks/T9-merged-table-reads-and-the-unified-list.md) | [depends: T6, T8] |
| T10 | Tracker item writes on the merged table | Phase 4 | [T10-tracker-item-writes-on-the-merged-table.md](tasks/T10-tracker-item-writes-on-the-merged-table.md) | [depends: T1, T9] |
| T11 | Project, phase, vocabulary and member-removal paths | Phase 4 | [T11-project-phase-vocabulary-and-member-removal-paths.md](tasks/T11-project-phase-vocabulary-and-member-removal-paths.md) | [depends: T9] |
| T12 | My-work, focus and realtime ids on the merged table | Phase 4 | [T12-my-work-focus-and-realtime-ids-on-the-merged-table.md](tasks/T12-my-work-focus-and-realtime-ids-on-the-merged-table.md) | [depends: T9, T5] |
| T13 | Merged-table integration verification | Phase 5 | [T13-merged-table-integration-verification.md](tasks/T13-merged-table-integration-verification.md) | [depends: T10, T11, T12] |
| T16 | Cutover snapshot and verify script | Phase 5 | [T16-cutover-snapshot-and-verify-script.md](tasks/T16-cutover-snapshot-and-verify-script.md) | [depends: T13] |
| T17 | Cutover and restore scripts plus checklist | Phase 5 | [T17-cutover-and-restore-scripts-plus-checklist.md](tasks/T17-cutover-and-restore-scripts-plus-checklist.md) | [depends: T14, T15, T16] |
| T18 | Rehearsal on a production dump (main agent only) | Phase 6 | [T18-rehearsal-on-a-production-dump-main-agent-only.md](tasks/T18-rehearsal-on-a-production-dump-main-agent-only.md) | [depends: T17] |
| T19 | Cutover on camel-ggf (main agent only) | Phase 6 | [T19-cutover-on-camel-ggf-main-agent-only.md](tasks/T19-cutover-on-camel-ggf-main-agent-only.md) | [depends: T18, T24, T25] |
| T20 | Contract: schema removal | Phase 6 | [T20-contract-schema-removal.md](tasks/T20-contract-schema-removal.md) | [depends: T19] |
| T21 | Contract: remove shim code, checks and docs | Phase 6 | [T21-contract-remove-shim-code-checks-and-docs.md](tasks/T21-contract-remove-shim-code-checks-and-docs.md) | [depends: T20] |
| T22 | Contract: rename cards to work_items | Phase 6 | [T22-contract-rename-cards-to-work-items.md](tasks/T22-contract-rename-cards-to-work-items.md) | [depends: T21] |
