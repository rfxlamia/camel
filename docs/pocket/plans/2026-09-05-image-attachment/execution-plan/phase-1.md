# Image Attachment on Board Cards — Add attachment schema and Kysely contract (Phase 1 of 3)

**Date:** 2026-09-05
**Original plan:** ../execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T3, T4}
**Unlocks next:** Phase 2

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

- **T1:** Add attachment schema and Kysely contract [prereq] [test-risk] → [tasks/T1-add-attachment-schema-and-kysely-contract.md](tasks/T1-add-attachment-schema-and-kysely-contract.md)
- **T2:** Add configurable private storage and multipart upload foundation [prereq] [test-risk] → [tasks/T2-add-configurable-private-storage-and-multipart-upload-foundation.md](tasks/T2-add-configurable-private-storage-and-multipart-upload-foundation.md)
- **T3:** Extend image validation and client thumbnail preprocessing [depends: T2] [test-risk] → [tasks/T3-extend-image-validation-and-client-thumbnail-preprocessing.md](tasks/T3-extend-image-validation-and-client-thumbnail-preprocessing.md)
- **T4:** Define attachment response hydration and realtime contract [depends: T1] [test-risk] → [tasks/T4-define-attachment-response-hydration-and-realtime-contract.md](tasks/T4-define-attachment-response-hydration-and-realtime-contract.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
