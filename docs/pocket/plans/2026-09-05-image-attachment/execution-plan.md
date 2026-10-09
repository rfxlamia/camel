# EXECUTION PLAN — Image Attachment on Board Cards

**Date:** 2026-09-05
**Spec:** `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
**Status:** Gate 4 approved — awaiting user plan approval
**Total tasks:** 15

---

## Execution Overview

### Recommended Order

```text
T1, T2 (parallel) → T3, T4 (parallel after their prerequisites) → T5, T8 (parallel)
→ T6 → T7 → T9 → T10, T11 (parallel) → T12, T13 (parallel) → T14, T15 (parallel)
```

> Dependency order above is recommended — pocket skill enforces actual parallelism and
> sequencing based on its routing logic.

### Parallelizable Groups

| Group | Tasks | Unblocked After |
| ------- | ------- | ----------------- |
| Foundation | T1, T2 | none |
| Foundation contracts | T3, T4 | T2 for T3; T1 for T4 |
| Backend entry points | T5, T8 | T2/T4 for T5; T2/T3/T4 for T8 |
| Client surfaces | T10, T11 | T9/T3 for T10; T3 for T11 |
| Final client/deployment | T12, T13 | T9/T11 for T12; T4/T9 for T13 |
| Deployment overlap | T14 | T2/T5/T6/T8 |
| Cross-boundary verification | T15 | T6/T8/T9/T10/T12/T13 |

### Constraints Reminder

**Architecture:** Attachments belong only to `cards`; do not touch `tracker_items`, `work-item-response.ts`, or `workItemMutations.ts`. Keep bytes outside `client/public`, expose them only through authenticated ownership-chain routes, use NodeNext `.js` imports on the server, and call `recordActivity()` plus `publishEvent()` for every attachment mutation.

**Out-of-scope:** Generic files, tracker parity, annotations/search/LLM ingestion, object storage/CDN/presigned URLs, cross-workspace sharing, replacement/reordering, drag-and-drop, workspace quota, orphan sweeper, and idempotency-key infrastructure.

**Assumptions at risk:** A configurable private directory defaults to `/app/server/private-uploads` in the container and a source-relative `server/private-uploads` in development; `<img src>` session-cookie behavior and Canvas support still need empirical verification. GGF Compose remains operator-specific and ignored; tracked production Compose is the self-hosting contract.

**Resolved spec clarifications:** The existing-card batch counter reports total card state (`3/3` after adding two images to a card at `1/3`), while the result message reports batch acceptance (`2 of 4 images added`). Because cards are soft-deleted, card deletion explicitly removes attachment rows inside the delete transaction and unlinks files after commit; the attachment FK retains `ON DELETE CASCADE` for actual hard deletes. The spec note claiming `card_events.to_column_id` is still NOT NULL is stale; current schema is nullable, but attachment events still pass the card's current column id.

**Sequencing:** `[depends: ...]` annotations are recommended order; pocket-development enforces the dependency graph. `[test-risk]` marks persistence, filesystem, concurrency, network, SSE, multipart, or browser-API seams for the conditional test strategy audit.

### File Structure Map

```text
Rule: Format, size, dimensions, and per-card count caps
  Modify: server/src/db/schema.sql                              (T1)
  Modify: server/src/db/types.ts                                (T1)
  Create: server/src/db/attachment-schema.integration.test.ts     (T1)
  Create: server/src/db/attachment-schema.test.ts                 (T1)
  Create: server/src/lib/attachment-storage.ts                    (T2, T8)
  Create: server/src/lib/attachment-upload.ts                     (T2)
  Test:   server/src/lib/attachment-storage.test.ts               (T2)
  Modify: server/src/lib/file-validator.ts                        (T3)
  Modify: server/src/__tests__/file-validator.test.ts             (T3)
  Create: client/src/lib/imageAttachments.ts                      (T3)
  Create: client/src/lib/imageAttachments.test.ts                 (T3)
  Test:   server/src/routes/card-attachments.integration.test.ts  (T6)

Rule: Concurrent uploads and existing-card batch overflow
  Modify: server/src/routes/card-attachments.ts                   (T6)
  Modify: server/src/routes/helpers.ts                            (T6)
  Test:   server/src/routes/card-attachments.integration.test.ts  (T6)
  Modify: client/src/components/CardAttachments.tsx               (T10)
  Create: client/src/components/CardAttachments.test.tsx          (T10)
  Create: client/src/components/CardAttachments.integration.test.tsx (T10)

Rule: Card-create atomicity and staged-image errors
  Modify: server/src/routes/card-create.ts                       (T8)
  Modify: server/src/routes/cards.ts                              (T8)
  Create: server/src/routes/card-create-attachments.integration.test.ts (T8)
  Modify: client/src/lib/taskCreateContracts.ts                   (T9)
  Modify: client/src/components/task-entry/TaskTitleEditor.tsx    (T11)
  Modify: client/src/components/task-entry/TaskTitleEditor.test.tsx (T11)
  Modify: client/src/components/AddCard.tsx                       (T12)
  Modify: client/src/components/AddCard.test.tsx                  (T12)

Rule: Cover ordering, badge, and no-media display
  Create: server/src/routes/attachment-response.ts               (T4)
  Create: server/src/routes/attachment-response.test.ts           (T4)
  Create: server/src/routes/attachment-response.integration.test.ts (T4)
  Modify: server/src/routes/card-response.ts                      (T4)
  Modify: server/src/routes/board.ts                              (T4)
  Modify: server/src/routes/cards.ts                              (T4, T8)
  Modify: client/src/types.ts                                    (T4)
  Modify: client/src/types.test.ts                               (T4)
  Modify: client/src/components/CardView.tsx                     (T13)
  Modify: client/src/components/CardView.test.tsx                (T13)
  Create: client/src/components/CardView.integration.test.tsx    (T13)

Rule: Authenticated cached delivery and ownership-chain isolation
  Modify: server/src/routes.ts                                 (T5)
  Create: server/src/routes/card-attachments.ts                (T5)
  Modify: server/src/realtime.ts                               (T4, T6)
  Test:   server/src/routes/attachments-system.integration.test.ts (T15)
  Test:   server/src/routes/card-attachments.integration.test.ts (T5, T6, T7)
  Modify: client/src/api.ts                                    (T9, T15)
  Test:   client/src/api.test.ts                               (T9)
  Modify: client/src/context/BoardContext.tsx                  (T9)

Rule: Confirmed delete, activity, realtime, and soft-delete cleanup
  Modify: server/src/routes/card-attachments.ts                (T7)
  Modify: server/src/routes/cards.ts                            (T7)
  Modify: client/src/lib/cardPanel.ts                          (T9)
  Modify: client/src/pages/ActivityPage.tsx                    (T9)
  Create: client/src/pages/ActivityPage.test.tsx               (T9)
  Modify: client/src/lib/cardPanel.test.ts                      (T9)
  Modify: client/src/components/ContextPanel.tsx               (T10)
  Modify: client/src/components/ContextPanel.test.tsx          (T10)

Rule: Isolation from card optimistic locking and tracker systems
  Modify: server/src/routes/cards.ts                            (T7)
  Modify: server/src/routes/card-create.ts                      (T8)
  Modify: client/src/context/BoardContext.tsx                   (T9)
  Test:   server/src/routes/card-attachments.integration.test.ts (T7)

Rule: Cross-boundary attachment verification
  Create: server/src/routes/attachments-system.integration.test.ts (T15)
  Create: client/src/attachments-system.integration.test.tsx       (T15)
  Test:   server/src/routes/card-create-attachments.integration.test.ts (T8)
  Test:   client/src/context/BoardContext.attachments.test.tsx    (T9)

Rule: Self-host deployment and request body size
  Modify: server/src/config.ts                                  (T2)
  Modify: Dockerfile                                             (T14)
  Modify: deploy/docker-compose.prod.yml                         (T14)
  Modify: deploy/.env.production.template                        (T14)
  Modify: deploy/nginx/camel.conf                                (T14)
```

The ignored `deploy/docker-compose.ggf.yml` is intentionally not a tracked plan deliverable. GGF operators must mirror the tracked production Compose private-volume mount in their local operator-specific file.

---

## Pocket Packets

---

### Task 1: Add attachment schema and Kysely contract [prereq] [test-risk]

## OBJECTIVE

Add the additive `attachments` table and committed Kysely type so attachment routes can persist one logical image with separate thumbnail/original paths without touching tracker tables or card optimistic-locking fields.

Files:

- Modify: `server/src/db/schema.sql`
- Modify: `server/src/db/types.ts`
- Create: `server/src/db/attachment-schema.integration.test.ts`
- Create: `server/src/db/attachment-schema.test.ts`

Steps:

1. Write failing test for: the full schema can be applied twice and PostgreSQL enforces attachment constraints/cascade.
   Test file: `server/src/db/attachment-schema.integration.test.ts`
   Level: integration

   Test intent:
   Given an isolated PostgreSQL schema, When the repository schema is applied twice and fixtures are inserted, Then:
   - the second application succeeds without destructive errors
   - invalid MIME/size rows are rejected by database constraints
   - physically deleting a card cascades its attachment row
   - valid rows can be selected in `(card_id, created_at, id)` order

   Exercise through:
   - the real `schema.sql` migration text and PostgreSQL connection, not a SQL string matcher.

   Test doubles:
   - isolated database schema/transaction fixture only
   - do not mock PostgreSQL, migration execution, FK enforcement, constraints, or schema text.

   Expected RED:
   - the current database has no `attachments` table/index, so migration application and constraint assertions fail.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/db/attachment-schema.integration.test.ts`
   Expected failure: live migration/constraint assertions fail because the schema is absent.

3. Implement minimal code to satisfy the test:
   File: `server/src/db/schema.sql`
   Implement: an idempotent `attachments` table with the exact logical-image columns, FK cascade, PNG/JPEG check, positive bounded byte-size checks, created timestamp, and `(card_id, created_at, id)` index. Keep it additive and leave `cards.version`, `tracker_items`, and existing public uploads untouched.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/db/attachment-schema.integration.test.ts`
   Expected: real schema reapplication and constraint/cascade assertions PASS.

5. Refactor while green (bounded):
   - Keep migration ordering/idempotency in `schema.sql`; keep integration setup isolated and gated.
   - Re-run the integration test and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/db/schema.sql server/src/db/attachment-schema.integration.test.ts`
   `git commit -m "feat(attachments): add attachment table schema"`

7. Write failing test for: generated database type exposes `Attachments` and registers `attachments` on `Database`.
   Test file: `server/src/db/attachment-schema.test.ts`
   Level: unit (generated-contract check)

   Test intent:
   Given the committed `server/src/db/types.ts`, When the type contract test reads it, Then `Attachments` uses the repository's `Generated<T>`/`Timestamp` conventions and the database registry contains `attachments: Attachments`.

   Exercise through:
   - the committed Kysely type module contract, not a handwritten duplicate type.

   Test doubles:
   - none
   - do not mock the generated type file.

   Expected RED:
   - the schema now exists but `types.ts` has no `Attachments` interface or database registry entry.

8. Run test — verify FAIL:
   `npm run test -- server/src/db/attachment-schema.test.ts`
   Expected failure: generated-type assertions report that `Attachments`/`attachments` is missing.

9. Implement minimal code to satisfy the test:
   File: `server/src/db/types.ts`
   Implement: regenerate the committed Kysely type output from the migrated schema, or update the generated output using the same field/nullability conventions if a database is unavailable. Preserve the generated-file header and add only the new table shape/registry entry.

10. Run test — verify PASS:
    `npm run test -- server/src/db/attachment-schema.test.ts`
    Expected: generated-type assertions PASS.

11. Refactor while green (bounded):
    - Run `npm run typecheck` and re-run the schema integration and type contract tests — all must stay PASS.

12. Commit:
    `git add server/src/db/types.ts server/src/db/attachment-schema.test.ts`
    `git commit -m "feat(attachments): register Kysely attachment types"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — schema scope, FK cascade, no tracker changes, and card-version isolation.
- `server/src/db/schema.sql` — idempotent DDL ordering and current nullable `card_events.to_column_id` behavior.
- `server/src/db/types.ts` — generated `Generated<T>`/`Timestamp` conventions.
- `server/src/db/focus-session-schema.test.ts` — schema/type contract test convention.

## WHY THIS APPROACH

Complexity: standard
Justification: This is a persistence prerequisite spanning one SQL artifact, one generated type artifact, and one contract test. The two RED cycles independently prove database shape and type shape before any route can depend on them.

## SANDWICH CONTEXT

[CRITICAL: Attachments must remain an additive `cards`-only table and must not modify tracker tables or card optimistic-locking semantics.]
You are implementing the attachment persistence contract for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: one attachment row stores thumbnail and original paths, with local storage and authenticated delivery added later.
Files in scope: `server/src/db/schema.sql`, `server/src/db/types.ts`, `server/src/db/attachment-schema.test.ts`, `server/src/db/attachment-schema.integration.test.ts`.
Available after: none.
Architecture rule: use idempotent `schema.sql` applied by `make db-migrate`; do not add a separate migration or touch `tracker_items`.
[RESTATE: Attachments must remain an additive `cards`-only table and must not modify tracker tables or card optimistic-locking semantics.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a migrated database, When the attachment schema is applied twice, Then the `attachments` table and deterministic cover-order index exist without destructive changes.
Given a card is physically deleted, When its attachment FK is evaluated, Then attachment rows cascade; soft-delete cleanup is handled later by T7.
Given `server/src/db/types.ts` is loaded, When attachment queries are typechecked, Then `Attachments` and the `attachments` registry entry match the DDL.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- PNG/JPEG-only row contract, bounded byte sizes, timestamp, FK cascade, and `(card_id, created_at, id)` ordering index.
- Kysely type output remains consistent with the repository's generated-file conventions.
- Schema is additive and idempotent.
- Tests are written before implementation and both commits are conventional.

Must-not-have:

- Changes to `tracker_items`, `work-item-response.ts`, `workItemMutations.ts`, or `cards.version`.
- Public file paths, URL columns, or image bytes stored in the database.
- A separate migration file or destructive table rewrite.

Open question risks:

- None introduced by this task; the accepted orphan/idempotency risks are handled by later storage/API tasks.

Rollback note:

- The table/index are additive. If the feature is disabled, leave the schema in place and hide UI entry points; do not roll back existing card/column tables.

## STOP CONDITIONS

Done when: both schema/type contract cycles pass, typecheck is green, and both commits exist.
Uncertain when: the live database type generator produces a shape incompatible with the existing Kysely conventions; report NEEDS_CONTEXT before hand-editing unrelated types.
Escalate when: satisfying the schema requires changing tracker tables, `cards.version`, or existing card-event history.

---

### Task 2: Add configurable private storage and multipart upload foundation [prereq] [test-risk]

## OBJECTIVE

Create a swappable local-disk provider and memory-backed multipart upload factory that keep attachment bytes outside `client/public`, use generated safe names, and expose an `ATTACHMENTS_DIR` override for self-hosting.

Files:

- Modify: `server/src/config.ts`
- Create: `server/src/lib/attachment-storage.ts`
- Create: `server/src/lib/attachment-upload.ts`
- Test: `server/src/lib/attachment-storage.test.ts`

Steps:

1. Write failing test for: the storage provider writes a thumbnail/original pair below the configured private root and removes both paths idempotently.
   Test file: `server/src/lib/attachment-storage.test.ts`
   Level: unit

   Test intent:
   Given `ATTACHMENTS_DIR` points to a configured temporary private directory and two valid image buffers, When configuration initializes the production provider and it writes one logical attachment pair, Then:
   - the resolved provider root equals the configured override
   - both files are created below the private root and outside `client/public`
   - returned paths are opaque provider-relative paths, not user-controlled filenames
   - removing the pair deletes both files and a repeated removal does not throw
   Given `ATTACHMENTS_DIR` is unset, When configuration initializes in development and container-production modes, Then each documented default resolves outside `client/public` and never falls back to `UPLOADS_DIR`.

   Exercise through:
   - the exported configuration resolver and production storage-provider interface using a real temporary directory; do not call route internals.

   Test doubles:
   - isolated environment values, temporary filesystem root, and deterministic random/clock helpers may be injected
   - do not mock configuration resolution, the storage provider under test, or replace filesystem writes with a fake.

   Expected RED:
   - `attachment-storage.ts` does not exist, so the provider import and write/remove behavior fail.

2. Run test — verify FAIL:
   `npm run test -- server/src/lib/attachment-storage.test.ts`
   Expected failure: module/provider import fails because no private attachment storage exists.

3. Implement minimal code to satisfy the test:
   Files: `server/src/config.ts`, `server/src/lib/attachment-storage.ts`
   Implement: optional `ATTACHMENTS_DIR` configuration, a source-relative development default that resolves to `server/private-uploads` and a container default of `/app/server/private-uploads`, plus a `LocalAttachmentStorage` interface/implementation with `writePair`, `removePair`, and best-effort bulk cleanup. Generate safe opaque names and never use the original filename as a path.

4. Run test — verify PASS:
   `npm run test -- server/src/lib/attachment-storage.test.ts`
   Expected: private-root writes and idempotent cleanup PASS.

5. Refactor while green (bounded):
   - Keep path resolution/provider logic domain-scoped; do not create a generic `utils.ts`.
   - Re-run the test and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/config.ts server/src/lib/attachment-storage.ts server/src/lib/attachment-storage.test.ts`
   `git commit -m "feat(attachments): add private local storage provider"`

7. Write failing test for: the shared multipart upload factory supports route-specific pair ceilings while preserving bounded memory/file limits.
   Test file: `server/src/lib/attachment-storage.test.ts`
   Level: unit

   Test intent:
   Given multipart fields named `thumbnail` and `original`, When the factory is configured with `maxPairs: 3` for card-create, Then a fourth pair is rejected. Given the existing-card profile's documented 10-pair/20-file and finite parts ceilings, When four image pairs arrive, Then Multer accepts them for route-level partial capacity handling; when an eleventh pair, a twenty-first file, or one part beyond the documented parts ceiling arrives, Then the real parser rejects with the normalized limit error. Given either profile, When one file exceeds 10MB, Then parsing rejects before provider write. All accepted files remain memory buffers.

   Exercise through:
   - the exported upload-factory middleware, not a route-specific wrapper.

   Test doubles:
   - real synthetic multipart byte streams at, below, and one over each exported profile limit plus a provider-invocation spy
   - do not mock Multer's parser behavior or the upload factory itself.

   Expected RED:
   - `attachment-upload.ts` is absent, so no configurable parser profiles or bounded Multer limits exist.

8. Run test — verify FAIL:
   `npm run test -- server/src/lib/attachment-storage.test.ts`
   Expected failure: upload factory import/limit assertions fail because no attachment multipart middleware exists.

9. Implement minimal code to satisfy the test:
   File: `server/src/lib/attachment-upload.ts`
   Implement: a lazy Multer memory-storage factory `createAttachmentUpload({ maxPairs })` with repeated `thumbnail`/`original` fields, route-specific `maxCount`, explicit `limits.files` and `limits.parts`, a documented existing-card ceiling of 10 pairs/20 files with a finite parts allowance compatible with the 35MB nginx limit, `limits.fileSize: 10 * 1024 * 1024`, and an exported error-normalization boundary. Export or otherwise expose the profile ceilings to tests so each `N + 1` case is asserted without duplicating hidden constants. Do not write files from Multer; storage writes remain explicit so DB rollback can unlink them.

10. Run test — verify PASS:
    `npm run test -- server/src/lib/attachment-storage.test.ts`
    Expected: multipart parser contract and storage provider tests PASS.

11. Refactor while green (bounded):
    - Keep Multer import lazy if required by existing pure-test collection behavior.
    - Re-run `npm run test -- server/src/lib/attachment-storage.test.ts` and `npm run typecheck` — both must stay PASS.

12. Commit:
    `git add server/src/lib/attachment-upload.ts server/src/lib/attachment-storage.test.ts`
    `git commit -m "feat(attachments): add bounded memory upload parser"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — private root, local provider interface, file-write/DB atomicity boundary, and 10MB/3-file limits.
- `server/src/routes/settings.ts` — existing lazy Multer precedent and filename safety concerns.
- `server/src/lib/file-validator.ts` — validation is separate from upload parsing.
- `Dockerfile` and `deploy/docker-compose.prod.yml` — current public upload path and container working directory.
- Multer documentation — `diskStorage`, `fileFilter`, `limits`, and explicit error handling; this task intentionally uses memory storage instead of public disk storage.

## WHY THIS APPROACH

Complexity: standard
Justification: Storage writes and multipart parsing are separate responsibilities that must share a precise boundary. The provider is unit-tested against a temporary filesystem; Multer behavior is tested independently so routes can own transaction/cleanup decisions.

## SANDWICH CONTEXT

[CRITICAL: Attachment bytes must never be written below `client/public` or exposed through `express.static`; only authenticated routes may deliver them.]
You are implementing the private storage boundary for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: local disk behind a swappable provider interface, with thumbnail and original written as one logical pair.
Files in scope: `server/src/config.ts`, `server/src/lib/attachment-storage.ts`, `server/src/lib/attachment-upload.ts`, `server/src/lib/attachment-storage.test.ts`.
Available after: none.
Architecture rule: use a configurable private path and memory-backed multipart parsing; never reuse `UPLOADS_DIR` or `client/public/uploads`.
[RESTATE: Attachment bytes must never be written below `client/public` or exposed through `express.static`; only authenticated routes may deliver them.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a self-host sets `ATTACHMENTS_DIR`, When the production provider initializes, Then the resolved root equals and writes only below that directory; without the override, both documented runtime defaults are outside public uploads.
Given a thumbnail/original pair, When storage writes then removes it, Then both paths are cleaned up and repeated cleanup is harmless.
Given the card-create parser profile, When more than three pairs or a file over 10MB arrives, Then Multer rejects before provider write; given the existing-card profile, When a four-image batch arrives, Then Multer accepts it, while requests exceeding its documented pair/file/parts ceilings reject before provider invocation.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Provider interface is swappable without route code depending on raw path construction.
- No user filename or public uploads path is trusted for storage.
- File-write failures and cleanup failures are surfaced to the caller or logged without hiding successful DB state.
- Tests cover real configuration resolution, temporary filesystem behavior, both parser profiles, and every per-file/files/parts ceiling before route work.

Must-not-have:

- `express.static` registration for the private directory.
- Multer diskStorage pointing at `client/public/uploads`.
- A global parser cap of three that prevents existing-card partial batches from reaching the DB capacity guard.
- Object storage, CDN, presigned URL, quota, sweeper, or new image-processing dependency.

Open question risks:

- If a self-host uses a read-only or unavailable `ATTACHMENTS_DIR`, report NEEDS_CONTEXT rather than silently falling back to public storage.

Rollback note:

- The provider is additive. Disable attachment UI/routes while leaving the private directory/volume mounted; existing logo uploads remain unchanged.

## STOP CONDITIONS

Done when: provider and parser tests pass, typecheck is green, and both commits exist.
Uncertain when: the configured private path resolves inside `client/public`; stop and report NEEDS_CONTEXT.
Escalate when: implementation requires a native image library, object storage, or public static serving.

---

### Task 3: Extend image validation and client thumbnail preprocessing [depends: T2] [test-risk]

## OBJECTIVE

Extend the existing signature validator with PNG IHDR/JPEG SOF dimension checks and add a client helper that enforces the same 4096px ceiling, derives clipboard extensions, creates Canvas thumbnails, and falls back to original bytes when Canvas encoding fails.

Files:

- Modify: `server/src/lib/file-validator.ts`
- Modify: `server/src/__tests__/file-validator.test.ts`
- Create: `client/src/lib/imageAttachments.ts`
- Create: `client/src/lib/imageAttachments.test.ts`

Steps:

1. Write failing test for: server-side PNG/JPEG byte-header dimension parsing rejects a direct API bypass over 4096×4096.
   Test file: `server/src/__tests__/file-validator.test.ts`
   Level: unit

   Test intent:
   Given a syntactically valid PNG IHDR or JPEG SOF header declaring a width or height greater than 4096, When `validateFileContent()` validates it as PNG/JPEG, Then it returns invalid with a dimension-specific error before route persistence; valid dimensions remain valid. Given truncated or malformed IHDR/SOF bytes, When the same validator runs, Then it rejects safely with a validation result and never throws an uncaught parser exception.

   Exercise through:
   - exported `validateFileContent()` and its public dimension result; do not test parser internals directly.

   Test doubles:
   - deterministic byte buffers representing PNG IHDR/JPEG SOF headers
   - do not mock `validateFileContent()` or Buffer parsing.

   Expected RED:
   - current validation checks only signature/MIME and accepts oversized declared dimensions.

2. Run test — verify FAIL:
   `npm run test -- server/src/__tests__/file-validator.test.ts`
   Expected failure: oversized-dimension fixtures are currently reported valid or have no dimension error.

3. Implement minimal code to satisfy the test:
   File: `server/src/lib/file-validator.ts`
   Implement: PNG IHDR width/height parsing and JPEG SOF marker scanning, with a 4096px maximum for either source dimension. Preserve existing signature/MIME checks and return a stable validation error that route code can map to the user-facing dimension message.

4. Run test — verify PASS:
   `npm run test -- server/src/__tests__/file-validator.test.ts`
   Expected: signature, MIME, valid-dimension, and oversized-dimension tests PASS.

5. Refactor while green (bounded):
   - Keep PNG/JPEG parsing in the domain validator; do not add `sharp`, `jimp`, or a generic binary utility.
   - Re-run the validator test and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/lib/file-validator.ts server/src/__tests__/file-validator.test.ts`
   `git commit -m "feat(attachments): validate image dimensions from bytes"`

7. Write failing test for: client image preparation validates MIME/dimensions, derives a clipboard filename extension, creates a thumbnail, and falls back to original bytes when Canvas fails.
   Test file: `client/src/lib/imageAttachments.test.ts`
   Level: unit

   Test intent:
   Given a PNG/JPEG `File` or a clipboard `Blob`, When the image-preparation helper runs, Then:
   - unsupported MIME, over-10MB, and over-4096px inputs return a tagged invalid result that preserves the original file and product validation message for an error chip
   - a clipboard blob receives `.png` or `.jpg` from detected MIME
   - successful Canvas encoding returns thumbnail bytes plus original bytes
   - Canvas/context/toBlob failure returns original bytes as both thumbnail and original payload

   Exercise through:
   - exported client image-preparation functions; do not render a component or mock the helper itself.

   Test doubles:
   - stub `document.createElement("canvas")`, image decode metadata, and `toBlob` outcomes
   - do not mock the image-preparation module under test or the native `File`/`Blob` payload semantics.

   Expected RED:
   - `client/src/lib/imageAttachments.ts` does not exist, so there is no shared client validation/thumbnail behavior or tagged invalid result for staged chips.

8. Run test — verify FAIL:
   `npm run test -- client/src/lib/imageAttachments.test.ts`
   Expected failure: helper import fails because client image preparation has not been implemented.

9. Implement minimal code to satisfy the test:
   File: `client/src/lib/imageAttachments.ts`
   Implement: shared constants (`MAX_ATTACHMENT_COUNT`, `MAX_ATTACHMENT_BYTES`, `MAX_IMAGE_DIMENSION`), MIME/extension mapping, a tagged preparation result that preserves invalid input/error text for staged chips, client dimension validation, Canvas downscale preserving aspect ratio, and original-byte fallback. Export the prepared pair shape consumed by both existing-card and staged-create flows.

10. Run test — verify PASS:
    `npm run test -- client/src/lib/imageAttachments.test.ts`
    Expected: client validation, clipboard extension, Canvas success, and fallback tests PASS.

11. Refactor while green (bounded):
    - Keep browser-specific Canvas access behind the helper boundary and avoid duplicate limit constants in components.
    - Re-run the client test and `npm run typecheck` — both must stay PASS.

12. Commit:
    `git add client/src/lib/imageAttachments.ts client/src/lib/imageAttachments.test.ts`
    `git commit -m "feat(attachments): add client image preparation"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — MIME/size/dimension limits, clipboard extension derivation, Canvas fallback, and no image library.
- `server/src/lib/file-validator.ts` — existing signature/MIME implementation to extend.
- `server/src/__tests__/file-validator.test.ts` — existing validator fixtures and Vitest conventions.
- `client/src/components/task-entry/TaskTitleEditor.tsx` — client input conventions that later consume the prepared pair.
- `docs/pocket/rule/creative-brief.md` — UI-facing copy and calm error handling constraints.

## WHY THIS APPROACH

Complexity: standard
Justification: Server byte parsing and browser Canvas preprocessing are separate runtimes but share one user-visible contract. Keeping them in one foundation task forces the same 4096px/10MB/MIME semantics while giving each runtime its own RED cycle and test boundary.

## SANDWICH CONTEXT

[CRITICAL: Client checks are only UX feedback; every uploaded original and thumbnail must be revalidated server-side before any DB insert or file write.]
You are implementing image validation/preprocessing for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: client Canvas thumbnailing plus server PNG/JPEG header parsing, with no image-processing dependency.
Files in scope: `server/src/lib/file-validator.ts`, `server/src/__tests__/file-validator.test.ts`, `client/src/lib/imageAttachments.ts`, `client/src/lib/imageAttachments.test.ts`.
Available after: T2 storage/upload boundary.
Architecture rule: preserve existing signature validation and enforce the server dimension check even for direct API callers.
[RESTATE: Client checks are only UX feedback; every uploaded original and thumbnail must be revalidated server-side before any DB insert or file write.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a valid PNG/JPEG under 10MB and within 4096×4096, When server validation runs, Then it accepts the content only when signature, MIME, and dimensions agree.
Given a direct API payload with a valid signature but a PNG IHDR/JPEG SOF dimension over 4096, When server validation runs, Then it rejects before persistence.
Given a clipboard image without a filename, When client preparation runs, Then it derives a safe `.png`/`.jpg` name and uses the same validation/upload payload as picker files.
Given an invalid staged image, When preparation runs, Then the original file and user-facing error remain available for an editable error chip and no invalid pair is returned for upload.
Given Canvas thumbnail generation fails, When client preparation continues, Then original bytes are used for both thumbnail and original payload without bypassing server validation.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- PNG IHDR and JPEG SOF parsing is bounded and rejects malformed/truncated headers safely.
- Exact product messages can be mapped for unsupported format, over-size, and over-dimension errors.
- Client and server share the same limits but do not trust the client as a security boundary.
- Canvas fallback is observable and tested.

Must-not-have:

- Trusting filename extension or declared MIME without signature validation.
- Server-side Canvas/sharp/jimp/native image dependency.
- Accepting GIF/WebP/non-image files for board attachments.

Open question risks:

- Lowest-capability mobile Canvas behavior remains an empirical risk; the fallback must avoid blank thumbnail bytes, and any browser-specific failure must be reported as DONE_WITH_CONCERNS rather than hidden.

Rollback note:

- Revert only the new attachment validation/preparation entry points if needed; existing logo validation remains usable.

## STOP CONDITIONS

Done when both runtime cycles pass, client/server typechecks are green, and both commits exist.
Uncertain when a browser cannot expose reliable dimensions before Canvas; report NEEDS_CONTEXT rather than weakening server validation.
Escalate when validation requires a new native dependency or accepts a non-PNG/JPEG MIME.

---

### Task 4: Define attachment response hydration and realtime contract [depends: T1] [test-risk]

## OBJECTIVE

Expose safe attachment summaries on board/card responses in deterministic cover order and add explicit attachment realtime event types without exposing filesystem paths or changing tracker/work-item responses.

Files:

- Create: `server/src/routes/attachment-response.ts`
- Create: `server/src/routes/attachment-response.test.ts`
- Create: `server/src/routes/attachment-response.integration.test.ts`
- Modify: `server/src/routes/card-response.ts`
- Modify: `server/src/routes/board.ts`
- Modify: `server/src/routes/cards.ts`
- Modify: `server/src/realtime.ts`
- Modify: `client/src/types.ts`
- Modify: `client/src/types.test.ts`

Steps:

1. Write failing tests for: safe attachment mapping plus persisted board/card response hydration.
   Test files: `server/src/routes/attachment-response.test.ts`, `server/src/routes/attachment-response.integration.test.ts`
   Level: unit mapper + integration

   Test intent:
   Given attachment rows with different timestamps/tied timestamps and an isolated workspace/card with persisted rows, When the mapper and authorized board/card routes run, Then:
   - lower `created_at`, then lower `id`, determines order
   - summaries contain only id, safe thumbnail/original/download URLs, MIME, and created timestamp
   - board and card-detail responses include the same ordered list
   - no raw storage path appears

   Exercise through:
   - pure response mapper for URL/order assertions and real authenticated board/card HTTP routes for DB query/hydration.

   Test doubles:
   - plain mapper fixtures; isolated PostgreSQL and temporary provider files for route integration
   - do not mock response hydration, attachment selection, board/card routes, or URL construction.

   Expected RED:
   - no attachment response module/hydration field exists, so both pure and persisted-route assertions fail.

2. Run test — verify FAIL:
   `npm run test -- server/src/routes/attachment-response.test.ts && RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/attachment-response.integration.test.ts`
   Expected failure: mapper imports and board/card attachment response assertions fail.

3. Implement minimal code to satisfy the test:
   Files: `server/src/routes/attachment-response.ts`, `server/src/routes/card-response.ts`, `server/src/routes/board.ts`, `server/src/routes/cards.ts`
   Implement: typed attachment-row selection/hydration, deterministic ordering by `created_at,id`, safe URL construction using the locked workspace/card route shape, and board/detail/create-card hydration inputs. Update board and card queries without joining tracker tables.

4. Run test — verify PASS:
   `npm run test -- server/src/routes/attachment-response.test.ts && RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/attachment-response.integration.test.ts`
   Expected: mapper, URL-safety, persisted board/card hydration, and empty-list assertions PASS.

5. Refactor while green (bounded):
   - Keep attachment query/serialization domain-scoped; do not duplicate URL construction.
   - Re-run both test commands and `npm run typecheck` — all must stay PASS.

6. Commit:
   `git add server/src/routes/attachment-response.ts server/src/routes/attachment-response.test.ts server/src/routes/attachment-response.integration.test.ts server/src/routes/card-response.ts server/src/routes/board.ts server/src/routes/cards.ts`
   `git commit -m "feat(attachments): hydrate safe card attachment summaries"`

7. Write failing test for: client card/activity fixtures accept the new attachment shape while the server realtime union accepts attachment mutation events.
   Test file: `client/src/types.test.ts`
   Level: unit (type/contract)

   Test intent:
   Given the client `Card`/`ActivityEvent` fixtures and server typecheck, When typed attachment-added/removed fixtures are compiled and exercised, Then card attachment URLs, metadata-only activity payload, and event names are accepted without widening tracker/work-item contracts.

   Exercise through:
   - executable typed fixtures in `client/src/types.test.ts` plus the server TypeScript compiler.

   Test doubles:
   - plain typed fixtures only
   - do not mock type declarations or contract modules.

   Expected RED:
   - `Card`/`ActivityEvent` lack attachment fields and `BoardEvent` lacks attachment event literals.

8. Run test — verify FAIL:
   `npm run test -- client/src/types.test.ts && npm run typecheck`
   Expected failure: client fixtures/typecheck fail because attachment card/activity/event types are missing.

9. Implement minimal code to satisfy the test:
   Files: `server/src/realtime.ts`, `client/src/types.ts`
   Implement: `attachment.added`/`attachment.removed` event literals and payload fields, `CardAttachment`/`Card.attachments`, and activity type literals for `attachment_added`/`attachment_removed`. Keep payloads metadata-only.

10. Run test — verify PASS:
    `npm run test -- client/src/types.test.ts && npm run typecheck`
    Expected: client contract test and server/client typechecks PASS.

11. Refactor while green (bounded):
    - Re-run both response tests, the client type test, the response integration test, and `npm run typecheck` — all must stay PASS.

12. Commit:
    `git add server/src/realtime.ts client/src/types.ts client/src/types.test.ts`
    `git commit -m "feat(attachments): define response and realtime contracts"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — safe delivery URLs, oldest-cover ordering, SSE event requirement, activity payload restriction.
- `server/src/routes/card-response.ts` — existing hydration/serialization boundary.
- `server/src/routes/board.ts` and `server/src/routes/cards.ts` — board/detail query paths that must include attachment summaries.
- `server/src/realtime.ts` — existing `BoardEvent` union and `publishEvent()` shape.
- `client/src/types.ts` — current `Card`, `ActivityEvent`, and `BoardEvent` contracts.

## WHY THIS APPROACH

Complexity: deep
Justification: This is the shared interface task for database rows, board/detail response hydration, client types, and event names. Defining it before route/UI work prevents server and client from inventing different URL or event shapes.

## SANDWICH CONTEXT

[CRITICAL: Response hydration may expose only safe authenticated route URLs; it must never expose `thumbnail_path`, `original_path`, private roots, or image bytes.]
You are implementing the shared response/realtime contract for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: one row maps to three authenticated URL paths: thumbnail, original inline, and original download.
Files in scope: `server/src/routes/attachment-response.ts`, `server/src/routes/attachment-response.test.ts`, `server/src/routes/attachment-response.integration.test.ts`, `server/src/routes/card-response.ts`, `server/src/routes/board.ts`, `server/src/routes/cards.ts`, `server/src/realtime.ts`, `client/src/types.ts`, `client/src/types.test.ts`.
Available after: T1 schema/types.
Architecture rule: card response hydration must not touch tracker/unified work-item response logic.
[RESTATE: Response hydration may expose only safe authenticated route URLs; it must never expose `thumbnail_path`, `original_path`, private roots, or image bytes.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given three attachments A/B/C uploaded in order, When board/detail hydration runs, Then the response lists A/B/C with A as cover and no private path leakage.
Given two rows with identical `created_at`, When response ordering runs, Then lower attachment id wins.
Given an attachment mutation, When the realtime contract is compiled, Then `attachment.added`/`attachment.removed` payloads are accepted and activity remains plain text/metadata-only.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Board and card detail responses hydrate the same ordered attachment summary shape.
- URL paths preserve workspace/card/attachment identity and separate inline/download routes.
- `Card` and event contracts are explicit and tracker contracts remain unchanged.
- Every behavioral cycle has its own test command.

Must-not-have:

- Raw storage path, disk root, inline thumbnail bytes, or public `/uploads` URL in JSON.
- Changes to `work-item-response.ts`, `tracker_items`, or `workItemMutations.ts`.

Open question risks:

- If empirical cookie testing shows `<img src>` cannot authenticate in dev/prod, report NEEDS_CONTEXT to switch the client gallery to credentialed blob fetches without changing route authorization.

Rollback note:

- Response fields/events are additive. Hide attachment UI/routes while existing card response fields remain backward-compatible.

## STOP CONDITIONS

Done when response/event cycles pass and server/client typechecks are green.
Uncertain when a response consumer requires raw filesystem paths; stop and report an architecture violation.
Escalate when implementing hydration requires modifying tracker/unified work-item serialization.

---

### Task 5: Add shared ownership guard and authenticated cached delivery [depends: T2, T4] [test-risk]

## OBJECTIVE

Implement the one shared ownership-chain guard and the three authenticated GET delivery paths with private caching, ETags, inline content disposition, and forced download behavior.

Files:

- Create: `server/src/routes/card-attachments.ts`
- Modify: `server/src/routes.ts`
- Test: `server/src/routes/card-attachments.integration.test.ts`

Steps:

1. Write failing test for: a workspace member can fetch an attachment only when workspace, card, and attachment ids form one ownership chain.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a member of workspace W and an attachment owned by card C in W, When the member requests the thumbnail/original route, Then the server returns the correct bytes; given a non-member or an attachment/card from another workspace, Then it returns 403/404 and never reads or sends bytes.

   Exercise through:
   - Supertest HTTP routes mounted through the real `api` router and the shared guard.

   Test doubles:
   - temporary private storage files and existing isolated database fixtures
   - mock only realtime if the harness starts Redis; do not mock membership/card/attachment queries or the guard under test.

   Expected RED:
   - no card attachment routes or ownership-chain lookup exists, so the requested route is 404 or authorization is incomplete.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: delivery route is not registered and ownership-chain cases cannot pass.

3. Implement minimal code to satisfy the test:
   Files: `server/src/routes/card-attachments.ts`, `server/src/routes.ts`
   Implement: one reusable middleware/factory that checks workspace membership, active card workspace ownership, and attachment-to-card ownership; register the router under `/workspaces/:workspaceId`; add thumbnail/original inline GET handlers that read only provider paths after the guard.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected: authorized ownership-chain requests return bytes and cross-workspace/non-member requests are denied.

5. Refactor while green (bounded):
   - Keep the guard in one domain module and reuse it for every later POST/GET/DELETE route.
   - Re-run the integration command and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/routes/card-attachments.ts server/src/routes.ts server/src/routes/card-attachments.integration.test.ts`
   `git commit -m "feat(attachments): add ownership-guarded delivery routes"`

7. Write failing test for: cached thumbnail/original requests return private cache headers and a matching ETag produces 304.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given an authorized attachment delivery request, When the client sends no conditional header, Then the response includes `Cache-Control: private, max-age=300` and a stable ETag; when it sends `If-None-Match` with that ETag, Then the server returns 304 without a body.

   Exercise through:
   - real GET HTTP routes and response headers, not a cache helper.

   Test doubles:
   - temporary file stat/read boundary and deterministic file metadata
   - do not mock Express response caching behavior or the route under test.

   Expected RED:
   - the first delivery cycle adds authorized byte routes but deliberately omits ETag/private-cache behavior, so cache-header and conditional-request assertions fail.

8. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: the existing delivery handlers return bytes without the required private cache header/stable ETag and do not produce the required 304 response.

9. Implement minimal code to satisfy the test:
   File: `server/src/routes/card-attachments.ts`
   Implement: ETag generation from file metadata, `Cache-Control: private, max-age=300`, conditional 304 handling, and separate `/thumbnail` and `/original` paths. Keep the ETag stable for unchanged bytes.

10. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: private cache and 304 assertions PASS.

11. Refactor while green (bounded):
    - Do not add public proxy caching or merge inline/download paths.
    - Re-run the integration command — must stay PASS.

12. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "feat(attachments): add private attachment caching"`

13. Write failing test for: explicit download uses the distinct path and forced attachment disposition while inline original remains inline.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration

    Test intent:
    Given an authorized member viewing an original, When they request `/original`, Then `Content-Disposition` is inline; when they request `/original/download`, Then it is attachment with a safe generated filename and the inline path remains independently cacheable.

    Exercise through:
    - both public delivery endpoints over HTTP.

    Test doubles:
    - temporary provider files
    - do not mock content-disposition behavior or route selection.

    Expected RED:
    - the distinct forced-download route and disposition are not present.

14. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: download route/disposition assertions fail.

15. Implement minimal code to satisfy the test:
    File: `server/src/routes/card-attachments.ts`
    Implement: `/original/download` with `Content-Disposition: attachment`, sanitized provider filename, and `/original` with `inline`; apply the same ownership/cache guard to both.

16. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: inline/download and cache tests PASS.

17. Refactor while green (bounded):
    - Re-run the complete integration file and server typecheck; both must stay PASS.

18. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "feat(attachments): separate inline and download delivery"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — locked five route surfaces, ownership chain, private cache headers, ETag, and inline/download distinction.
- `server/src/middleware/workspace.ts` — existing membership middleware behavior.
- `server/src/routes.ts` — authenticated workspace router registration.
- `server/src/index.ts` — public static uploads boundary that this route must not reuse.
- `server/src/routes/attachment-response.ts` — URL/path contract from T4.
- Multer/Express documentation — route middleware/error boundary conventions.

## WHY THIS APPROACH

Complexity: deep
Justification: Authorization, filesystem reads, HTTP caching, and content disposition cross several boundaries and are security-sensitive. Integration tests through the real router are required; unit-testing a guard in isolation would not prove route registration or ID-substitution resistance.

## SANDWICH CONTEXT

[CRITICAL: Every delivery response must pass the full workspace-member → card-in-workspace → attachment-on-card chain before reading bytes.]
You are implementing authenticated attachment delivery for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: authenticated delivery routes, not capability URLs or public static files.
Files in scope: `server/src/routes/card-attachments.ts`, `server/src/routes.ts`, `server/src/routes/card-attachments.integration.test.ts`.
Available after: T2 storage and T4 response/event contract.
Architecture rule: reuse one guard for POST, all GET paths, and DELETE; private files are not served by `express.static`.
[RESTATE: Every delivery response must pass the full workspace-member → card-in-workspace → attachment-on-card chain before reading bytes.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a member requests an attachment in their workspace, When the authorized thumbnail/original route runs, Then correct bytes and private cache headers are returned.
Given a non-member or cross-workspace/card/attachment id substitution, When the route runs, Then it returns 403/404 without bytes.
Given a matching ETag, When the same authorized URL is requested with `If-None-Match`, Then it returns 304.
Given the explicit download button path, When `/original/download` is requested, Then `Content-Disposition: attachment` is returned while `/original` remains inline.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Shared guard is called by every attachment route.
- Private cache header, ETag, 304, and distinct inline/download paths are tested over HTTP.
- Provider paths are resolved only after authorization and are never user-controlled.

Must-not-have:

- Public static serving, signed/capability-only URLs, cross-workspace lookup, or tracker lookup.
- Authorization checks duplicated separately in each handler.

Open question risks:

- Cross-origin `<img src>` cookie behavior must be verified by T10; if it fails, change client transport only, not this guard.

Rollback note:

- Hide/remove the new route registration and UI; retain additive table/provider files.

## STOP CONDITIONS

Done when all delivery integration cycles pass and typecheck is green.
Uncertain when a route can read bytes before the ownership query completes; stop immediately.
Escalate when a proposed fix bypasses per-request membership or exposes a public URL.

---

### Task 6: Implement existing-card upload, DB lock/count guard, activity, and SSE [depends: T3, T4, T5] [test-risk]

## OBJECTIVE

Add the existing-card multipart POST path with server validation, DB-level row lock/count enforcement, partial batch acceptance, activity logging, private-file cleanup on rollback, and `attachment.added` broadcast.

Files:

- Modify: `server/src/routes/card-attachments.ts`
- Modify: `server/src/routes/helpers.ts`
- Modify: `server/src/realtime.ts` (only the real hub/test seam)
- Modify: `server/src/routes/card-attachments.integration.test.ts`

Steps:

1. Write failing test for: one valid existing-card upload stores both bytes, creates one row/activity event, leaves `card.version` unchanged, and publishes an attachment event.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a member and a card with one existing attachment, When they upload a valid 2MB PNG pair, Then exactly one attachment row/files are stored, an `attachment_added` card event uses the card's current `to_column_id`, `publishEvent()` receives `attachment.added`, the response reports the new total, and `cards.version` is unchanged.

   Exercise through:
   - `POST /api/workspaces/:wsId/cards/:cardId/attachments` with multipart files and the real DB transaction.

   Test doubles:
   - temporary private storage and mocked realtime publisher only
   - do not mock the DB transaction, lock/count query, route, or activity helper under test.

   Expected RED:
   - the POST route is not implemented and `recordActivity()` does not accept `attachment_added`.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: POST returns 404/typecheck rejects the new event type.

3. Implement minimal code to satisfy the test:
   Files: `server/src/routes/card-attachments.ts`, `server/src/routes/helpers.ts`
   Implement: paired multipart parsing for the already-valid fixture path, a non-concurrent happy-path count check, provider writes, attachment insert, `recordActivity(..., "attachment_added", { cardId, toColumnId: currentColumnId })`, publish after commit, and response with total/count. Leave invalid-payload validation/error mapping, rollback cleanup, and concurrency serialization for their dedicated RED cycles below; do not update `cards.version`.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected: valid upload, activity, realtime, and version-isolation assertions PASS.

5. Refactor while green (bounded):
   - Keep validation/storage/transaction orchestration in the attachment route/provider boundary; do not duplicate signature parsing.
   - Re-run the integration file and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/routes/card-attachments.ts server/src/routes/helpers.ts server/src/routes/card-attachments.integration.test.ts`
   `git commit -m "feat(attachments): upload images to existing cards"`

7. Write failing test for: concurrent uploads at 2/3 allow exactly one success and never create a fourth row.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a card with two existing attachments and a test-only post-count/pre-insert contention hook, When the first valid upload pauses after counting and the second upload starts against the same card, Then the second cannot reach the hook before the first is released and commits; afterward exactly one request succeeds, the other returns the over-cap error, and the final count is exactly three with no orphan file for the rejected request. The test always releases the first request after observing the second request's blocked/reached state so it cannot deadlock.

   Exercise through:
   - two HTTP POST requests against the same card, the real PostgreSQL transaction/row lock, and a narrow deterministic contention hook at the count/insert seam.

   Test doubles:
   - temporary storage, realtime publisher, and a synchronization latch that observes/releases the narrow route hook
   - do not mock PostgreSQL locking/count behavior, the count/insert queries, or the attachment route.

   Expected RED:
   - without the locked count guard, the second request deterministically reaches the post-count hook while the first is paused, so both can observe two rows and the final assertions expose the fourth insert.

8. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: both uploads may succeed or the loser may leave a file/row, violating 3-image cap.

9. Implement minimal code to satisfy the test:
   Files: `server/src/routes/card-attachments.ts`, `server/src/routes/card-attachments.integration.test.ts`
   Implement: lock the card row inside each insert transaction before counting; choose available slots while holding the lock; unlink any pair that cannot be committed or whose transaction rolls back; expose only the narrow optional post-count/pre-insert hook needed for deterministic integration-test contention, with no production timing behavior when it is unset.

10. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: exactly one concurrent request succeeds and final count never exceeds three.

11. Refactor while green (bounded):
    - Keep the count decision and insert in the same transaction; do not replace the lock with an application-memory mutex.
    - Re-run the complete integration file — must stay PASS.

12. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "fix(attachments): serialize card attachment capacity"`

13. Write failing test for: a card already at capacity rejects a fourth image with the exact cap message and zero side effects.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration

    Test intent:
    Given a card with three existing attachments, When a member submits one additional valid image pair, Then the route returns the exact `Max 3 images per card` response and creates no file, attachment row, activity row, realtime event, or `cards.version` change.

    Exercise through:
    - the public existing-card multipart POST route and real locked DB count transaction.

    Test doubles:
    - temporary private storage and realtime publisher spy
    - do not mock the capacity calculation, card-row lock, route, activity helper, or transaction.

    Expected RED:
    - the concurrency cycle serializes racing inserts but does not yet require the zero-slot route response, exact cap message, or proof that a fully rejected request performs no writes/side effects.

14. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: the at-cap request returns a non-specific result or writes a file/row/activity/event instead of the exact zero-side-effect rejection.

15. Implement minimal code to satisfy the test:
    File: `server/src/routes/card-attachments.ts`
    Implement: while holding the card-row lock, return the exact cap error when available slots are zero before any provider write, attachment/activity insert, or publish scheduling; keep `cards.version` unchanged.

16. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: exact 3/3 rejection and all zero-side-effect assertions PASS.

17. Refactor while green (bounded):
    - Reuse the locked available-slot calculation for full-cap and partial-cap paths without duplicating guard logic.
    - Re-run the complete integration file — must stay PASS.

18. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "fix(attachments): reject uploads at card capacity"`

19. Write failing test for: batch overflow accepts what fits and rejects the rest with total-state and batch-result messages.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration

    Test intent:
    Given a card with one existing attachment, When four valid images are submitted in one batch, Then two are stored, two are rejected, the response/UI-facing payload says `2 of 4 images added — card limit is 3 images`, and the persistent count is `3/3`; exactly two attachment-added activity rows and two post-commit realtime events exist, while rejected images create no row, file, activity, or event.

    Exercise through:
    - the public multipart POST response and persisted attachment rows.

    Test doubles:
    - temporary storage and a realtime publisher spy
    - do not mock capacity calculation or the transaction.

    Expected RED:
    - the route currently has no batch result contract and cannot partially accept by locked capacity.

20. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: partial acceptance/result-message assertions fail.

21. Implement minimal code to satisfy the test:
    File: `server/src/routes/card-attachments.ts`
    Implement: deterministic accepted/rejected result metadata, capacity-only per-pair rejection reasons, accepted-count/total-count fields, and exact overflow message; ensure rejected pairs are never written and accepted pairs each create activity/realtime records according to the event contract. Leave MIME/signature/size/dimension validation error mapping for its following RED cycle.

22. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: batch acceptance, rejection, `3/3` total, and cleanup assertions PASS.

23. Refactor while green (bounded):
    - Re-run the complete integration file, server typecheck, and root `npm run test` before commit; all must stay PASS.

24. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "feat(attachments): support partial batch uploads"`

25. Write failing test for: invalid format, oversized file, disguised signature, and oversized dimensions are rejected before row/file persistence.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration

    Test intent:
    Given a non-image, over-10MB, PDF-disguised-as-PNG, or under-10MB image declaring dimensions above 4096, When the existing-card upload endpoint receives it, Then it returns the correct validation message and creates no row or file. Given a valid thumbnail paired with an invalid original, or an invalid thumbnail paired with a valid original, When the pair is submitted, Then the pair is rejected before either payload is written; repeat the signature, size, and dimension cases for both fields.

    Exercise through:
    - direct multipart HTTP requests, including client-bypass dimension fixtures for each thumbnail/original position.

    Test doubles:
    - temporary storage directory
    - do not mock validator or route persistence.

    Expected RED:
    - route-level validation and error mapping are not yet present.

26. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: invalid upload requests are accepted, return generic errors, or persist bytes.

27. Implement minimal code to satisfy the test:
   File: `server/src/routes/card-attachments.ts`
   Implement: exact user-facing error mapping (`Only PNG and JPEG accepted`, `File size must be under 10MB`, and the dimension rejection) before provider writes/DB inserts.

28. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: all invalid-input cases reject with no persisted artifacts.

29. Refactor while green (bounded):
    - Re-run the complete integration file and server typecheck — must stay PASS.

30. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "fix(attachments): reject invalid upload payloads"`

31. Write failing test for: a real transaction failure after provider write rolls back every persistent and observable side effect.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration

    Test intent:
    Given a valid pair whose opaque paths match a test-only failure marker and a conditional `BEFORE INSERT ON attachments` trigger installed through the same configured application test pool on the exact relation used by the route, When the existing-card upload writes the pair and the insert raises a controlled database error, Then no attachment row or activity row commits, both newly written files are unlinked, no realtime event is published, and `cards.version` remains unchanged. The trigger is installed/removed serially and cannot affect unrelated fixtures.

    Exercise through:
    - the public multipart POST route, real provider writes, and the real application DB pool/relation used by that request.

    Test doubles:
    - temporary private storage, deterministic opaque-path marker, and realtime publisher spy
    - do not mock the DB transaction, attachment insert, cleanup provider, activity helper, or route.

    Expected RED:
    - the happy-path implementation has no tested post-write DB-failure cleanup boundary, so the forced insert error can leave files or emit activity/realtime too early.

32. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: the forced route-bound insert error leaves at least one file/side effect or changes the parent card version.

33. Implement minimal code to satisfy the test:
    File: `server/src/routes/card-attachments.ts`
    Implement: track every pair written for the request, remove those paths when the real insert transaction fails, keep activity inside the rollback boundary, and publish only after commit. Preserve the documented crash-window orphan risk without adding a sweeper.

34. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: forced post-write DB failure leaves no row, file, activity, event, or version change.

35. Refactor while green (bounded):
    - Keep rollback cleanup best-effort and observable without claiming filesystem/DB two-phase commit.
    - Re-run the complete attachment integration file and server typecheck — both must stay PASS.

36. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "fix(attachments): clean failed existing uploads"`

37. Write failing test for: a real attachment mutation reaches an in-process SSE subscriber as an `attachment.added` event for another viewer.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration (mutation → realtime seam)

    Test intent:
    Given a second viewer subscribed through the existing realtime hub, When the existing-card upload route commits a valid attachment, Then the actual post-commit `publishEvent` path delivers one SSE payload with `type: attachment.added`, the workspace/card id, and metadata-only payload; the test may fake Redis clients but must not replace the realtime hub or route publisher with a spy.

    Exercise through:
    - the public upload route, real in-process realtime hub/SSE handler, and a test subscriber connection.

    Test doubles:
    - fake Redis publisher/subscriber transport and temporary filesystem only at external boundaries
    - do not mock `publishEvent`, the realtime hub, the route, or the DB transaction.

    Expected RED:
    - current upload flow either has no event or the integration harness has no explicit attachment event delivery path to a subscriber.

38. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: the subscriber never receives the attachment mutation event or receives the wrong event shape.

39. Implement minimal code to satisfy the test:
    Files: `server/src/routes/card-attachments.ts`, `server/src/realtime.ts`, `server/src/routes/card-attachments.integration.test.ts`
    Implement: only the dependency-injection/test-harness seam needed to exercise the real realtime hub, preserving production `publishEvent` behavior and post-commit ordering.

40. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: real mutation-to-SSE event delivery assertions PASS.

41. Refactor while green (bounded):
    - Re-run the complete attachment integration file and server typecheck — both must stay PASS.

42. Commit:
    `git add server/src/routes/card-attachments.ts server/src/realtime.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "test(attachments): verify upload SSE delivery"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — existing-card rules, concurrency guard, batch result, event names, activity, and card-version isolation.
- `server/src/routes/helpers.ts` — `recordActivity()` closed event union and current-column activity constraint.
- `server/src/realtime.ts` — `publishEvent()` fallback behavior.
- `server/src/routes/card-attachments.ts` — T5 shared guard/delivery boundary.
- `server/src/lib/file-validator.ts` and `server/src/lib/attachment-storage.ts` — T2/T3 validation and storage APIs.
- `server/src/routes.integration.test.ts` — route fixture and realtime-mocking conventions.

## WHY THIS APPROACH

Complexity: deep
Justification: This task owns the hardest existing-card boundary: multipart input, two-byte-payload validation, filesystem cleanup, PostgreSQL row locking, activity, and realtime. Each GWT has an integration cycle so unit tests cannot accidentally miss concurrency or persistence behavior.

## SANDWICH CONTEXT

[CRITICAL: Capacity must be decided under a PostgreSQL card-row lock and committed attachment rows/files must never make `cards.version` change.]
You are implementing existing-card image upload for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: one logical attachment row receives thumbnail and original bytes through a local storage provider.
Files in scope: `server/src/routes/card-attachments.ts`, `server/src/routes/helpers.ts`, `server/src/realtime.ts`, `server/src/routes/card-attachments.integration.test.ts`.
Available after: T3 validation, T4 response/event contracts, T5 guard/delivery.
Architecture rule: use `recordActivity()` for every accepted image, publish only after commit, and never touch tracker/unified routes.
[RESTATE: Capacity must be decided under a PostgreSQL card-row lock and committed attachment rows/files must never make `cards.version` change.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a card with room, When a member uploads a valid PNG/JPEG pair, Then storage, attachment row, activity, response count, and SSE event all succeed without changing card.version.
Given a card at 2/3, When two uploads race, Then exactly one succeeds and the final count is 3.
Given a card at 3/3, When a fourth valid image is submitted, Then the route returns `Max 3 images per card` and creates no file, row, activity, event, or version change.
Given a card at 1/3, When four valid images arrive, Then two are stored, two rejected, the message says `2 of 4 images added — card limit is 3 images`, and the persistent total is `3/3`.
Given invalid MIME, size, signature, or dimensions, When the endpoint receives the payload, Then it rejects before writing a file or row.
Given provider bytes were written, When the real attachment insert transaction fails, Then no row, file, activity, realtime event, or card-version change remains.
Given another viewer is subscribed, When a valid upload commits, Then the real in-process realtime hub delivers exactly one metadata-only `attachment.added` SSE payload.

All tests PASS. Commits exist with messages matching `feat|fix(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Row lock and count check are in the same transaction as each accepted insert.
- Rejected/rolled-back pairs are unlinked and never left as rows.
- Activity uses `attachment_added`, plain metadata, current column id, and no thumbnail bytes.
- Realtime is published only after the DB transaction commits.

Must-not-have:

- Application-only mutex, card version bump, tracker writes, public storage, or all-or-nothing rejection of a valid batch that can fit partially.
- Generic error text where the specified validation/capacity message is required.

Open question risks:

- Accepted residual crash-window orphan risk remains; do not add a sweeper in this task.

Rollback note:

- Disable the POST route/UI while retaining additive schema; existing cards/columns remain usable.

## STOP CONDITIONS

Done when all seven integration cycles pass, typecheck is green, and commits exist.
Uncertain when PostgreSQL locking cannot be exercised with the available DB fixture; report NEEDS_CONTEXT rather than replacing it with a fake mutex.
Escalate when implementation touches `tracker_items`, changes `cards.version`, or writes rejected files.

---

### Task 7: Delete attachments and clean up soft-deleted cards [depends: T2, T4, T5, T6] [test-risk]

## OBJECTIVE

Implement confirmed attachment DELETE with activity/SSE and best-effort file cleanup, plus explicit attachment-row/file cleanup in the existing soft-delete card transaction while preserving card history and version semantics.

Files:

- Modify: `server/src/routes/card-attachments.ts`
- Modify: `server/src/routes/cards.ts`
- Modify: `server/src/routes/card-attachments.integration.test.ts`

Steps:

1. Write failing test for: deleting a non-cover or cover attachment updates rows/files, activity, realtime, and deterministic next cover without changing card.version.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a card with cover A and image B, When an authorized member deletes B, Then B's row/files disappear, A remains cover, `attachment_removed` activity and `attachment.removed` SSE are emitted; when A is deleted, B becomes the next cover; in both cases `cards.version` is unchanged.

   Exercise through:
   - `DELETE /api/workspaces/:wsId/cards/:cardId/attachments/:id` and a follow-up board/card response.

   Test doubles:
   - temporary private storage and realtime publisher spy
   - do not mock the ownership guard, DB delete transaction, or cover ordering.

   Expected RED:
   - DELETE route is not implemented, so rows/files remain and no removal event/activity exists.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: delete/cover/activity/SSE assertions fail because only delivery/upload routes exist.

3. Implement minimal code to satisfy the test:
   File: `server/src/routes/card-attachments.ts`
   Implement: shared-guarded DELETE, row deletion first inside a transaction, `recordActivity(..., "attachment_removed", { cardId, toColumnId: currentColumnId })`, commit-then-unlink of both files, publish `attachment.removed` after commit, and a 204 response. Leave `cards.version` untouched.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected: delete, cover reassignment, activity, SSE, and version-isolation assertions PASS.

5. Refactor while green (bounded):
   - Keep unlink best-effort after the row transaction; do not block a committed DB delete on an unlink exception.
   - Re-run the integration file and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
   `git commit -m "feat(attachments): delete images with activity events"`

7. Write failing test for: deleting a card with attachments explicitly removes attachment rows in the soft-delete transaction and unlinks files best-effort.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a card with two attachments, When the existing card DELETE endpoint succeeds, Then the card is soft-deleted, attachment rows are removed in that transaction, both files are unlinked after commit, and a simulated unlink failure does not turn the successful card deletion into a 500; no tracker row is touched.

   Exercise through:
   - existing `DELETE /api/workspaces/:wsId/cards/:id` route plus database/file inspection.

   Test doubles:
   - temporary storage with an injected unlink failure for the failure branch
   - do not mock the card delete transaction, FK/query behavior, or attachment cleanup selection.

   Expected RED:
   - current soft-delete handler only sets `cards.deleted_at`; attachment rows/files would survive because FK cascade does not run.

8. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: attachment rows/files remain after soft-delete or unlink failure handling is absent.

9. Implement minimal code to satisfy the test:
   File: `server/src/routes/cards.ts`
   Implement: select attachment paths while the card row is locked, delete attachment rows explicitly in the same transaction as the card soft-delete/activity, return cleanup paths with the transaction result, and unlink each path after commit without blocking the existing card-deleted event/204 response.

10. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: soft-delete cleanup, failure tolerance, and tracker-isolation assertions PASS.

11. Refactor while green (bounded):
    - Preserve `card_events` history and the existing soft-delete contract; retain schema FK cascade only for hard-delete fallback.
    - Re-run the complete integration file and server typecheck — both must stay PASS.

12. Commit:
    `git add server/src/routes/cards.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "fix(attachments): clean files on soft-deleted cards"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — delete ordering, confirmation boundary, cascade wording, best-effort unlink, and version isolation.
- `server/src/routes/cards.ts` — existing soft-delete transaction and card activity/event behavior.
- `server/src/routes/card-attachments.ts` — T5/T6 guard/upload/event route.
- `server/src/lib/attachment-storage.ts` — provider cleanup API.
- `server/src/db/schema.sql` — FK cascade and soft-delete schema reality.

## WHY THIS APPROACH

Complexity: deep
Justification: The spec's FK-cascade wording conflicts with the current soft-delete implementation. This task explicitly resolves that conflict without hard-deleting cards: attachment rows are removed in the soft-delete transaction and files are cleaned afterward, while direct attachment delete remains independently testable.

## SANDWICH CONTEXT

[CRITICAL: Preserve card soft-delete/activity history; attachment cleanup must not hard-delete cards or change `cards.version`.]
You are implementing attachment deletion and card-deletion cleanup for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: delete DB rows before best-effort file unlink; use explicit soft-delete cleanup because current cards are soft-deleted.
Files in scope: `server/src/routes/card-attachments.ts`, `server/src/routes/cards.ts`, `server/src/routes/card-attachments.integration.test.ts`.
Available after: T2 storage, T4 contracts, T5 guard, T6 upload/activity foundation.
Architecture rule: all attachment deletes use the shared ownership chain; card deletion preserves existing domain events and never touches tracker tables.
[RESTATE: Preserve card soft-delete/activity history; attachment cleanup must not hard-delete cards or change `cards.version`.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given cover A and image B, When B is deleted, Then A remains cover and B's row/files/activity/SSE are gone.
Given cover A and image B, When A is deleted, Then B is the next cover on response hydration.
Given a card with attachments, When the card is soft-deleted, Then attachment rows are explicitly deleted and files are unlinked best-effort without blocking card deletion.
Given an unlink failure, When the DB deletion has committed, Then the API still succeeds and records no false rollback.
Given any attachment delete, Then `cards.version` and `tracker_items` remain unchanged.

All tests PASS. Commits exist with messages matching `feat|fix(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Shared ownership guard protects DELETE.
- Row deletion precedes unlink; unlink failure cannot resurrect or roll back committed DB state.
- Explicit soft-delete cleanup preserves card history and publishes existing card-deleted events.
- Cover ordering naturally reverts to next/empty state.

Must-not-have:

- Hard-delete cards, delete card events, bump `cards.version`, or touch tracker tables.
- Orphaned attachment rows intentionally retained after a successful soft-delete.

Open question risks:

- Accepted orphan risk remains if the process crashes between commit and unlink; no sweeper is in scope.

Rollback note:

- Disable delete UI/route if needed; existing card deletion can be restored independently because cleanup code is additive.

## STOP CONDITIONS

Done when both integration cycles pass and typecheck is green.
Uncertain when the existing card-delete transaction cannot return cleanup paths safely; report NEEDS_CONTEXT.
Escalate when the implementation proposes hard deletion or changes card activity retention.

---

### Task 8: Add multipart card-create atomicity [depends: T2, T3, T4] [test-risk]

## OBJECTIVE

Extend board card creation to accept staged thumbnail/original pairs in the same multipart request, write files before the transaction, insert card and attachment rows atomically, unlink newly written files on failure, and preserve the existing JSON create path.

Files:

- Modify: `server/src/routes/card-create.ts`
- Modify: `server/src/routes/cards.ts`
- Modify: `server/src/lib/attachment-storage.ts` (narrow testable provider seam)
- Create: `server/src/routes/card-create-attachments.integration.test.ts`

Steps:

1. Write failing test for: a valid multipart card-create request creates the card and attachment row together and returns a hydrated cover.
   Test file: `server/src/routes/card-create-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a member, destination column, title, and one valid thumbnail/original pair, When they submit the multipart card-create request, Then the server writes the pair, inserts the card and attachment row in one DB transaction, records normal card creation plus attachment activity, publishes the card/attachment events after commit, and returns a card response with the cover summary. Given multiple pairs, When thumbnail/original fields are positionally paired, Then each row points to its matching pair; unequal field counts or more than three pairs are rejected before any card is created.

   Exercise through:
   - public `POST /api/workspaces/:wsId/cards` multipart boundary and real `createCard` transaction.

   Test doubles:
   - temporary private storage and realtime publisher spy
   - do not mock `prepareCreate`, `persistCreatedCard`, DB transaction, or attachment insert.

   Expected RED:
   - card creation currently parses JSON only and has no attachment fields/insert path.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-create-attachments.integration.test.ts`
   Expected failure: multipart request is not parsed or card response has no attachment row/cover.

3. Implement minimal code to satisfy the test:
   Files: `server/src/routes/cards.ts`, `server/src/routes/card-create.ts`
   Implement: attach the T2 `maxPairs: 3` memory-upload profile to the create route without breaking JSON requests; parse card metadata fields plus positionally paired files; reject unequal counts/parser overflow; for the already-valid fixture path, write files before opening the DB transaction, insert attachment rows inside the existing create transaction, hydrate the cover, and publish after commit. Leave byte-validation error mapping and every provider/DB failure cleanup branch for the dedicated RED cycle below.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-create-attachments.integration.test.ts`
   Expected: multipart create returns hydrated card/cover and preserves existing card creation activity/events.

5. Refactor while green (bounded):
   - Keep normal JSON card create behavior unchanged when no files are supplied.
   - Re-run the integration command and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/routes/cards.ts server/src/routes/card-create.ts server/src/routes/card-create-attachments.integration.test.ts`
   `git commit -m "feat(attachments): create cards with staged images"`

7. Write failing test for: invalid staged bytes, mid-batch provider failure, or a deterministic real database failure creates no card/attachment row and cleans every file written earlier in the request.
   Test file: `server/src/routes/card-create-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a staged 15MB/invalid-signature/oversized-dimension image, When multipart card-create is submitted, Then validation rejects before any provider write and no card/attachment/activity/event exists. Given multiple valid pairs and a provider that writes the first pair but raises on the second, When multipart card-create is submitted, Then every file from the first pair is removed and no card/attachment/activity/event exists. Given valid written pairs and a conditional temporary `BEFORE INSERT ON attachments` trigger installed through the exact application test pool and relation used by the public request, When the insert raises a controlled database error, Then the card and attachment transaction rolls back, all newly written bytes are unlinked, no activity or `card.created`/`attachment.added` event escapes, and the response is a retryable validation/server error suitable for an editable client form.

   Exercise through:
   - multipart create HTTP boundary with real validation, sequential provider writes/cleanup, and real DB rollback; the conditional trigger is installed/removed serially through the same configured application pool on the exact `attachments` relation used by the route.

   Test doubles:
   - temporary storage, a provider wrapper that delegates the first pair to real temporary-disk storage and fails on the second pair, a deterministic trigger marker, and realtime publisher spy
   - do not mock the DB transaction, route, first-pair filesystem write/cleanup, attachment insert, or the application pool/relation; use the real conditional DB trigger for deterministic rollback.

   Expected RED:
   - the first cycle deliberately omitted byte-error and failure-cleanup branches, so invalid error mapping is incomplete and a second provider write or route-bound attachment insert failure can leave earlier files or observable side effects.

8. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-create-attachments.integration.test.ts`
   Expected failure: invalid create leaves a card/file, or the temporary DB failure does not roll back and clean up.

9. Implement minimal code to satisfy the test:
   Files: `server/src/routes/card-create.ts`, `server/src/lib/attachment-storage.ts`
   Implement: all-pairs validation before persistence, atomic card/attachment DB inserts, cleanup of every path accumulated from earlier successful pair writes when a later provider write or any pre-commit step fails, exact validation errors, and a narrow storage-provider injection seam with the production provider as default so the integration test can force a mid-batch filesystem failure without mocking the transaction. Bind the conditional trigger test to the actual route pool/relation and remove it reliably after the serial test. Keep the accepted v1 idempotency residual risk.

10. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-create-attachments.integration.test.ts`
    Expected: invalid, mid-batch provider-failure, and DB-rollback requests leave no card, row, activity, event, or newly written file, including the real route-bound temporary DB-trigger failure.

11. Refactor while green (bounded):
    - Re-run the complete integration file, server typecheck, and the existing card-create test coverage; all must stay PASS.
    - Keep the transaction's DB-row atomicity wording explicit; do not claim filesystem two-phase commit.

12. Commit:
    `git add server/src/routes/card-create.ts server/src/lib/attachment-storage.ts server/src/routes/card-create-attachments.integration.test.ts`
    `git commit -m "fix(attachments): rollback staged card-create files"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — all-or-nothing DB-row atomicity, file-write-before-transaction boundary, staged validation, and residual idempotency risk.
- `server/src/routes/card-create.ts` — current prepare/persist/hydrate transaction flow.
- `server/src/routes/cards.ts` — create route registration and workspace guard.
- `server/src/lib/attachment-upload.ts`, `server/src/lib/file-validator.ts`, `server/src/lib/attachment-storage.ts` — shared multipart/validation/storage boundaries.
- `server/src/routes/attachment-response.ts` — hydrated response shape.

## WHY THIS APPROACH

Complexity: deep
Justification: Card creation crosses multipart parsing, validation, filesystem writes, DB transactions, hydration, and realtime. Integration tests must observe the public create route and distinguish DB-row atomicity from filesystem cleanup; the existing JSON path remains a supported compatibility branch.

## SANDWICH CONTEXT

[CRITICAL: Card and attachment rows must commit together, and every file written for a failed request must be unlinked; do not promise filesystem/database two-phase commit.]
You are implementing staged-image card creation for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: one multipart request carries paired thumbnail/original bytes; the existing card transaction owns both row inserts.
Files in scope: `server/src/routes/card-create.ts`, `server/src/routes/cards.ts`, `server/src/lib/attachment-storage.ts`, `server/src/routes/card-create-attachments.integration.test.ts`.
Available after: T2 storage/upload, T3 validation, T4 response contract.
Architecture rule: keep `tracker_items` and card optimistic locking untouched; ordinary JSON card creation must still work.
[RESTATE: Card and attachment rows must commit together, and every file written for a failed request must be unlinked; do not promise filesystem/database two-phase commit.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a valid staged pair, When multipart card-create submits, Then card and attachment rows commit together and the returned card has a cover.
Given invalid staged bytes, a later pair's provider write failure, or a route-bound DB failure, When card-create submits, Then no card/attachment/activity/event commits and every file already written for the request is unlinked.
Given a network response is lost after a server commit, When the client retries, Then the documented duplicate-card residual risk remains explicit; no idempotency infrastructure is added.
Given a normal JSON create with no files, When it submits, Then existing card-create behavior remains green.

All tests PASS. Commits exist with messages matching `feat|fix(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Multipart parser accepts no more than three pairs and maps thumbnail/original by position.
- Server revalidates both payloads and performs DB inserts in the existing transaction.
- Newly written files are cleaned on validation, mid-batch provider, and DB failure; tests prove cleanup of earlier successful writes.
- Returned card hydration and normal create events remain valid.

Must-not-have:

- Two-step staging endpoint, idempotency-key infrastructure, tracker writes, or card-version changes.
- Claiming that filesystem writes participate in PostgreSQL rollback.

Open question risks:

- Lost-success-response retries can duplicate card/image; surface retryable errors without pretending to solve this v1 risk.

Rollback note:

- Keep JSON create path and hide staged-image entry point if multipart has a critical issue; schema remains additive.

## STOP CONDITIONS

Done when both integration cycles and existing create coverage pass, typecheck is green, and commits exist.
Uncertain when the multipart field contract cannot be parsed without changing the existing JSON API; report NEEDS_CONTEXT.
Escalate when atomicity requires an idempotency service, object storage, or tracker changes.

---

### Task 9: Add client attachment API, SSE refresh, and activity descriptions [depends: T4, T6, T7, T8] [test-risk]

## OBJECTIVE

Expose attachment upload/delete/create API methods, synchronize board state on attachment SSE events, extend create payload types, and render attachment activity as plain text in card and workspace activity surfaces.

Files:

- Modify: `client/src/api.ts`
- Modify: `client/src/context/BoardContext.tsx`
- Modify: `client/src/lib/taskCreateContracts.ts`
- Modify: `client/src/lib/cardPanel.ts`
- Modify: `client/src/pages/ActivityPage.tsx`
- Modify: `client/src/api.test.ts`
- Create: `client/src/context/BoardContext.attachments.test.tsx`
- Modify: `client/src/lib/cardPanel.test.ts`
- Create: `client/src/pages/ActivityPage.test.tsx`

Steps:

1. Write failing test for: API methods use workspace/card/attachment paths, multipart bodies, credentials, and do not set a manual multipart content type.
   Test file: `client/src/api.test.ts`
   Level: unit

   Test intent:
   Given prepared thumbnail/original files, When the client calls existing-card upload, delete, or multipart card-create, Then it uses the locked route paths, sends `FormData`, includes credentials/CSRF through the shared request boundary, and lets the browser set the multipart boundary header.

   Exercise through:
   - exported `api.uploadCardAttachments`, `api.deleteCardAttachment`, and extended `api.createCard` methods with mocked `fetch`.

   Test doubles:
   - mock global `fetch` and CSRF cookie reader as existing API tests do
   - do not mock the API methods under test or assert through private request helpers only.

   Expected RED:
   - no attachment API methods or create payload field exists, so imports and fetch path/body assertions fail.

2. Run test — verify FAIL:
   `npm run test -- client/src/api.test.ts`
   Expected failure: attachment API methods are undefined and FormData route assertions fail.

3. Implement minimal code to satisfy the test:
   Files: `client/src/api.ts`, `client/src/lib/taskCreateContracts.ts`
   Implement: typed attachment upload/delete methods, multipart card-create serialization when staged pairs exist while preserving JSON for no-file creates, URL helpers from `CardAttachment`, and `attachments` on `BoardCreatePayload`. Do not manually set `Content-Type` for FormData.

4. Run test — verify PASS:
   `npm run test -- client/src/api.test.ts`
   Expected: API path/FormData/credentials assertions PASS.

5. Refactor while green (bounded):
   - Reuse the existing `request()` error/CSRF behavior and keep URL construction aligned with T4.
   - Re-run API tests and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add client/src/api.ts client/src/lib/taskCreateContracts.ts client/src/api.test.ts`
   `git commit -m "feat(attachments): add client attachment API"`

7. Write failing test for: an attachment SSE event dispatches a card attachment event and refreshes board state, while unrelated tracker behavior is unchanged.
   Test file: `client/src/context/BoardContext.attachments.test.tsx`
   Level: integration (client context/event seam)

   Test intent:
   Given an active workspace and an open SSE stream, When `attachment.added` or `attachment.removed` arrives for a card, Then the BoardContext schedules/executes a board refresh and registered card-event listeners receive the attachment event so counters/gallery update without a manual reload.

   Exercise through:
   - rendered `BoardProvider` and its EventSource boundary, not a direct helper invocation.

   Test doubles:
   - fake EventSource and mocked `api.getBoard`/metrics/activity network calls
   - do not mock BoardProvider state transitions or the event dispatch registry under test.

   Expected RED:
   - current handler only dispatches `card.*` and `tracker.*`; attachment events fall through without an attachment-specific dispatch/refresh contract.

8. Run test — verify FAIL:
   `npm run test -- client/src/context/BoardContext.attachments.test.tsx`
   Expected failure: attachment event listener is not called or refreshed board state remains stale.

9. Implement minimal code to satisfy the test:
   File: `client/src/context/BoardContext.tsx`
   Implement: attachment event typing/dispatch and refresh scheduling for `attachment.added`/`attachment.removed`; expose narrowly scoped upload/delete helpers only if the panel needs them, while preserving existing card/tracker event routing.

10. Run test — verify PASS:
    `npm run test -- client/src/context/BoardContext.attachments.test.tsx`
    Expected: attachment SSE dispatch and refresh assertions PASS.

11. Refactor while green (bounded):
    - Do not add a second polling mechanism or modify tracker event paths.
    - Re-run the context test and client typecheck — both must stay PASS.

12. Commit:
    `git add client/src/context/BoardContext.tsx client/src/context/BoardContext.attachments.test.tsx`
    `git commit -m "feat(attachments): refresh board on attachment events"`

13. Write failing test for: attachment activity is rendered as plain text in card and workspace timelines.
    Test file: `client/src/lib/cardPanel.test.ts`, `client/src/pages/ActivityPage.test.tsx`
    Level: unit

    Test intent:
    Given `attachment_added` and `attachment_removed` activity events, When card/workspace description functions render them, Then they say a plain-text image-added/removed action, preserve card title/actor/timestamp context, and include no thumbnail/image markup or bytes.

    Exercise through:
    - exported `describeCardEvent` and `describeEvent` functions.

    Test doubles:
    - plain `ActivityEvent` fixtures
    - do not mock the description functions.

    Expected RED:
    - current switch statements fall through to generic `changed` text and the activity type maps do not accept attachment event literals.

14. Run test — verify FAIL:
    `npm run test -- client/src/lib/cardPanel.test.ts client/src/pages/ActivityPage.test.tsx`
    Expected failure: attachment descriptions return generic text or the new page test cannot compile the event type.

15. Implement minimal code to satisfy the test:
    Files: `client/src/lib/cardPanel.ts`, `client/src/pages/ActivityPage.tsx`
    Implement: explicit plain-text descriptions and activity badge metadata for added/removed images; keep `ContextPanel` activity feed and workspace Activity page free of inline thumbnails.

16. Run test — verify PASS:
    `npm run test -- client/src/lib/cardPanel.test.ts client/src/pages/ActivityPage.test.tsx`
    Expected: both activity-description suites PASS.

17. Refactor while green (bounded):
    - Keep copy neutral-friendly and use existing design tokens; do not add image previews to activity.
    - Re-run API, context, card-panel, activity tests and client typecheck — all must stay PASS.

18. Commit:
    `git add client/src/lib/cardPanel.ts client/src/pages/ActivityPage.tsx client/src/lib/cardPanel.test.ts client/src/pages/ActivityPage.test.tsx`
    `git commit -m "feat(attachments): describe attachment activity"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — client API route shape, SSE synchronization, plain-text activity, create payload, and no thumbnail activity feed.
- `client/src/api.ts` — shared request/CSRF/error behavior.
- `client/src/context/BoardContext.tsx` — existing SSE/refresh/registry flow.
- `client/src/lib/cardPanel.ts` and `client/src/pages/ActivityPage.tsx` — current activity description surfaces.
- `client/src/api.test.ts` and existing BoardContext tests — test doubles and Vitest/Testing Library conventions.

## WHY THIS APPROACH

Complexity: deep
Justification: This task is the client/server contract consumer: it crosses fetch/FormData, SSE/EventSource, board refresh state, and two activity renderers. Separate cycles keep network serialization, event synchronization, and copy behavior independently verifiable.

## SANDWICH CONTEXT

[CRITICAL: Attachment API calls must use authenticated workspace/card routes and attachment SSE must refresh existing board state without introducing tracker/unified mutation paths.]
You are implementing client contracts and synchronization for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: API URLs carry workspace/card/attachment ownership context; SSE remains the existing board refresh mechanism.
Files in scope: `client/src/api.ts`, `client/src/context/BoardContext.tsx`, `client/src/lib/taskCreateContracts.ts`, `client/src/lib/cardPanel.ts`, `client/src/pages/ActivityPage.tsx`, and their listed tests.
Available after: T4 response/event types, T6 existing upload, T7 delete, T8 card-create.
Architecture rule: do not call `api.updateTrackerItem`, `api.updateCard`, or any tracker mutation for attachments.
[RESTATE: Attachment API calls must use authenticated workspace/card routes and attachment SSE must refresh existing board state without introducing tracker/unified mutation paths.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a prepared image pair, When client upload/delete/create methods run, Then they use the locked paths and correct multipart/CSRF boundary.
Given an attachment SSE event, When BoardProvider receives it, Then card listeners and board refresh update the attachment count/gallery.
Given attachment activity events, When card/workspace timelines render, Then they show plain text added/removed descriptions with no inline thumbnail.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- FormData requests omit a manually set `Content-Type` header.
- SSE event handling is additive and coexists with existing card/tracker/membership routing.
- Activity text is explicit, accessible, and metadata-only.

Must-not-have:

- Direct tracker mutation calls, public upload URLs, second polling loops, or image bytes in activity state.

Open question risks:

- If `<img src>` does not carry session cookies in dev/prod, report NEEDS_CONTEXT and switch only the gallery transport to credentialed blobs.

Rollback note:

- Hide attachment UI and stop handling attachment events; existing board refresh/activity behavior remains.

## STOP CONDITIONS

Done when API, context, and activity cycles pass with client typecheck green.
Uncertain when EventSource test doubles cannot observe the current provider lifecycle; report NEEDS_CONTEXT rather than bypassing the provider.
Escalate when the implementation requires tracker mutation or public capability URLs.

---

### Task 10: Build existing-card picker, paste, gallery, lightbox, and delete UI [depends: T3, T9] [test-risk]

## OBJECTIVE

Extract a focused card-attachment UI from the oversized context panel that supports picker multi-select, clipboard paste, total counter/overflow messaging, thumbnails, lightbox/original download, and confirmed delete.

Files:

- Create: `client/src/components/CardAttachments.tsx`
- Create: `client/src/components/CardAttachments.test.tsx`
- Create: `client/src/components/CardAttachments.integration.test.tsx`
- Modify: `client/src/components/ContextPanel.tsx`
- Modify: `client/src/components/ContextPanel.test.tsx`

Steps:

1. Write failing test for: existing-card picker/paste uses the shared preparation helper, shows total `N/3`, reports partial batch acceptance, and leaves the panel in sync after SSE refresh.
   Test file: `client/src/components/CardAttachments.test.tsx`
   Level: unit/component

   Test intent:
   Given a card with one existing attachment, When the member selects four valid images or pastes a clipboard image while the panel is focused, Then the component calls the upload boundary with prepared pairs, shows `2 of 4 images added — card limit is 3 images` for partial acceptance, and displays the server-synchronized total as `3/3`.

   Exercise through:
   - rendered `CardAttachments` public props/callbacks and native file input/clipboard event boundary.

   Test doubles:
   - mock upload callback, preparation helper, and clipboard/file picker events
   - do not mock the component state or counter logic under test.

   Expected RED:
   - no extracted component or attachment controls exist in `ContextPanel`.

2. Run test — verify FAIL:
   `npm run test -- client/src/components/CardAttachments.test.tsx`
   Expected failure: component import fails because card attachment UI is not present.

3. Implement minimal code to satisfy the test:
   Files: `client/src/components/CardAttachments.tsx`, `client/src/components/ContextPanel.tsx`
   Implement: extracted attachment section with hidden multiple file input, focused-panel paste listener, T3 preparation, upload callback, exact batch result copy, persistent total counter from `card.attachments.length`, and a compact error state. Mount it in `CardEditor` without copying the existing 300+ line form logic.

4. Run test — verify PASS:
   `npm run test -- client/src/components/CardAttachments.test.tsx`
   Expected: picker/paste/partial-result/counter assertions PASS.

5. Refactor while green (bounded):
   - Keep attachment UI in the new component; `ContextPanel.tsx` should only compose it and pass card/workspace/callback props.
   - Use OKLCH/Work Sans-derived existing Tailwind tokens and accessible focus rings from the creative brief.
   - Re-run component test and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add client/src/components/CardAttachments.tsx client/src/components/ContextPanel.tsx client/src/components/CardAttachments.test.tsx`
   `git commit -m "feat(attachments): add card attachment picker"`

7. Write failing test for: gallery/lightbox/download and confirmed delete behavior.
   Test file: `client/src/components/CardAttachments.test.tsx`, `client/src/components/ContextPanel.test.tsx`
   Level: unit/component

   Test intent:
   Given a card with two attachments, When a thumbnail is clicked, Then a lightbox shows the full original and an explicit `/original/download` action; when delete is clicked and confirmed, Then delete callback runs; when cancelled, Then nothing changes; when the last attachment is removed from props, Then gallery/control shows no-media state.

   Exercise through:
   - rendered gallery buttons, lightbox dialog, download link, and confirmation dialog.

   Test doubles:
   - mock delete callback and card props; use accessible dialog/button queries
   - do not mock lightbox state or confirmation handling.

   Expected RED:
   - current context panel has no gallery/lightbox/delete UI or attachment composition seam.

8. Run test — verify FAIL:
   `npm run test -- client/src/components/CardAttachments.test.tsx client/src/components/ContextPanel.test.tsx`
   Expected failure: thumbnail/lightbox/delete/no-media assertions fail because the UI is absent.

9. Implement minimal code to satisfy the test:
   File: `client/src/components/CardAttachments.tsx`
   Implement: ordered thumbnail gallery, overflow-independent full-size lightbox with explicit download route, accessible confirmation dialog, cancel no-op, optimistic/loading/error states, and empty/no-media rendering when `card.attachments` becomes empty.

10. Run test — verify PASS:
    `npm run test -- client/src/components/CardAttachments.test.tsx client/src/components/ContextPanel.test.tsx`
    Expected: gallery/lightbox/download/delete/cancel/no-media assertions PASS.

11. Refactor while green (bounded):
    - Verify keyboard focus/escape behavior and `prefers-reduced-motion` classes follow existing component conventions.
    - Re-run both component suites and client typecheck — must stay PASS.

12. Commit:
    `git add client/src/components/CardAttachments.tsx client/src/components/ContextPanel.tsx client/src/components/CardAttachments.test.tsx client/src/components/ContextPanel.test.tsx`
    `git commit -m "feat(attachments): add attachment gallery and lightbox"`

13. Write failing test for: an attachment SSE payload reaches the mounted BoardProvider and CardAttachments surface so a second viewer's counter/gallery updates.
    Test file: `client/src/components/CardAttachments.integration.test.tsx`
    Level: integration (EventSource → BoardProvider → UI seam)

    Test intent:
    Given a mounted `BoardProvider` and `CardAttachments` consumer initialized with one image, When the exact `attachment.added` payload emitted by T6 is delivered through the EventSource adapter and the refresh response contains three images, Then the UI updates to `3/3` and renders the refreshed cover/badge without manually calling the component callback.

    Exercise through:
    - the provider's EventSource boundary, board refresh response, and rendered `CardAttachments` component.

    Test doubles:
    - fake EventSource and HTTP response at external browser boundaries
    - do not mock BoardProvider state transitions, CardAttachments rendering, or the attachment event dispatch.

    Expected RED:
    - current client flow has no attachment event-to-gallery integration, so the rendered counter remains stale after the event.

14. Run test — verify FAIL:
    `npm run test -- client/src/components/CardAttachments.integration.test.tsx`
    Expected failure: the mounted UI does not update from the attachment SSE payload.

15. Implement minimal code to satisfy the test:
    Files: `client/src/components/CardAttachments.tsx`, `client/src/components/CardAttachments.integration.test.tsx`
    Implement: only the component/test wiring needed for the T9 attachment event payload to refresh and render the new card state; preserve the external EventSource double as the network boundary.

16. Run test — verify PASS:
    `npm run test -- client/src/components/CardAttachments.integration.test.tsx`
    Expected: attachment SSE payload updates the mounted counter/gallery.

17. Refactor while green (bounded):
    - Re-run both CardAttachments suites, ContextPanel tests, and `npm run typecheck` — all must stay PASS.

18. Commit:
    `git add client/src/components/CardAttachments.tsx client/src/components/CardAttachments.integration.test.tsx`
    `git commit -m "test(attachments): verify gallery refresh from SSE"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — picker/paste scope, counter semantics, gallery/lightbox/download/delete behavior, and no drag-and-drop.
- `client/src/components/ContextPanel.tsx` — existing `CardEditor` composition and 300+ line extraction pressure.
- `client/src/types.ts` and `client/src/lib/imageAttachments.ts` — card attachment and preparation contracts.
- `client/src/context/BoardContext.tsx` and `client/src/api.ts` — upload/delete callbacks and SSE refresh.
- `docs/pocket/rule/creative-brief.md` — OKLCH tokens, Work Sans, accessible focus, calm copy.

## WHY THIS APPROACH

Complexity: deep
Justification: The panel is already over 300 lines and owns unrelated card-edit state. A domain component keeps picker/paste/gallery/lightbox state together and makes the component-level test boundary explicit.

## SANDWICH CONTEXT

[CRITICAL: Existing-card overflow is partial acceptance, but the persistent counter always reflects total server state; deleting the last image must return to no-media state.]
You are implementing the existing-card attachment surface for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: button/native picker and clipboard paste feed one prepared upload path; gallery uses authenticated response URLs.
Files in scope: `client/src/components/CardAttachments.tsx`, `client/src/components/CardAttachments.test.tsx`, `client/src/components/CardAttachments.integration.test.tsx`, `client/src/components/ContextPanel.tsx`, `client/src/components/ContextPanel.test.tsx`.
Available after: T3 client preparation and T9 API/context synchronization.
Architecture rule: no drag-and-drop, no tracker surface, no direct card-update mutation, and use existing design tokens.
[RESTATE: Existing-card overflow is partial acceptance, but the persistent counter always reflects total server state; deleting the last image must return to no-media state.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given one existing image and four selected images, When upload returns two accepted, Then the component says `2 of 4 images added — card limit is 3 images` and displays total `3/3`.
Given a clipboard image with no filename, When paste occurs while the panel is focused, Then it enters the same preparation/upload path.
Given two attachments, When a thumbnail is clicked, Then a lightbox shows the original and a distinct download action.
Given a delete confirmation, When cancelled, Then no delete callback runs; when confirmed, Then it runs and the last-image state becomes plain no-media after refresh.

All tests PASS. Commit messages match `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Native picker allows multiple files; clipboard paste accepts image blobs.
- Counter and overflow copy distinguish total card state from batch result.
- Gallery/lightbox/download/delete are keyboard-accessible and have explicit labels.
- UI uses existing tokens and no inline activity thumbnails.

Must-not-have:

- Drag-and-drop, manual cover selection/reordering, image annotation, or direct tracker/card mutation calls.

Open question risks:

- If `<img>` requests omit session cookies, report NEEDS_CONTEXT and use credentialed blob URLs as a focused transport adjustment.

Rollback note:

- Remove the `CardAttachments` composition from `ContextPanel` and hide the upload control; existing card editing remains.

## STOP CONDITIONS

Done when both component cycles and typecheck are green.
Uncertain when browser image delivery cannot authenticate; report NEEDS_CONTEXT before weakening route auth.
Escalate when UI scope expands to drag-and-drop or image editing.

---

### Task 11: Add the `@image` file-command variant [depends: T3] [test-risk]

## OBJECTIVE

Extend the existing command palette with a distinct file-trigger definition for `@image` that opens a native multi-file picker and reports selected files to its owner without pretending files are metadata options.

Files:

- Modify: `client/src/components/task-entry/TaskTitleEditor.tsx`
- Modify: `client/src/components/task-entry/TaskTitleEditor.test.tsx`

Steps:

1. Write failing test for: selecting the `@image` command invokes a file-command callback instead of dispatching a metadata action.
   Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   Level: unit/component

   Test intent:
   Given a `TaskTitleEditor` with a file command definition, When the user types `@image`, chooses the command, and selects files in the native input, Then the callback receives the file list, the input exposes `multiple` plus `accept="image/png,image/jpeg"`, the title remains the plain task title, no metadata reducer action is dispatched, and the existing field-command options remain unchanged.

   Exercise through:
   - rendered combobox/popover and hidden file input event boundary.

   Test doubles:
   - synthetic `File` objects, metadata dispatch spy, and native input change event
   - do not mock TaskTitleEditor command state or the file-command callback under test.

   Expected RED:
   - current `TaskTitleEditor` accepts only `TaskFieldCommandDefinition` options-list commands and has no file-trigger variant/input.

2. Run test — verify FAIL:
   `npm run test -- client/src/components/task-entry/TaskTitleEditor.test.tsx`
   Expected failure: file-command fixture cannot compile/render or selection dispatches no callback.

3. Implement minimal code to satisfy the test:
   File: `client/src/components/task-entry/TaskTitleEditor.tsx`
   Implement: exported `TaskFileCommandDefinition` discriminated from `TaskFieldCommandDefinition`, optional file-command input props, field-stage rendering for `@image`, native `accept="image/png,image/jpeg"`/multiple input, callback invocation, title cleanup, and command-state reset. Preserve existing metadata command behavior and keyboard/pointer semantics.

4. Run test — verify PASS:
   `npm run test -- client/src/components/task-entry/TaskTitleEditor.test.tsx`
   Expected: file trigger invokes callback without metadata mutation; existing command tests remain PASS.

5. Refactor while green (bounded):
   - Keep the file command additive; do not rewrite `TaskFieldCommandPopover` into a generic upload manager.
   - Re-run the focused suite and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add client/src/components/task-entry/TaskTitleEditor.tsx client/src/components/task-entry/TaskTitleEditor.test.tsx`
   `git commit -m "feat(attachments): add image file command"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — additive `@image` command requirement and hard stage cap owned by create-card UI.
- `client/src/components/task-entry/TaskTitleEditor.tsx` — existing two-stage metadata command state and imperative submit handle.
- `client/src/components/task-entry/TaskFieldCommandPopover.tsx` — existing keyboard/pointer field-stage rendering.
- `client/src/components/task-entry/TaskTitleEditor.test.tsx` — command palette interaction tests.

## WHY THIS APPROACH

Complexity: standard
Justification: The file trigger is a distinct interaction from catalog-backed metadata selection. A single RED cycle proves the public command boundary while preserving existing field commands and keeping staging policy in AddCard.

## SANDWICH CONTEXT

[CRITICAL: `@image` must be additive and must not dispatch tracker/metadata actions or replace existing field-command behavior.]
You are implementing the `@image` file-command variant for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: native file picker triggers a callback; AddCard owns staged files and submission.
Files in scope: `client/src/components/task-entry/TaskTitleEditor.tsx`, `client/src/components/task-entry/TaskTitleEditor.test.tsx`.
Available after: T3 client image preparation.
Architecture rule: use client-side image validation/preparation and preserve no-extension client imports.
[RESTATE: `@image` must be additive and must not dispatch tracker/metadata actions or replace existing field-command behavior.]

## DELIVERABLE

Verification — task is DONE when:

Given a create-card editor with `@image`, When a user chooses it and selects PNG/JPEG files, Then owner callback receives the files and the plain title remains clean.
Given existing metadata commands, When they are used, Then their reducer actions/chips/keyboard interactions remain unchanged.

All tests PASS. Commit exists with message matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Distinct file-command type/branch is visible in the public editor props.
- Native file input supports multi-select and accepted PNG/JPEG MIME.
- Existing command tests stay green.

Must-not-have:

- File bytes in metadata draft, tracker mutation, drag-and-drop, or a generic command-palette rewrite.

Open question risks:

- Browser picker cancellation must leave command/title state unchanged; if the browser does not emit a reliable empty selection, report DONE_WITH_CONCERNS with evidence.

Rollback note:

- Remove only the `@image` command definition/prop; metadata commands remain.

## STOP CONDITIONS

Done when focused command tests and client typecheck pass.
Uncertain when the existing popover cannot represent a file row without changing field semantics; report NEEDS_CONTEXT.
Escalate when implementing the file command requires changing tracker metadata contracts.

---

### Task 12: Stage images and submit create-card requests from AddCard [depends: T9, T11, T8] [test-risk]

## OBJECTIVE

Wire staged `@image` files into AddCard with a hard three-file cap, previews/errors, loading replacement, multipart submission, and retryable validation/network behavior that keeps the form editable.

Files:

- Modify: `client/src/components/AddCard.tsx`
- Modify: `client/src/components/AddCard.test.tsx`

Steps:

1. Write failing test for: AddCard stages at most three images and refuses the fourth immediately.
   Test file: `client/src/components/AddCard.test.tsx`
   Level: unit/component

   Test intent:
   Given an open new-card form, When the user selects three valid image files through `@image` and then selects a fourth, Then three staged chips remain, the fourth is not submitted/staged, and the UI says `Max 3 images per card`; no server request occurs for the fourth selection.

   Exercise through:
   - rendered AddCard and TaskTitleEditor file-command boundary.

   Test doubles:
   - synthetic `File` objects, preparation helper result, and `onAddCard` spy
   - do not mock AddCard staging state or cap logic.

   Expected RED:
   - AddCard currently has no staged-image state or file-command integration, so the fourth-selection behavior does not exist.

2. Run test — verify FAIL:
   `npm run test -- client/src/components/AddCard.test.tsx`
   Expected failure: staged chips/cap message are absent and file selection is ignored.

3. Implement minimal code to satisfy the test:
   File: `client/src/components/AddCard.tsx`
   Implement: local staged image state using T3 prepared pairs, `TaskTitleEditor` file command wiring from T11, hard cap at three, per-chip validation/error display, remove/retry controls, and `BoardCreatePayload.attachments` preparation.

4. Run test — verify PASS:
   `npm run test -- client/src/components/AddCard.test.tsx`
   Expected: three-file staging and immediate fourth refusal PASS.

5. Refactor while green (bounded):
   - Keep metadata draft reducer unchanged; staged files are not tracker metadata.
   - Re-run AddCard tests and client typecheck — both must stay PASS.

6. Commit:
   `git add client/src/components/AddCard.tsx client/src/components/AddCard.test.tsx`
   `git commit -m "feat(attachments): stage images in card creation"`

7. Write failing test for: invalid staged image remains visible as an error chip and blocks card creation without losing the editable title.
   Test file: `client/src/components/AddCard.test.tsx`
   Level: unit/component

   Test intent:
   Given a 15MB image selected through `@image`, When T3 preparation returns a tagged invalid result and the user submits, Then the invalid file remains represented by its chip/error, `onAddCard` is not called, the title/draft stays editable, and the UI surfaces the specified validation message.

   Exercise through:
   - AddCard's file-command callback, submit handler, staged-chip rendering, and public `onAddCard` boundary.

   Test doubles:
   - synthetic invalid `File`, deterministic T3 invalid-result fixture, and `onAddCard` spy
   - do not mock AddCard staged state or submission guard.

   Expected RED:
   - current AddCard discards no-file/invalid preparation results and has no invalid staged-chip state or submit guard.

8. Run test — verify FAIL:
   `npm run test -- client/src/components/AddCard.test.tsx`
   Expected failure: invalid chip/title retention and no-request assertions fail.

9. Implement minimal code to satisfy the test:
   File: `client/src/components/AddCard.tsx`
   Implement: preserve T3 tagged invalid results in staged state, render the error chip, prevent `onAddCard` while any invalid entry exists, and keep title/metadata editable for removal or retry.

10. Run test — verify PASS:
    `npm run test -- client/src/components/AddCard.test.tsx`
    Expected: invalid staged image remains visible, submission is blocked, and title is retained.

11. Refactor while green (bounded):
    - Keep invalid staged files out of `BoardCreatePayload.attachments`; only valid prepared pairs may serialize.
    - Re-run the focused AddCard suite and `npm run typecheck` — both must stay PASS.

12. Commit:
    `git add client/src/components/AddCard.tsx client/src/components/AddCard.test.tsx`
    `git commit -m "fix(attachments): preserve staged image validation errors"`

13. Write failing test for: a valid staged image shows a loading state and resets only after successful atomic create.
    Test file: `client/src/components/AddCard.test.tsx`
    Level: unit/component

    Test intent:
    Given a title and one valid staged pair, When `Add to board` is submitted, Then the form controls are replaced/disabled while the multipart callback is pending; when it resolves successfully, staged state resets and the form closes.

    Exercise through:
    - AddCard's public `onAddCard` callback and rendered loading/success boundary.

    Test doubles:
    - deferred successful `onAddCard` promise
    - do not mock submitting state or success cleanup.

    Expected RED:
    - current AddCard has no staged image submission/loading lifecycle.

14. Run test — verify FAIL:
    `npm run test -- client/src/components/AddCard.test.tsx`
    Expected failure: loading replacement and success reset/close assertions fail.

15. Implement minimal code to satisfy the test:
    File: `client/src/components/AddCard.tsx`
    Implement: pending state around multipart create, loading indicator replacing the form, and clearing staged state/closing only after successful `onAddCard`.

16. Run test — verify PASS:
    `npm run test -- client/src/components/AddCard.test.tsx`
    Expected: valid submit loading and success reset assertions PASS.

17. Refactor while green (bounded):
    - Re-run the focused AddCard suite, `npm run typecheck`, and the existing `TaskTitleEditor` suite — all must stay PASS.
    - Keep copy neutral-friendly and use existing primary/secondary/error tokens.

18. Commit:
    `git add client/src/components/AddCard.tsx client/src/components/AddCard.test.tsx`
    `git commit -m "feat(attachments): submit staged images atomically"`

19. Write failing test for: network failure preserves staged valid files and offers a retry without silently clearing the title.
    Test file: `client/src/components/AddCard.test.tsx`
    Level: unit/component

    Test intent:
    Given a valid staged image and a rejected `onAddCard` promise, When submission fails, Then the form returns to editable state, the chip shows a retryable error, the title remains, and a retry invokes the callback again.

    Exercise through:
    - AddCard submit/error/retry controls and public callback.

    Test doubles:
    - rejected then resolved deferred callback
    - do not mock error mapping or retry state.

    Expected RED:
    - current AddCard has no staged network-error recovery or retry path.

20. Run test — verify FAIL:
    `npm run test -- client/src/components/AddCard.test.tsx`
    Expected failure: retry/error/title-retention assertions fail.

21. Implement minimal code to satisfy the test:
    File: `client/src/components/AddCard.tsx`
    Implement: map `ApiError`/network failures to staged chip errors, restore editable state, and allow retry without resetting title or metadata.

22. Run test — verify PASS:
    `npm run test -- client/src/components/AddCard.test.tsx`
    Expected: network retry and draft-retention assertions PASS.

23. Refactor while green (bounded):
    - Re-run the focused AddCard suite and client typecheck — must stay PASS.

24. Commit:
    `git add client/src/components/AddCard.tsx client/src/components/AddCard.test.tsx`
    `git commit -m "fix(attachments): make staged upload retryable"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — three-file stage cap, all-or-nothing create UX, loading state, invalid/network retry behavior.
- `client/src/components/AddCard.tsx` — existing draft/submission flow and field-error handling.
- `client/src/components/task-entry/TaskTitleEditor.tsx` — T11 file command callback.
- `client/src/lib/imageAttachments.ts` — T3 prepared pair/cap/validation helper.
- `client/src/api.ts` and `client/src/lib/taskCreateContracts.ts` — T9 multipart create contract.
- `client/src/components/AddCard.test.tsx` — existing form test harness.

## WHY THIS APPROACH

Complexity: deep
Justification: AddCard coordinates command selection, client preprocessing, staged state, multipart network behavior, loading, and retry. Separate RED cycles prove stage-time policy and submit-time state recovery without testing server internals in a component test.

## SANDWICH CONTEXT

[CRITICAL: Create-card staging must refuse a fourth file before submission and must never partially arbitrate overflow on the server.]
You are implementing staged image creation UX for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: `@image` stages client-side, then one multipart card-create request owns DB-row atomicity.
Files in scope: `client/src/components/AddCard.tsx`, `client/src/components/AddCard.test.tsx`.
Available after: T8 server multipart create, T9 client API contract, T11 file command.
Architecture rule: keep staged files separate from `taskMetadataDraft`; no direct tracker mutation and no second staging upload request.
[RESTATE: Create-card staging must refuse a fourth file before submission and must never partially arbitrate overflow on the server.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given three staged images, When a fourth is selected, Then it is refused immediately with `Max 3 images per card`.
Given a staged valid image, When Add to board submits, Then loading replaces the form until the multipart request resolves and success clears/closes the form.
Given invalid staged data or a network drop, When submit fails, Then no blank silent state occurs; chips/title remain editable and retry is possible.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Stage-time cap is hard and visible.
- Loading covers the full submit window and prevents duplicate submission.
- Error state preserves the draft and maps validation/network failures to actionable UI.
- Success resets staged state only after the server response succeeds.

Must-not-have:

- Partial server arbitration for create-card overflow, second staging endpoint, idempotency key, or tracker metadata mutation.

Open question risks:

- Lost response after server commit can duplicate a card on retry; document/surface this as the accepted v1 residual risk.

Rollback note:

- Hide `@image` while retaining normal AddCard title/metadata creation.

## STOP CONDITIONS

Done when all four component cycles, AddCard/TaskTitleEditor suites, and client typecheck pass.
Uncertain when `ApiError` cannot preserve field/chip errors for multipart responses; report NEEDS_CONTEXT.
Escalate when create-card requires changing tracker metadata or adding idempotency infrastructure.

---

### Task 13: Render board cover thumbnails and overflow badge [depends: T4, T9] [test-risk]

## OBJECTIVE

Render the server-ordered oldest attachment as a board-card cover with a `+N` badge and restore the existing plain card layout when no attachments remain.

Files:

- Modify: `client/src/components/CardView.tsx`
- Modify: `client/src/components/CardView.test.tsx`
- Create: `client/src/components/CardView.integration.test.tsx`

Steps:

1. Write failing test for: a card with ordered attachments renders the first thumbnail and correct overflow badge, while an empty list renders no media slot.
   Test file: `client/src/components/CardView.test.tsx`
   Level: unit/component

   Test intent:
   Given a card with attachments A/B/C already ordered by server response, When `CardBody` renders, Then it shows A's thumbnail and a `+2` badge; given an empty attachment list or after the last image is deleted, Then it renders the existing plain no-media card content without a broken image or stale badge.

   Exercise through:
   - exported `CardBody` component and accessible image/badge output.

   Test doubles:
   - plain Card fixtures with attachment URL strings
   - do not mock cover selection or React rendering under test.

   Expected RED:
   - current `CardBody` never reads `card.attachments`, so no cover/badge/no-media behavior exists.

2. Run test — verify FAIL:
   `npm run test -- client/src/components/CardView.test.tsx`
   Expected failure: cover image and `+2` badge are absent; empty-state assertions cannot find the new behavior.

3. Implement minimal code to satisfy the test:
   File: `client/src/components/CardView.tsx`
   Implement: compact thumbnail cover using `card.attachments[0]`, accessible alt/title, `+${attachments.length - 1}` badge when greater than one, and conditional rendering that leaves the existing card text/metadata unchanged for zero attachments. Do not add click-to-lightbox behavior to the tile.

4. Run test — verify PASS:
   `npm run test -- client/src/components/CardView.test.tsx`
   Expected: cover, badge, and no-media assertions PASS.

5. Refactor while green (bounded):
   - Keep the tile surface calm and aligned with creative-brief tokens; use the existing `CardBody` layout rather than duplicating card rendering.
   - Re-run the focused test and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add client/src/components/CardView.tsx client/src/components/CardView.test.tsx`
   `git commit -m "feat(attachments): show card cover thumbnails"`

7. Write failing test for: the serialized board response shape consumed by the client actually feeds an ordered attachment into `CardBody`.
   Test file: `client/src/components/CardView.integration.test.tsx`
   Level: integration (client response-to-render seam)

   Test intent:
   Given a server-shaped board response containing card attachments A/B/C in response order, When the existing BoardProvider/board rendering harness loads it and `CardBody` renders, Then A's authenticated thumbnail URL is the visible cover and the `+2` badge is present; the test must not reconstruct a different client-only fixture shape.

   Exercise through:
   - BoardProvider's board response boundary and the public `CardBody` render, not a direct cover helper.

   Test doubles:
   - fake network response/EventSource at the external browser boundary
   - do not mock BoardProvider hydration or CardBody rendering.

   Expected RED:
   - current server-shaped cards have no attachment field and CardBody does not render the hydrated cover.

8. Run test — verify FAIL:
   `npm run test -- client/src/components/CardView.integration.test.tsx`
   Expected failure: the response-to-cover assertion cannot find the attachment thumbnail/badge.

9. Implement minimal code to satisfy the test:
   Files: `client/src/components/CardView.tsx`, `client/src/components/CardView.integration.test.tsx`
   Implement: consume the T4 `Card.attachments` response shape directly in CardBody and keep the integration harness on the existing board provider/render path.

10. Run test — verify PASS:
    `npm run test -- client/src/components/CardView.integration.test.tsx`
    Expected: server-shaped response data reaches CardBody as the ordered cover and badge.

11. Refactor while green (bounded):
    - Re-run both CardView test files and `npm run typecheck` — all must stay PASS.

12. Commit:
    `git add client/src/components/CardView.tsx client/src/components/CardView.integration.test.tsx`
    `git commit -m "test(attachments): verify hydrated board cover"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — oldest cover, id tiebreak, `+N` badge, and plain no-media state.
- `client/src/components/CardView.tsx` — existing tile/card-body layout.
- `client/src/types.ts` — T4 `Card.attachments` shape.
- `client/src/components/CardView.test.tsx` — existing component fixture/test convention.
- `docs/pocket/rule/creative-brief.md` — visual token and restraint guidance.

## WHY THIS APPROACH

Complexity: lightweight
Justification: The board tile only consumes the ordered response summary; cover selection belongs to server hydration, so this task is a focused render change with one component cycle.

## SANDWICH CONTEXT

[CRITICAL: The board tile must consume server ordering and must never introduce manual cover selection, upload mutation, or tracker lookup.]
You are implementing board-card attachment preview for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: oldest attachment summary is the cover; the tile does not open the gallery or mutate attachments.
Files in scope: `client/src/components/CardView.tsx`, `client/src/components/CardView.test.tsx`, `client/src/components/CardView.integration.test.tsx`.
Available after: T4 ordered card response and T9 client types/refresh.
Architecture rule: use existing CardBody composition and OKLCH/Work Sans tokens; no drag-and-drop or manual reorder.
[RESTATE: The board tile must consume server ordering and must never introduce manual cover selection, upload mutation, or tracker lookup.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given A/B/C ordered attachments, When the board tile renders, Then A is the cover and `+2` appears.
Given no attachments, When the tile renders, Then the plain existing layout remains with no broken media or stale badge.

All tests PASS. Commit exists with message matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Cover uses the first server-ordered attachment.
- Badge count is total minus one and disappears for zero/one.
- Empty state preserves current card readability and layout.

Must-not-have:

- Manual cover/reorder controls, gallery modal in the tile, tracker data, or public-path construction.

Open question risks:

- None beyond T4 cookie/auth transport verification; tile rendering must not bypass delivery auth.

Rollback note:

- Remove the conditional media slot; cards remain fully usable without previews.

## STOP CONDITIONS

Done when component test and client typecheck pass.
Uncertain when the response does not guarantee ordered attachments; report NEEDS_CONTEXT to T4 rather than sorting differently in the tile.
Escalate when tile scope expands into attachment mutation or drag-and-drop.

---

### Task 14: Wire self-host deployment, private volume, and upload body size [depends: T2, T5, T6, T8]

## OBJECTIVE

Make the private storage contract self-host friendly in the tracked container/deployment configuration and raise nginx request-body limits for realistic multi-select batches without modifying ignored operator-specific GGF files.

Files:

- Modify: `Dockerfile`
- Modify: `deploy/docker-compose.prod.yml`
- Modify: `deploy/.env.production.template`
- Modify: `deploy/nginx/camel.conf`

This is a structural/deployment task: `[no-tdd — structural task]`.

Steps:

1. Add the runner directory creation and configurable environment wiring:
   - create `/app/server/private-uploads` in `Dockerfile`
   - pass `ATTACHMENTS_DIR` with default `/app/server/private-uploads` in tracked production Compose
   - add the optional variable/documentation to `deploy/.env.production.template`
   - mount a distinct named `camel_private_uploads` volume at `/app/server/private-uploads`, separate from `camel_uploads`.
2. Raise `client_max_body_size` to approximately `35m` on both nginx API proxy surfaces that can receive attachment multipart requests: the `camel.web.id` `/api/` block and the `api.camel.web.id` proxy block. Do not alter static public uploads caching rules.
3. Verify the deployment configuration:
   `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.template config`
   Expected: valid Compose configuration with distinct `camel_uploads` and `camel_private_uploads` mounts and the private path passed to the server.
4. Verify the private/public boundaries and nginx limits:
   `rg -n "private-uploads|camel_private_uploads|client_max_body_size|client/public/uploads" Dockerfile deploy/docker-compose.prod.yml deploy/.env.production.template deploy/nginx/camel.conf`
   Expected: private mount/path is outside `client/public`, public upload volume remains separate, and both API proxy surfaces contain the body-size limit.
5. Run the relevant static checks:
   `npm run typecheck`
   Expected: PASS for both server and client; no application source behavior changes are introduced.
6. Commit:
   `git add Dockerfile deploy/docker-compose.prod.yml deploy/.env.production.template deploy/nginx/camel.conf`
   `git commit -m "chore(deploy): provision private attachment storage"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — self-host private volume, no public static serving, ~35MB nginx body size, and rollback.
- `server/src/config.ts` and `server/src/lib/attachment-storage.ts` — T2 configurable path/default.
- `Dockerfile` — current runner path and public upload directory creation.
- `deploy/docker-compose.prod.yml` — tracked production server volume contract.
- `deploy/.env.production.template` — self-host environment documentation.
- `deploy/nginx/camel.conf` — both production API proxy surfaces.

## WHY THIS APPROACH

Complexity: lightweight
Justification: This task changes only deployment artifacts and has no application behavior to unit-test. The verification commands validate Compose rendering, private/public separation, nginx coverage, and application typechecks.

## SANDWICH CONTEXT

[CRITICAL: The private attachment volume must be separate from `/app/client/public/uploads`; no private directory may be registered with `express.static`.]
You are wiring self-host deployment for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: configurable local-disk provider with a distinct named volume; production Compose is the tracked canonical contract.
Files in scope: `Dockerfile`, `deploy/docker-compose.prod.yml`, `deploy/.env.production.template`, `deploy/nginx/camel.conf`.
Available after: T2 path/provider, T5 delivery, T6 upload, T8 card-create.
Architecture rule: leave root `docker-compose.yml` unchanged because it has no server service, and leave ignored `deploy/docker-compose.ggf.yml` operator-specific.
[RESTATE: The private attachment volume must be separate from `/app/client/public/uploads`; no private directory may be registered with `express.static`.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a self-host runs tracked production Compose, When it renders the configuration, Then private attachment storage has a distinct named volume/path and remains outside public uploads.
Given a realistic multi-select request, When nginx receives it, Then both API proxy surfaces allow approximately 35MB rather than the 1MB default.
Given GGF operators use the ignored operator-specific Compose file, Then the plan documents the required private mount without untracking or committing that file.

All verification commands PASS. Commit exists with message matching `chore(deploy): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Distinct private named volume and configurable path are visible to self-hosters.
- Both relevant nginx API proxy surfaces have the body-size limit.
- Public logo upload volume and static serving remain unchanged.

Must-not-have:

- Tracking/committing `deploy/docker-compose.ggf.yml`, mounting private files under `client/public`, or exposing a private static route.

Open question risks:

- Operators using the ignored GGF Compose file must manually mirror the canonical production mount; if the deployment process requires a tracked GGF artifact, report NEEDS_CONTEXT rather than unignoring it implicitly.

Rollback note:

- Revert nginx body-size change independently if needed; hide attachment UI/routes and leave additive volume/schema in place.

## STOP CONDITIONS

Done when Compose config, boundary grep, and typechecks pass and the deployment commit exists.
Uncertain when Docker Compose cannot render with the repository's documented env template; report the exact missing variable/error.
Escalate when self-host support requires committing ignored operator credentials/config or serving private files publicly.

---

### Task 15: Verify cross-boundary attachment mutation, SSE, and create flow [depends: T6, T8, T9, T10, T12, T13] [test-risk]

## OBJECTIVE

Add focused system-level integration coverage proving that a real attachment mutation persists, broadcasts to another viewer, refreshes the client gallery, and that staged client card creation uses the actual multipart endpoint/atomic result rather than only independently mocked seams.

Files:

- Create: `server/src/routes/attachments-system.integration.test.ts`
- Create: `client/src/attachments-system.integration.test.tsx`
- Modify: `client/src/api.ts` (only if the in-process public-boundary harness requires a narrow adapter seam)

Steps:

1. Write failing test for: a real existing-card mutation reaches a second viewer through the realtime delivery boundary with persisted response state.
   Test file: `server/src/routes/attachments-system.integration.test.ts`
   Level: integration

   Test intent:
   Given two authenticated viewers, a card with one attachment, and an in-process realtime/SSE subscriber, When viewer A uploads a valid image through the public route, Then the real DB/storage transaction commits, the response contains the new ordered attachment, and viewer B's SSE stream receives `attachment.added` with matching workspace/card metadata after commit.

   Exercise through:
   - public HTTP upload route, real database/storage fixture, real in-process realtime hub/SSE handler, and a second subscriber connection.

   Test doubles:
   - fake Redis transport and temporary filesystem only at external boundaries
   - do not mock the upload route, DB transaction, `publishEvent`, realtime hub, or SSE handler.

   Expected RED:
   - existing route and unit/route tests prove persistence and publisher calls separately, but no system test observes the same committed mutation on a real subscriber stream.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/attachments-system.integration.test.ts`
   Expected failure: the system harness is absent and no end-to-end mutation-to-SSE assertion exists.

3. Implement minimal code to satisfy the test:
   File: `server/src/routes/attachments-system.integration.test.ts`
   Implement: an isolated authenticated fixture and in-process realtime subscriber harness that uses the production route/hub boundaries; keep Redis/filesystem as explicit external doubles only.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/attachments-system.integration.test.ts`
   Expected: one committed mutation is observed as one matching SSE event and response state.

5. Refactor while green (bounded):
   - Keep the harness isolated and do not weaken route authorization or replace production event code with a spy.
   - Re-run the system test and server typecheck — both must stay PASS.

6. Commit:
   `git add server/src/routes/attachments-system.integration.test.ts`
   `git commit -m "test(attachments): verify mutation reaches SSE"`

7. Write failing test for: the actual client API/BoardProvider/CardAttachments boundary consumes the server-shaped response and event from the system contract.
   Test file: `client/src/attachments-system.integration.test.tsx`
   Level: integration

   Test intent:
   Given a mounted `BoardProvider` and `CardAttachments` consumer initialized from the server's serialized card response, When the exact `attachment.added` payload is delivered through the EventSource adapter and the refresh response contains the committed attachment, Then the other viewer's UI changes from `1/3` to `2/3` and renders the new thumbnail without directly invoking an upload callback.

   Exercise through:
   - public client API response shape, BoardProvider EventSource boundary, and rendered attachment UI.

   Test doubles:
   - in-process HTTP/EventSource adapter at the browser network boundary using the server-system fixture payloads
   - do not mock BoardProvider, CardAttachments, response hydration, or the event dispatch.

   Expected RED:
   - independently passing API/context/component tests do not yet prove the serialized event/response reaches the mounted viewer surface.

8. Run test — verify FAIL:
   `npm run test -- client/src/attachments-system.integration.test.tsx`
   Expected failure: the mounted consumer remains at its initial count or cannot consume the server-shaped attachment contract.

9. Implement minimal code to satisfy the test:
   File: `client/src/attachments-system.integration.test.tsx`
   Implement: the client-side in-process network/EventSource adapter and mounted provider/UI harness; use the public API/type contracts, not private state setters.

10. Run test — verify PASS:
    `npm run test -- client/src/attachments-system.integration.test.tsx`
    Expected: the serialized attachment event/response updates the viewer UI.

11. Refactor while green (bounded):
    - Re-run the client system test, CardAttachments integration test, and `npm run typecheck` — all must stay PASS.

12. Commit:
    `git add client/src/attachments-system.integration.test.tsx`
    `git commit -m "test(attachments): verify viewer refresh contract"`

13. Write failing test for: staged client submission uses the actual multipart card-create route and yields the atomic card-plus-attachment response.
    Test file: `server/src/routes/attachments-system.integration.test.ts`
    Level: integration

    Test intent:
    Given an AddCard-equivalent staged title and valid thumbnail/original pair, When the public client FormData serializer submits to the in-process real card-create route, Then the endpoint returns the created card with its attachment summary and the isolated database contains both rows with no partial create path.

    Exercise through:
    - public client API/FormData serializer over real HTTP to the production card-create route and real DB transaction; do not call `persistCreatedCard()` directly.

    Test doubles:
    - authenticated test session, temporary filesystem, and isolated database only
    - do not mock the client serializer, HTTP request, card-create route, transaction, or attachment insert.

    Expected RED:
    - server card-create integration and client API serialization currently pass independently, but no test sends the staged client multipart contract to the actual endpoint and inspects the atomic result.

14. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/attachments-system.integration.test.ts`
    Expected failure: the system harness cannot yet bind the public client multipart request to the real card-create endpoint/result assertion.

15. Implement minimal code to satisfy the test:
    Files: `server/src/routes/attachments-system.integration.test.ts`, `client/src/api.ts`
    Implement: only the test harness/adapter needed to invoke the exported client create API against the in-process real server route; keep production serialization and server multipart fields unchanged except for a seam required to make the public boundary executable.

16. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/attachments-system.integration.test.ts`
    Expected: one staged client submission creates exactly one card and one attachment row and returns the hydrated summary.

17. Refactor while green (bounded):
    - Re-run the full system test, card-create integration test, client API tests, and both typechecks — all must stay PASS.
    - Do not add a browser/E2E dependency when the existing in-process boundaries can prove the contract.

18. Commit:
    `git add server/src/routes/attachments-system.integration.test.ts client/src/api.ts`
    `git commit -m "test(attachments): verify staged create contract"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — cross-unit upload/SSE/viewer/create scenarios and atomicity boundary.
- `server/src/routes/card-attachments.ts`, `server/src/routes/card-create.ts`, and `server/src/realtime.ts` — production server boundaries under test.
- `client/src/api.ts`, `client/src/context/BoardContext.tsx`, and `client/src/components/CardAttachments.tsx` — client network/state/UI boundaries.
- T6/T8/T9/T10/T12/T13 packets — direct dependencies whose seams are composed here.

## WHY THIS APPROACH

Complexity: deep
Justification: These scenarios are independently useful as system acceptance checks and cannot be proven by isolated route, API, context, or component tests. The task uses existing in-process test infrastructure and explicit external-boundary doubles instead of adding a new E2E dependency.

## SANDWICH CONTEXT

[CRITICAL: The system harness must exercise public route/API/EventSource boundaries and must not replace the mutation, realtime hub, BoardProvider, or attachment UI with mocks.]
You are verifying cross-boundary Image Attachment behavior for Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: authenticated local-disk routes, multipart card-create atomicity, and existing SSE refresh are composed without a new transport.
Files in scope: `server/src/routes/attachments-system.integration.test.ts`, `client/src/attachments-system.integration.test.tsx`, and only the narrow `client/src/api.ts` seam if required by the harness.
Available after: T6 existing upload/SSE, T8 multipart create, T9 client API/context, T10 gallery, T12 AddCard, T13 board cover.
Architecture rule: no production tracker/unified mutation path, public file path, or new E2E dependency.
[RESTATE: The system harness must exercise public route/API/EventSource boundaries and must not replace the mutation, realtime hub, BoardProvider, or attachment UI with mocks.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given viewer A uploads, When the real mutation commits, Then viewer B receives the attachment SSE event and can refresh to the committed response.
Given the committed response/event, When the real BoardProvider/CardAttachments surface consumes them, Then the counter/gallery updates without a direct callback invocation.
Given staged client data, When the public client API submits multipart card-create, Then the real endpoint creates exactly one card/attachment pair atomically and returns the hydrated summary.

All tests PASS. Commits exist with messages matching `test(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- At least one test observes mutation → real realtime/SSE delivery and one observes event/response → mounted client UI.
- Staged client FormData is sent to the actual card-create route and its DB result is inspected.
- External Redis/filesystem/network boundaries are the only doubles; core units remain real.

Must-not-have:

- A test that only spies on `publishEvent`, directly sets BoardProvider state, directly invokes the gallery callback, or bypasses the public card-create route.
- New Playwright/Cypress/E2E dependency or changes to tracker systems.

Open question risks:

- If the existing test harness cannot host the actual server route for a client API call without importing production boot side effects, report NEEDS_CONTEXT and identify the narrow app-factory seam required; do not replace the route with a mock.

Rollback note:

- These are verification-only files; revert them independently without changing runtime behavior.

## STOP CONDITIONS

Done when all three system cycles pass with full typechecks and commits.
Uncertain when a public boundary cannot be hosted without mocking a core unit; report NEEDS_CONTEXT rather than weakening the acceptance test.
Escalate when verification requires a new E2E dependency or out-of-scope runtime architecture.

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
| ------ | ------ | --------- | ------------ | ------------------ |
| T1 | Attachment schema and Kysely contract | prereq | standard | DDL/FK/limits and generated type contract pass |
| T2 | Private storage and multipart foundation | prereq | standard | temp-dir pair write/cleanup and Multer limits pass |
| T3 | Server validation and client preprocessing | T2 | standard | byte dimensions, MIME/size, Canvas fallback pass |
| T4 | Response hydration and realtime contract | T1 | deep | ordered safe summaries and event/card types pass |
| T5 | Ownership guard and cached delivery | T2, T4 | deep | auth chain, ETag/304, inline/download integration pass |
| T6 | Existing-card upload and capacity guard | T3, T4, T5 | deep | valid, concurrent, batch, invalid-input integration pass |
| T7 | Delete and soft-delete cleanup | T2, T4, T5, T6 | deep | delete/cover/activity and soft-delete cleanup integration pass |
| T8 | Multipart card-create atomicity | T2, T3, T4 | deep | success and rollback integration pass |
| T9 | Client API/SSE/activity synchronization | T4, T6, T7, T8 | deep | FormData, EventSource, and plain activity tests pass |
| T10 | Existing-card attachment UI | T3, T9 | deep | picker/paste/gallery/lightbox/delete component tests pass |
| T11 | `@image` file-command variant | T3 | standard | native file trigger preserves metadata command behavior |
| T12 | AddCard staged submission | T9, T11, T8 | deep | hard cap, loading, error, retry, success component tests pass |
| T13 | Board cover and overflow badge | T4, T9 | lightweight | ordered cover/badge/no-media component tests pass |
| T14 | Self-host deployment wiring | T2, T5, T6, T8 | lightweight | Compose config, nginx boundary, and typechecks pass |
| T15 | Cross-boundary system verification | T6, T8, T9, T10, T12, T13 | deep | mutation/SSE/viewer/create system contracts pass |

---

## Planning Notes for Review

- Every acceptance rule has at least one owning task and explicit GWT verification.
- Cross-unit scenarios are intentionally tested at public boundaries: T5 delivery HTTP, T6 existing-card HTTP/DB/concurrency/realtime, T7 delete/card-delete HTTP/DB/filesystem, T8 multipart create HTTP/DB/filesystem, T9 EventSource/BoardProvider, T10/T12 component callbacks and state, and T15 system-level mutation/SSE/viewer/client-create composition.
- No test source code is included; packets specify test intent, boundary, doubles, expected RED reason, and exact commands only.
- TEST STRATEGY AUDIT: initial run on T1–T13 and T15 — 8 findings applied across T1, T3, T4, T6, T8, T10, T11, and T13; those changes were re-reviewed. Focused re-audit on T2/T6/T8 after the route-specific Multer profile edit found 8 additional issues; all were applied in place, and the changed plan passed the final Gate 4 confirmation review. The audits cover persistence, deterministic concurrency, filesystem rollback, bounded multipart/network, SSE, and browser Canvas seams.
- GATE 4: Approved — final confirmation review returned no issues or recommendations.
