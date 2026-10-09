# Image Attachment on Board Cards — Add client attachment API, SSE refresh, and activity descriptions (Phase 3 of 3)

**Date:** 2026-09-05
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T9, T10, T12, T13, T15}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 5 tasks | Prerequisite phases must be complete before starting

- **T9:** Add client attachment API, SSE refresh, and activity descriptions [depends: T4, T6, T7, T8] [test-risk] → [tasks/T9-add-client-attachment-api-sse-refresh-and-activity-descriptions.md](tasks/T9-add-client-attachment-api-sse-refresh-and-activity-descriptions.md)
- **T10:** Build existing-card picker, paste, gallery, lightbox, and delete UI [depends: T3, T9] [test-risk] → [tasks/T10-build-existing-card-picker-paste-gallery-lightbox-and-delete-ui.md](tasks/T10-build-existing-card-picker-paste-gallery-lightbox-and-delete-ui.md)
- **T12:** Stage images and submit create-card requests from AddCard [depends: T9, T11, T8] [test-risk] → [tasks/T12-stage-images-and-submit-create-card-requests-from-addcard.md](tasks/T12-stage-images-and-submit-create-card-requests-from-addcard.md)
- **T13:** Render board cover thumbnails and overflow badge [depends: T4, T9] [test-risk] → [tasks/T13-render-board-cover-thumbnails-and-overflow-badge.md](tasks/T13-render-board-cover-thumbnails-and-overflow-badge.md)
- **T15:** Verify cross-boundary attachment mutation, SSE, and create flow [depends: T6, T8, T9, T10, T12, T13] [test-risk] → [tasks/T15-verify-cross-boundary-attachment-mutation-sse-and-create-flow.md](tasks/T15-verify-cross-boundary-attachment-mutation-sse-and-create-flow.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
