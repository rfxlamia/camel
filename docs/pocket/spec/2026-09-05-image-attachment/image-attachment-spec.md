# Image Attachment on Board Cards

**Date:** 2026-09-05
**Status:** draft
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md

---

## Summary

Workspace members can attach images (screenshots, mockups, photos) to board cards to explain tasks visually, similar to Jira's card attachments. Images can be added either from the card detail panel (existing card) or inline while creating a new card. Board tiles show a cover thumbnail; card detail shows a full gallery with lightbox and download.

---

## Context

### Current State

- `cards` table (`server/src/db/schema.sql`) has no media column. Board tile (`CardView.tsx`/`CardBody`) and card detail (`ContextPanel.tsx`) render text/metadata only.
- Precedent exists for file upload: logo upload (`server/src/routes/settings.ts`) uses `multer` diskStorage → `client/public/uploads`, with MIME + size + file-signature validation (`server/src/lib/file-validator.ts`). Delivery is via **public, unauthenticated** `express.static("/uploads")`.
- New-card creation (`AddCard.tsx`) uses `TaskTitleEditor.tsx`, whose `@`-triggered command palette only supports pick-from-list fields (`TaskFieldCommandDefinition`: options, `mapOptionToValue`, backed by a `taskMetadataDraft` reducer).
- Deploy is a single server container with a named Docker volume (`camel_uploads`) — no object storage, CDN, or multi-instance filesystem.
- Server has no image-processing library.

### Problem / Motivation

Issue #110 requests image upload with card preview; there is currently no way to attach visual evidence to a card. The existing logo-upload pattern cannot be reused as-is because it is public and unauthenticated — unsuitable for workspace-private card attachments (see `docs/pocket/spec/2026-09-05-image-attachment/pitch-exploration.md`).

### Related Areas

- `server/src/routes/settings.ts`, `server/src/lib/file-validator.ts` — upload/validation precedent to extend
- `server/src/routes/helpers.ts` (`recordActivity`) — activity logging
- `server/src/realtime.ts` (`publishEvent`) — SSE broadcast
- `client/src/components/ContextPanel.tsx`, `CardView.tsx`, `AddCard.tsx`, `task-entry/TaskTitleEditor.tsx`
- `server/src/db/schema.sql` — new table
- `deploy/nginx/camel.conf` — request body size config

---

## Scope

### In-Scope

- Image-only attachments (PNG/JPEG) on board `cards` (not `tracker_items`)
- Per-file size cap 10MB, per-card cap of 3 images, enforced via DB-level lock+count guard (never overshoots under concurrency)
- Any workspace role/member may upload, view, download, delete
- Upload entry points:
  - Button + native file-picker, multi-select allowed, in `ContextPanel` (existing card)
  - Paste-from-clipboard in `ContextPanel` (existing card)
  - New `@image` command in the create-card `TaskTitleEditor` palette — stages file(s) client-side, uploads with the card-create request in one all-or-nothing transaction
- Batch overflow on the **existing-card** path: accept what fits, reject the rest with an inline message ("2 of 4 images added — card limit is 3 images"); a persistent "N/3 images" counter is shown near the upload control, kept in sync via the attachment SSE event
- Batch overflow on the **create-card** path: hard cap at stage-time — the UI refuses to stage more than 3 files; there is no partial-accept ambiguity because there's no pre-existing count to justify one
- Board tile shows one cover thumbnail (oldest attachment by `created_at`, tie broken by ascending attachment `id`) + a "+N" badge if more than one image
- When the last remaining image on a card is deleted, the board tile and gallery revert to the plain no-media state
- Card detail shows a full gallery; clicking a thumbnail opens a lightbox modal with the full-size image and an explicit download button
- Delete requires a confirmation dialog
- New authenticated delivery routes, all behind one shared ownership-chain guard (member of workspace AND card belongs to workspace AND attachment belongs to card):
  - `POST /api/workspaces/:wsId/cards/:cardId/attachments`
  - `GET /api/workspaces/:wsId/cards/:cardId/attachments/:id/thumbnail` (inline)
  - `GET /api/workspaces/:wsId/cards/:cardId/attachments/:id/original` (inline)
  - `GET /api/workspaces/:wsId/cards/:cardId/attachments/:id/original/download` (forced download via `Content-Disposition: attachment`)
  - `DELETE /api/workspaces/:wsId/cards/:cardId/attachments/:id`
  - `Cache-Control: private, max-age=300` + `ETag` on GET routes; distinct paths for inline vs. download avoid cache collisions
- Thumbnail generation: client-side canvas downscale before upload; both thumbnail and original bytes uploaded together
  - Max source dimension 4096×4096px, checked client-side (fast UX feedback) **and** server-side (byte-header parsing — PNG IHDR, JPEG SOF marker — same technique as `validateFileContent()`, no image library). This closes the direct-API-bypass DoS vector a client-only check would leave open.
  - If client-side canvas thumbnail generation fails for any reason, fall back to uploading the original bytes as both payloads. At the 4096px ceiling this fallback stays small enough that it isn't a secondary bandwidth problem worth its own guard.
- `nginx` `client_max_body_size` raised to accommodate a realistic multi-select batch (~35m) — see Deployment note below
- Local-disk storage provider behind a storage-provider interface (swappable later; object storage itself is not built now). Files are written to a **new, separate directory outside `client/public`** (e.g. `server/private-uploads`, mounted via a new named Docker volume distinct from `camel_uploads`) — NOT under `UPLOADS_DIR` (`client/public/uploads`), because that entire tree is served publicly by `express.static` (`server/src/index.ts`). Attachments must never be reachable outside the authenticated delivery routes; sharing the existing public uploads directory would make the ownership-chain guard decorative.
- `recordActivity()` on every upload/delete, plain-text description, no inline thumbnail in the activity feed
- Realtime: upload/delete broadcast via existing `publishEvent`/SSE
- Card deletion cascades attachment rows via `ON DELETE CASCADE` FK; disk files cleaned up best-effort (mirrors `tryDeleteOldUploadedLogo()`)
- Attachment upload/delete does **not** bump the parent card's `version` — unrelated concurrent card edits are unaffected
- File validation (extension allowlist + MIME + signature check) extended from the existing `validateFileContent()` pattern, applied to both thumbnail and original bytes; paste-from-clipboard blobs (no filename) get their extension derived from detected MIME type, same as `generateLogoFilename()`

### Out-of-Scope

- Tracker/unified work-item surface parity — attachments live on `cards` only; no cross-table lookup into `tracker_items` (ADR #103 dual-table isolation)
- Generic/non-image file attachments
- Image annotation, search indexing, agent/LLM ingestion
- Object storage / CDN / presigned URLs — local disk only, swappable-by-design but not built now
- Cross-workspace sharing
- In-place image replace/edit (crop, etc.) — only add/delete
- Manual cover selection or attachment reordering
- Drag-and-drop upload (only button/file-picker and clipboard-paste)
- Workspace-level storage quota
- Automated orphaned-file sweeper/cron job
- Idempotency-key infrastructure for the card-create+image request

---

## Architecture Constraints

- Layers this work may touch: `server/src/routes` (new attachments route), `server/src/db/schema.sql` (new table), `server/src/lib` (storage provider abstraction, extended file-validator), `client/src/components/ContextPanel.tsx`, `CardView.tsx`/`CardBody`, `AddCard.tsx`, `task-entry/TaskTitleEditor.tsx`, `client/src/api.ts`, `client/src/types.ts`, `deploy/nginx/camel.conf`
- Layers this work must NOT touch: `tracker_items` table, `work-item-response.ts` routing logic, `workItemMutations.ts` (board-native attachment edits exempt per ADR #103, same as `BoardContext.tsx`)
- Patterns that must be followed: `recordActivity()` on every mutation, NodeNext `.js` import extensions server-side, no extensions client-side, OKLCH/Work Sans design tokens from `docs/pocket/rule/creative-brief.md`
- Architecture validation result: **PASS** (see Phase 6 checklist — no new dependencies, existing patterns reused, rollback/atomicity defined, no security regressions)

---

## Dependencies

### Existing (to leverage)

- `multer` — multipart upload handling, same diskStorage pattern as logo upload
- `server/src/lib/file-validator.ts` (`validateFileContent`) — extended with dimension-check byte parsing (PNG IHDR, JPEG SOF marker), same technique already in use
- Browser Canvas API — client-side thumbnail downscale, no library needed
- `server/src/realtime.ts` (`publishEvent`) — SSE broadcast, no new mechanism
- `express-rate-limit` / `rate-limit-redis` — available if upload rate limiting is needed at implementation time (not newly required by this spec, but already installed)

### New (proposed)

None. Hand-rolling justification: thumbnail generation and dimension validation are handled via already-installed capabilities (Canvas API client-side, byte-header parsing server-side, matching the existing `validateFileContent()` technique) rather than adding `sharp`/`jimp`, because the deployment topology is a single container with a named volume — a native image-processing dependency would increase Docker image size and build complexity without a corresponding need (no batch/import pipeline, no third-party image ingestion).

---

## Stories + Scenarios

### Story 1: Upload image to existing card

> As a workspace member, I want to attach an image to a card, so that I can clarify a task visually.

**Rule 1: Format, size, and count caps**
- Example A: Upload `screenshot.png` (2MB) to a card with 0 images → succeeds, becomes cover
- Example B: Upload a 4th image to a card that already has 3 → rejected, "Max 3 images per card"
- Example C: Upload `report.pdf` → rejected, "Only PNG and JPEG accepted"
- Example D: Upload `huge.jpg` (15MB) → rejected, "File size must be under 10MB"
- Example E: Upload a 30000×30000px solid-color PNG under 10MB → rejected server-side by the dimension check, even if a client bypasses the browser UI entirely

```gherkin
Scenario: Upload valid image to card with room remaining
  Given a card with 1 existing image attachment
  When a member uploads a 2MB PNG via the file picker
  Then the image is stored, a card_events "attachment_added" row is recorded
  And other viewers see the new thumbnail appear via SSE without refreshing

Scenario: Reject upload exceeding per-card cap
  Given a card already has 3 image attachments
  When a member attempts to upload a 4th image
  Then the request is rejected with "Max 3 images per card"
  And no file is written, no DB row created

Scenario: Reject disguised file content
  Given a member selects a file named "photo.png" whose bytes are actually a PDF
  When the upload is submitted
  Then file-signature validation rejects it before any DB write

Scenario: Reject oversized-dimension image bypassing the client
  Given a direct API call uploads a file under 10MB but with pixel dimensions of 30000x30000
  When the server parses the PNG IHDR / JPEG SOF header bytes
  Then the upload is rejected before any file write or DB insert
```

**Rule 2: Concurrent uploads never exceed the per-card cap**
- Example F: Two members simultaneously upload to a card at 2/3 → exactly one succeeds, the other is rejected as over-cap

```gherkin
Scenario: Concurrent uploads respect the cap under a DB-level guard
  Given a card has 2 image attachments
  When two members submit uploads at nearly the same time
  Then the row lock + count-check inside the insert transaction ensures only 1 of the 2 requests succeeds
  And the card never ends up with more than 3 images
```

**Rule 3: Multi-select and batch overflow (existing-card path only)**
- Example G: Card at 1/3, member selects/pastes 4 images → first 2 accepted (filling to 3), remaining 2 rejected with "2 of 4 images added — card limit is 3 images"

```gherkin
Scenario: Batch upload partially exceeds remaining slots
  Given a card has 1 existing image (2 slots remaining)
  When a member selects 4 images via the file picker
  Then 2 images are accepted, 2 are rejected
  And the UI shows "2 of 4 images added — card limit is 3 images"
  And the persistent "2/3 images" counter updates accordingly

Scenario: Paste image from clipboard
  Given a member has an image copied to their OS clipboard, with no filename
  When they paste (Ctrl/Cmd+V) while the card detail panel is focused
  Then the extension is derived from the detected MIME type
  And the pasted image enters the same validation/upload path as a file-picker selection
```

---

### Story 2: Attach image while creating a new card

> As a workspace member, I want to attach an image while typing a new card's title, so that I don't need a second step after creation.

**Rule 4: Card-create with staged images is all-or-nothing at the DB layer**
(File write precedes the transaction and is unlinked on rollback — see Implementation Notes on atomicity boundaries. This is DB-row atomicity, not cross-filesystem-and-database atomicity.)
- Example H: Member stages 1 valid 2MB PNG via `@image`, submits → card created with image attached in one transaction
- Example I: Member attempts to stage a 4th image via `@image` on a new card → UI refuses to stage it (hard cap at select-time, no partial-accept on this path)
- Example J: Member stages a 15MB image, submits → no card created, staged chip shows error, form stays editable

```gherkin
Scenario: Create card with staged image succeeds
  Given a member typed "@image" in the new-card title editor and selected a valid 2MB PNG
  When they submit "Add to board"
  Then a loading indicator replaces the form
  And the image file is written to disk, then the card row and attachment row are inserted together in one Postgres transaction (DB-row atomicity; the file write itself is not part of the DB transaction — if the transaction fails, the just-written file is unlinked)
  And the image appears as the card's cover on the board tile

Scenario: Staging refuses a 4th image at select-time
  Given a member has already staged 3 images via "@image" on a new card
  When they attempt to stage a 4th
  Then the client refuses the selection immediately with "Max 3 images per card"
  And the create-card submission is never put in a position to arbitrate an overflow

Scenario: Staged image fails validation on submit
  Given a member staged a 15MB image via "@image" and typed a title
  When they submit
  Then no card is created, the staged image chip shows an error, and the form remains editable

Scenario: Network drops mid-upload during create
  Given a member submitted a card-create request with a staged image
  When the connection drops before the server responds
  Then no partial card exists client-side, and the UI surfaces a retry-able error, not a silently blank state
  (Note: if the server actually committed before the response was lost, a client retry may create a duplicate card+image — accepted as a documented residual risk for v1; no idempotency-key infrastructure is built)
```

---

### Story 3: View images on board and in card detail

> As a workspace member, I want to see attached images without opening every card, so that I can scan the board visually.

**Rule 5: Cover selection and overflow badge**
- Example K: Card has images A, B, C uploaded in that order → board tile shows A as cover, "+2" badge
- Example L: A and B share an identical `created_at` (uploaded in the same batch) → tiebreak by ascending attachment `id`

```gherkin
Scenario: Board tile shows cover and overflow count
  Given a card has 3 image attachments uploaded in order A, B, C
  When the board renders the card tile
  Then it shows a thumbnail of A (oldest) and a "+2" badge

Scenario: Cover tiebreak on identical timestamps
  Given two attachments were created in the same batch request with identical created_at
  When the board determines the cover
  Then the attachment with the lower id is chosen as cover
```

**Rule 6: Authenticated, cached delivery**
- Example M: Non-member requests an attachment URL directly → 403/404
- Example N: Browser re-requests an already-cached thumbnail → 304

```gherkin
Scenario: Non-member cannot fetch attachment bytes
  Given a user is not a member of the workspace owning the card
  When they request the attachment delivery URL directly
  Then the server responds 403/404, not the image bytes

Scenario: Ownership chain closes ID-substitution
  Given a member belongs to workspace W but the requested attachment belongs to a card in a different workspace
  When they request GET/DELETE on that attachment's URL using a card/attachment ID from elsewhere
  Then the shared ownership-chain guard rejects the request even though workspace membership alone would have passed

Scenario: Repeat board load hits cache
  Given a browser already loaded a thumbnail with an ETag
  When the board re-renders and re-requests the same thumbnail
  Then the server responds 304 Not Modified

Scenario: Open full image from gallery
  Given a card detail view with 2 attachments
  When a member clicks a thumbnail
  Then a lightbox modal opens showing the full-size image with a download button

Scenario: Download forces a save dialog, inline view does not
  Given a member is viewing an attachment in the lightbox
  When they click the explicit download button
  Then the request goes to the distinct /original/download path with Content-Disposition: attachment
  And the lightbox's own inline image request is unaffected and remains cacheable separately
```

---

### Story 4: Delete an attachment

> As a workspace member, I want to remove an attached image, so that outdated visual evidence doesn't stay on the card.

**Rule 7: Confirmed delete, cover reassignment, cascade cleanup**
(Delete order: remove the DB row first, then best-effort unlink the file. If the unlink fails after the row is already gone, the file becomes an orphan on disk — same residual-risk class as the crash-window orphan risk already accepted; no sweeper is added for this case either.)

```gherkin
Scenario: Delete non-cover image
  Given a card has cover A and second image B
  When a member deletes B and confirms
  Then B's DB row and file are removed, cover remains A, activity logged, SSE broadcasts the change

Scenario: Delete the cover image
  Given a card has cover A and second image B
  When a member deletes A and confirms
  Then B becomes the new cover on next board render

Scenario: Delete the last remaining image
  Given a card has exactly 1 image attachment
  When a member deletes it and confirms
  Then the board tile and gallery revert to the plain no-media state
  And a normal "removed image" activity event is recorded (no special wording)

Scenario: Cancel delete confirmation
  Given a member clicks delete on an image
  When they cancel the confirmation dialog
  Then nothing is removed

Scenario: Delete a card with attachments
  Given a card has 2 image attachments
  When the card is deleted
  Then attachment DB rows are cascade-deleted via FK
  And attachment files are best-effort unlinked from disk (failure does not block card deletion)

Scenario: Attachment upload/delete does not affect card optimistic locking
  Given a title edit is in flight from member A while member B uploads an attachment to the same card
  When member A's edit reaches the server
  Then the attachment upload has not altered card.version, and A's save does not 409 due to the unrelated attachment change
```

---

## Acceptance Criteria

```
Rule: Format, size, and count caps
  ✓ Given a card with room, When a valid PNG/JPEG ≤10MB is uploaded, Then it succeeds
  ✓ Given a card at 3/3, When a 4th image is uploaded, Then it is rejected with "Max 3 images per card"
  ✗ Given a non-image file, When uploaded, Then rejected with "Only PNG and JPEG accepted"
  ✗ Given a file >10MB, When uploaded, Then rejected with "File size must be under 10MB"
  ✗ Given a file with pixel dimensions >4096x4096 (client or direct API), When uploaded, Then rejected server-side via header-byte parsing

Rule: Concurrency safety
  ✓ Given concurrent uploads at 2/3, When both submit, Then exactly one succeeds via DB-level lock+count guard

Rule: Batch upload
  ✓ Given an existing card with N slots free and a batch of M>N images, When submitted, Then N succeed and M-N are rejected with a specific count message
  ✓ Given a new card being created, When a 4th image is staged via @image, Then the client refuses the selection at stage-time (no partial-accept)

Rule: Card-create atomicity
  ✓ Given a valid staged image, When card-create is submitted, Then card+image are created in one all-or-nothing transaction with a loading state shown throughout
  ✗ Given an invalid staged image, When submitted, Then no card is created at all

Rule: Display
  ✓ Given a card with images, When the board renders, Then the oldest image (tiebreak: lowest id) shows as cover with a "+N" badge if applicable
  ✓ Given a card's last image is deleted, Then board tile and gallery revert to no-media state

Rule: Delivery and authorization
  ✓ Given a workspace member requesting their own workspace's attachment, Then 200 with correct bytes and Cache-Control/ETag headers
  ✗ Given a non-member, or a member using an ID from another workspace/card, Then 403/404 via the shared ownership-chain guard
  ✓ Given a cached ETag matches, Then 304 Not Modified
  ✓ Given the explicit download button is used, Then Content-Disposition: attachment via the distinct /original/download path

Rule: Delete
  ✓ Given a delete confirmation is accepted, Then the attachment is removed, activity logged, SSE broadcast
  ✗ Given a delete confirmation is cancelled, Then nothing changes
  ✓ Given a card is deleted, Then attachment rows cascade via FK and files are best-effort unlinked

Rule: Isolation from unrelated systems
  ✓ Given an attachment mutation, Then card.version is unchanged and tracker_items is untouched
```

---

## Design Decision

**Chosen option:** Single `attachments` table (one row per logical image, `thumbnail_path` + `original_path` columns), client-side canvas thumbnailing, authenticated delivery route with shared ownership-chain guard, local-disk storage behind a provider interface.

**Summary:** This maps directly onto the locked route shape (`/thumbnail`, `/original`, `/original/download` all resolve one row) and avoids adding any new server dependency, matching the single-container deployment's constraints while keeping a clean swap path to object storage later.

**Rejected options:**
- Two rows per attachment (thumbnail + original as separate rows joined by a group id) — rejected: adds join complexity the single-row design doesn't need, and doesn't match the route shape decided during discovery.
- Server-side thumbnail generation via `sharp`/`jimp` — rejected: adds a native dependency and Docker image size/build complexity the single-container topology doesn't currently need; original is always retained, so server-side regeneration remains possible later without re-architecting.
- Unguessable/capability URLs for delivery (no per-request auth check) — rejected: cannot be revoked when a member leaves a workspace, leaks via referrers/logs/pasted links; explicitly discarded during the pitch.
- Two-step "stage upload, then reference in card-create" flow — rejected: breaks the all-or-nothing guarantee for Story 2 (two round trips instead of one transaction).
- Reusing the existing `/uploads` public `express.static` contract — rejected: unsuitable for workspace-private data; the pitch's entire root tension is this specific gap.

**Key tradeoffs accepted:**
- No workspace-level storage quota — only per-file/per-card caps bound growth in v1
- No automated orphaned-file sweeper — a rare crash-window race can leave an unreferenced file on disk
- No idempotency-key protection — an ambiguous network failure during card-create-with-image can, on retry, create a duplicate card+image
- Silent blank-canvas output on some low-capability mobile browsers is not specifically detected; mitigated by the conservative 4096px ceiling rather than fixed directly

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Workspace-level storage quota | Not built in v1; per-file (10MB) + per-card (3) caps only | Unbounded workspace storage growth over time; revisit if disk usage becomes an operational problem |
| Orphaned file on process crash between file-write and DB-commit | Accepted residual risk, no sweeper | Rare disk-space leak from files with no DB row; requires manual cleanup if it ever matters |
| Idempotency for card-create+image on ambiguous network failure | Accepted residual risk, no idempotency-key | Rare duplicate card+image on client retry after a lost success response |
| Session-cookie-on-`<img src>` cross-origin behavior (client :5173 → server :3001 dev; camel.web.id/api.camel.web.id prod) | Assumed to work via SameSite=Lax + same-site origins | Must be verified empirically at implementation time; if it fails, delivery may need `fetch()` + blob URL with `credentials: "include"` instead of plain `<img src>` |
| Canvas dimension/area ceiling on the lowest-capability supported mobile browser | Assumed 4096×4096 is safely under real-world canvas limits | If wrong, silent blank thumbnails could occur on some devices without being detected |

---

## Implementation Notes

- **`card_events` schema constraint (blocking for the first task):** `card_events.to_column_id` is `INTEGER NOT NULL` (`server/src/db/schema.sql:23-29`). Attachment events have no column transition, so `recordActivity()` must be called with the card's *current* `column_id` as `toColumnId` (not `null`) to satisfy the constraint. `fromColumnId` can stay `null` (already nullable), matching how non-move events should read.
- **`recordActivity()` eventType union (blocking for the first task):** the TS parameter type is a closed union (`"create" | "update" | "move" | "reorder" | "delete" | "linear_ticket_created" | "focus_session"`). It must be extended to include `"attachment_added"` and `"attachment_removed"` (or similar) before attachment routes can call it — the DB column itself is free TEXT, so no schema migration is needed for this part, only the TS type.
- **Storage path is not the public uploads directory:** attachments must be written to a new directory outside `client/public` (e.g. `server/private-uploads`), mounted via a new named Docker volume distinct from `camel_uploads` in `docker-compose.yml` / `deploy/docker-compose.prod.yml` / `deploy/docker-compose.ggf.yml`. Do not register this directory with `express.static` anywhere — it must only be reachable through the authenticated delivery routes.
- **Atomicity boundary:** file bytes are written to disk before the DB transaction opens; the DB transaction (card/attachment row inserts, or attachment row insert alone for the existing-card path) is what's atomic. On transaction failure, the just-written file(s) are unlinked. This is DB-row atomicity, not filesystem+database atomicity — do not implement or promise a two-phase-commit-style guarantee across both.
- New DB migration must be added to `server/src/db/schema.sql` (applied via `make db-migrate`, not a separate migration command).
- `deploy/nginx/camel.conf` needs `client_max_body_size` raised (~35m) on the `/api/` proxy block(s) — verified today that neither the client-facing nor `api.camel.web.id` server block currently overrides nginx's 1MB default, which is already below the existing 10MB single-file logo-upload cap.
- The shared ownership-chain guard (workspace membership + card∈workspace + attachment∈card) must be implemented once (e.g., as Express middleware) and applied to all five route surfaces (POST, GET thumbnail, GET original, GET original/download, DELETE) — not reimplemented per route.
- `TaskTitleEditor.tsx` needs a new command-definition variant distinct from `TaskFieldCommandDefinition` (file-trigger rather than options-list) for the `@image` command; this is additive to the existing command palette, not a rewrite.
- Verify empirically, before finalizing the delivery route's auth mechanism, whether the session cookie actually accompanies a cross-origin `<img src>` request in both dev and prod topologies (see Open Questions).

---

## Rollback Plan

- New table and routes are additive — disabling the feature means not exposing the new UI entry points (`@image` command, "Add image" button, board tile media slot); no existing behavior is modified.
- If the delivery route or storage provider has a critical issue post-deploy, the UI entry points can be hidden behind a feature flag without a schema rollback, since existing cards/columns/tracker_items are untouched.
- `client_max_body_size` change in nginx can be reverted independently of the application deploy if it causes unrelated issues.
