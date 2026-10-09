# Closeout — 2026-09-05-image-attachment

- **Plan:** docs/pocket/plans/2026-09-05-image-attachment
- **Type:** phased
- **Started:** 2026-09-06  ·  **Closed:** 2026-09-07
- **Baseline SHA:** 7d8ce656f67b9753ee6cb5d280b4142cfa705010  ·  **Final SHA:** 2a44280967c842981b319a19fc3aed81c7107702
- **Result:** CLOSED — all phases DONE, all reviewable tasks REVIEW_PASS

## Phases

### Phase 1 — execution-plan/phase-1.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T1 | Add attachment schema and Kysely contract | 72534f5bdb478b2405bc5cda21240daa087a6882 | REVIEW_PASS |
| T2 | Add configurable private storage and multipart upload foundation | ec3907ba1d9c316dee5421d74d2ff434785a27ff | REVIEW_PASS |
| T3 | Extend image validation and client thumbnail preprocessing | 5f84a6cb7cd2c3462fa9992db90da9715dd08993 | REVIEW_PASS |
| T4 | Define attachment response hydration and realtime contract | 4920f7a4e29e9ceeff19cbed4d4b7e90983dc149 | REVIEW_PASS |

_SHA range: 7d8ce656f67b9753ee6cb5d280b4142cfa705010..4920f7a4e29e9ceeff19cbed4d4b7e90983dc149_

### Phase 2 — execution-plan/phase-2.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T5 | Add shared ownership guard and authenticated cached delivery | 04468c61dff2988928e614b230de05471eef5c2e | REVIEW_PASS |
| T6 | Implement existing-card upload, DB lock/count guard, activity, and SSE | 08ba5093cb025942a191f543b850d7a682c1a2cd | REVIEW_PASS |
| T7 | Delete attachments and clean up soft-deleted cards | 20c7e05bbb93dfa1ac2247809f9cde9871ea903d | REVIEW_PASS |
| T8 | Add multipart card-create atomicity | cb0ea10c2a76101bcef8aa7176d8735b65eebcad | REVIEW_PASS |
| T11 | Add the `@image` file-command variant | bef2be122b3c555ddf64182f9828200da45fd831 | REVIEW_PASS |
| T14 | Wire self-host deployment, private volume, and upload body size | fe0c83dd6e1391d15766c9fe7eae13495ece5014 | REVIEW_PASS |

_SHA range: 4920f7a4e29e9ceeff19cbed4d4b7e90983dc149..fe0c83dd6e1391d15766c9fe7eae13495ece5014_

### Phase 3 — execution-plan/phase-3.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T9 | Add client attachment API, SSE refresh, and activity descriptions | 8c9a0c3c55128e0e5e81adea8cb6ac9a897f1f62 | REVIEW_PASS |
| T10 | Build existing-card picker, paste, gallery, lightbox, and delete UI | 46a958d135736c873e698bd0faca138ccca4f7b6 | REVIEW_PASS |
| T12 | Stage images and submit create-card requests from AddCard | a9cdd4bb074692f51ec213198534ddb1d93225f9 | REVIEW_PASS |
| T13 | Render board cover thumbnails and overflow badge | 329e78b2a36069395d9d3df9108752863ecc9ddf | REVIEW_PASS |
| T15 | Verify cross-boundary attachment mutation, SSE, and create flow | 2a44280967c842981b319a19fc3aed81c7107702 | REVIEW_PASS |

_SHA range: fe0c83dd6e1391d15766c9fe7eae13495ece5014..2a44280967c842981b319a19fc3aed81c7107702_

## Carried Forward

Non-blocking observations from review — accepted at close, recorded for follow-up.

- **T1** (Minor): The integration test's run comment still shows the unscoped root command, which invokes the broader workspace test script rather than the corrected server-workspace command used by the task packet. — `server/src/db/attachment-schema.integration.test.ts:2`
- **T2** (Minor): The configuration test covers the container default using NODE_ENV=production but does not directly exercise the literal NODE_ENV=container-production branch, leaving that equivalent branch without an explicit regression test. — `server/src/lib/attachment-storage.test.ts:65-69`
- **T3** (Minor): The unreadable-image error path returns an invalid result but does not revoke the object URL created for the decode attempt, which can leak browser blob URLs across repeated staged failures. — `client/src/lib/imageAttachments.ts:72-109, 172-176`
- **T3** (Minor): The fallback test covers a null toBlob result but does not directly exercise the getContext failure branch, although that branch is implemented. — `client/src/lib/imageAttachments.ts:132-136; client/src/lib/imageAttachments.test.ts:138-155`
- **T4** (Minor): The prior T4 correction integration test still has two formatter suggestions for line wrapping, so that correction file is not fully Biome-formatted even though its focused test and typecheck pass. — `server/src/routes/attachment-activity.integration.test.ts:102-106, 133-139`
- **T9** (Minor): Attachment API tests assert CSRF and a null Content-Type but never assert credentials: "include", so they would still pass if the shared request() credentials line were removed. — `client/src/api.test.ts:986`
- **T9** (Minor): Board-create field lists are duplicated between serializeBoardCreateMetadata (multipart) and the JSON createCard branch. A later payload field can drift on one path only. — `client/src/api.ts:199`
- **T10** (Minor): Lightbox and delete confirmation still do not trap Tab. Initial focus now moves to Close/Cancel and is restored on dismiss, but Tab/Shift+Tab can leave the overlay and land on ContextPanel controls underneath. — `client/src/components/CardAttachments.tsx:67-81`

## Skipped Tasks

_None_
