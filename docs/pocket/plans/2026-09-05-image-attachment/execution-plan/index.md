# Image Attachment on Board Cards — Execution Index

**Date:** 2026-09-05
**Spec:** `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
**Source Plan:** ../execution-plan.md
**source-sha256:** e0be27a728735a4e35d28c2be70bf731cba16984b2010eb6855ed65b8f653518
**Total Tasks:** 15
**Total Phases:** 3

---

## Execution Flow

```
T1,T2(PARALLEL)→T3,T4(PARALLEL)→T5,T8,T11(PARALLEL)→T6→T7,T14(PARALLEL)→T9→T10,T12,T13(PARALLEL)→T15
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — Add attachment schema and Kysely contract (T1, T2, T3, T4)
- **Phase 2:** [phase-2.md](phase-2.md) — Add shared ownership guard and authenticated cached delivery (T5, T8, T11, T6, T7, T14)
- **Phase 3:** [phase-3.md](phase-3.md) — Add client attachment API, SSE refresh, and activity descriptions (T9, T10, T12, T13, T15)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | Add attachment schema and Kysely contract | Phase 1 | [T1-add-attachment-schema-and-kysely-contract.md](tasks/T1-add-attachment-schema-and-kysely-contract.md) | [prereq] [test-risk] |
| T2 | Add configurable private storage and multipart upload foundation | Phase 1 | [T2-add-configurable-private-storage-and-multipart-upload-foundation.md](tasks/T2-add-configurable-private-storage-and-multipart-upload-foundation.md) | [prereq] [test-risk] |
| T3 | Extend image validation and client thumbnail preprocessing | Phase 1 | [T3-extend-image-validation-and-client-thumbnail-preprocessing.md](tasks/T3-extend-image-validation-and-client-thumbnail-preprocessing.md) | [depends: T2] [test-risk] |
| T4 | Define attachment response hydration and realtime contract | Phase 1 | [T4-define-attachment-response-hydration-and-realtime-contract.md](tasks/T4-define-attachment-response-hydration-and-realtime-contract.md) | [depends: T1] [test-risk] |
| T5 | Add shared ownership guard and authenticated cached delivery | Phase 2 | [T5-add-shared-ownership-guard-and-authenticated-cached-delivery.md](tasks/T5-add-shared-ownership-guard-and-authenticated-cached-delivery.md) | [depends: T2, T4] [test-risk] |
| T8 | Add multipart card-create atomicity | Phase 2 | [T8-add-multipart-card-create-atomicity.md](tasks/T8-add-multipart-card-create-atomicity.md) | [depends: T2, T3, T4] [test-risk] |
| T11 | Add the `@image` file-command variant | Phase 2 | [T11-add-the-image-file-command-variant.md](tasks/T11-add-the-image-file-command-variant.md) | [depends: T3] [test-risk] |
| T6 | Implement existing-card upload, DB lock/count guard, activity, and SSE | Phase 2 | [T6-implement-existing-card-upload-db-lock-count-guard-activity-and-sse.md](tasks/T6-implement-existing-card-upload-db-lock-count-guard-activity-and-sse.md) | [depends: T3, T4, T5] [test-risk] |
| T7 | Delete attachments and clean up soft-deleted cards | Phase 2 | [T7-delete-attachments-and-clean-up-soft-deleted-cards.md](tasks/T7-delete-attachments-and-clean-up-soft-deleted-cards.md) | [depends: T2, T4, T5, T6] [test-risk] |
| T14 | Wire self-host deployment, private volume, and upload body size | Phase 2 | [T14-wire-self-host-deployment-private-volume-and-upload-body-size.md](tasks/T14-wire-self-host-deployment-private-volume-and-upload-body-size.md) | [depends: T2, T5, T6, T8] |
| T9 | Add client attachment API, SSE refresh, and activity descriptions | Phase 3 | [T9-add-client-attachment-api-sse-refresh-and-activity-descriptions.md](tasks/T9-add-client-attachment-api-sse-refresh-and-activity-descriptions.md) | [depends: T4, T6, T7, T8] [test-risk] |
| T10 | Build existing-card picker, paste, gallery, lightbox, and delete UI | Phase 3 | [T10-build-existing-card-picker-paste-gallery-lightbox-and-delete-ui.md](tasks/T10-build-existing-card-picker-paste-gallery-lightbox-and-delete-ui.md) | [depends: T3, T9] [test-risk] |
| T12 | Stage images and submit create-card requests from AddCard | Phase 3 | [T12-stage-images-and-submit-create-card-requests-from-addcard.md](tasks/T12-stage-images-and-submit-create-card-requests-from-addcard.md) | [depends: T9, T11, T8] [test-risk] |
| T13 | Render board cover thumbnails and overflow badge | Phase 3 | [T13-render-board-cover-thumbnails-and-overflow-badge.md](tasks/T13-render-board-cover-thumbnails-and-overflow-badge.md) | [depends: T4, T9] [test-risk] |
| T15 | Verify cross-boundary attachment mutation, SSE, and create flow | Phase 3 | [T15-verify-cross-boundary-attachment-mutation-sse-and-create-flow.md](tasks/T15-verify-cross-boundary-attachment-mutation-sse-and-create-flow.md) | [depends: T6, T8, T9, T10, T12, T13] [test-risk] |
