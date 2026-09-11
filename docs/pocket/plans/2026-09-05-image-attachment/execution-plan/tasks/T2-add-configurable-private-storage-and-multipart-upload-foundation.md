# Task T2 — Add configurable private storage and multipart upload foundation

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

## Pocket Packet

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
   `npm run test --workspace=server -- src/lib/attachment-storage.test.ts`
   Expected failure: module/provider import fails because no private attachment storage exists.

3. Implement minimal code to satisfy the test:
   Files: `server/src/config.ts`, `server/src/lib/attachment-storage.ts`
   Implement: optional `ATTACHMENTS_DIR` configuration, a source-relative development default that resolves to `server/private-uploads` and a container default of `/app/server/private-uploads`, plus a `LocalAttachmentStorage` interface/implementation with `writePair`, `removePair`, and best-effort bulk cleanup. Generate safe opaque names and never use the original filename as a path.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/lib/attachment-storage.test.ts`
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
   Given multipart fields named `thumbnail` and `original`, When the factory is configured with `maxPairs: 3` for card-create, Then a fourth pair is rejected. Given the existing-card profile's documented ten-pair/twenty-file and finite parts ceilings, When four image pairs arrive, Then the parser accepts them for route-level partial capacity handling; when an eleventh pair, a twenty-first file, or one part beyond the documented parts ceiling arrives, Then the real parser rejects with the normalized limit error. Given either profile, When one file exceeds 10MB, Then parsing rejects before provider write. All accepted files remain memory buffers.

   Exercise through:
   - the exported upload-factory middleware, not a route-specific wrapper.

   Test doubles:
   - real synthetic multipart byte streams at, below, and one over each exported profile limit plus a provider-invocation spy
   - do not mock Multer's parser behavior or the upload factory itself.

   Expected RED:
   - `attachment-upload.ts` is absent, so no configurable parser profiles or bounded Multer limits exist.

8. Run test — verify FAIL:
   `npm run test --workspace=server -- src/lib/attachment-storage.test.ts`
   Expected failure: upload factory import/limit assertions fail because no attachment multipart middleware exists.

9. Implement minimal code to satisfy the test:
   File: `server/src/lib/attachment-upload.ts`
   Implement: a lazy Multer memory-storage factory `createAttachmentUpload({ maxPairs })` with repeated `thumbnail`/`original` fields, route-specific `maxCount`, explicit `limits.files` and `limits.parts`, a documented existing-card ceiling of ten pairs/twenty files with a finite parts allowance compatible with the configured nginx upload limit, `limits.fileSize: 10 * 1024 * 1024`, and an exported error-normalization boundary. Enforce the aggregate file-byte budget in the storage boundary before buffering beyond the shared ceiling. Export or otherwise expose the profile ceilings to tests so each `N + 1` case is asserted without duplicating hidden constants. Do not write files from Multer; storage writes remain explicit so DB rollback can unlink them.

10. Run test — verify PASS:
    `npm run test --workspace=server -- src/lib/attachment-storage.test.ts`
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
Given the card-create parser profile, When more than three pairs or a file over 10MB arrives, Then Multer rejects before provider write; given the existing-card profile, When a four-image batch arrives, Then Multer accepts it for route-level partial capacity handling, while requests exceeding its documented pair/file/parts ceilings reject before provider invocation. Requests at the aggregate file-byte boundary are accepted and the first over-limit request is rejected before provider invocation.

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
- A card-create parser profile that permits more than three pairs, an existing-card parser cap that prevents valid partial batches, or buffering beyond the aggregate byte budget.
- Object storage, CDN, presigned URL, quota, sweeper, or new image-processing dependency.

Open question risks:

- If a self-host uses a read-only or unavailable `ATTACHMENTS_DIR`, report NEEDS_CONTEXT rather than silently falling back to public storage.

Rollback note:

- The provider is additive. Disable attachment UI/routes while leaving the private directory/volume mounted; existing logo uploads remain unchanged.

## STOP CONDITIONS

Done when: provider and parser tests pass, typecheck is green, and both commits exist.
Uncertain when: the configured private path resolves inside `client/public`; stop and report NEEDS_CONTEXT.
Escalate when: implementation requires a native image library, object storage, or public static serving.
