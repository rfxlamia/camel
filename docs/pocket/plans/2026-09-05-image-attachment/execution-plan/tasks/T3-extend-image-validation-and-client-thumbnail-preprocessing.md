# Task T3 — Extend image validation and client thumbnail preprocessing

**Phase:** 1
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
   `npm run test --workspace=server -- src/__tests__/file-validator.test.ts`
   Expected failure: oversized-dimension fixtures are currently reported valid or have no dimension error.

3. Implement minimal code to satisfy the test:
   File: `server/src/lib/file-validator.ts`
   Implement: PNG IHDR width/height parsing and JPEG SOF marker scanning, with a 4096px maximum for either source dimension. Preserve existing signature/MIME checks and return a stable validation error that route code can map to the user-facing dimension message.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/__tests__/file-validator.test.ts`
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
   `npm run test --workspace=client -- src/lib/imageAttachments.test.ts`
   Expected failure: helper import fails because client image preparation has not been implemented.

9. Implement minimal code to satisfy the test:
   File: `client/src/lib/imageAttachments.ts`
   Implement: shared constants (`MAX_ATTACHMENT_COUNT`, `MAX_ATTACHMENT_BYTES`, `MAX_IMAGE_DIMENSION`), MIME/extension mapping, a tagged preparation result that preserves invalid input/error text for staged chips, client dimension validation, Canvas downscale preserving aspect ratio, and original-byte fallback. Export the prepared pair shape consumed by both existing-card and staged-create flows.

10. Run test — verify PASS:
    `npm run test --workspace=client -- src/lib/imageAttachments.test.ts`
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
