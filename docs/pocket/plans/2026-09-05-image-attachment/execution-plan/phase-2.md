# Image Attachment on Board Cards — Add shared ownership guard and authenticated cached delivery (Phase 2 of 3)

**Date:** 2026-09-05
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T5, T8, T11, T6, T7, T14}
**Unlocks next:** Phase 3

---

## Task List

Total: 6 tasks | Prerequisite phases must be complete before starting

- **T5:** Add shared ownership guard and authenticated cached delivery [depends: T2, T4] [test-risk] → [tasks/T5-add-shared-ownership-guard-and-authenticated-cached-delivery.md](tasks/T5-add-shared-ownership-guard-and-authenticated-cached-delivery.md)
- **T8:** Add multipart card-create atomicity [depends: T2, T3, T4] [test-risk] → [tasks/T8-add-multipart-card-create-atomicity.md](tasks/T8-add-multipart-card-create-atomicity.md)
- **T11:** Add the `@image` file-command variant [depends: T3] [test-risk] → [tasks/T11-add-the-image-file-command-variant.md](tasks/T11-add-the-image-file-command-variant.md)
- **T6:** Implement existing-card upload, DB lock/count guard, activity, and SSE [depends: T3, T4, T5] [test-risk] → [tasks/T6-implement-existing-card-upload-db-lock-count-guard-activity-and-sse.md](tasks/T6-implement-existing-card-upload-db-lock-count-guard-activity-and-sse.md)
- **T7:** Delete attachments and clean up soft-deleted cards [depends: T2, T4, T5, T6] [test-risk] → [tasks/T7-delete-attachments-and-clean-up-soft-deleted-cards.md](tasks/T7-delete-attachments-and-clean-up-soft-deleted-cards.md)
- **T14:** Wire self-host deployment, private volume, and upload body size [depends: T2, T5, T6, T8] → [tasks/T14-wire-self-host-deployment-private-volume-and-upload-body-size.md](tasks/T14-wire-self-host-deployment-private-volume-and-upload-body-size.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
