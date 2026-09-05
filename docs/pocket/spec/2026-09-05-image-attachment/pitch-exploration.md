# Pitch Exploration: image-attachment

Date: 2026-09-05 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement

Users cannot attach visual evidence such as screenshots, mockups, or photos to board task cards because the current card surfaces support text and metadata only. They need a durable image association that can be recognized quickly on the board and opened in full from the card detail.

## Root Tension

The product needs immediate visual context without sacrificing board performance, workspace privacy, storage durability, or reliable cleanup of image data.

## Key Constraints

- Issue #110 requests image uploads with a thumbnail/preview on task cards, but leaves the implementation open.
- The current board card surface renders the key, title, description, due date, and assignees; it has no media surface.
- The existing logo upload pattern uses `multer`, `FormData`, a local `client/public/uploads` directory, PNG/JPEG validation, a 10 MB limit, and file-signature checks.
- The current `/uploads` route is an unauthenticated `express.static` path. It is suitable for the existing public-logo pattern but not sufficient for workspace-private attachments.
- Production Compose mounts a named `camel_uploads` volume for the single server container. No object storage, CDN, or shared multi-instance filesystem is currently shown in deployment configuration.
- The board/tracker unified view intentionally uses two tables with split writes and split audit streams. This pitch keeps the initial scope board-card-first rather than assuming tracker-item semantics.
- Every mutation must record activity, and any attachment lifecycle must account for metadata, binary storage, preview data, and cleanup.
- UI direction must remain calm, structured, accessible, and consistent with Camel's Work Sans and OKLCH design authority.

---

## Brainstorming Methods Used

### Question Storming — deep

Key insights:

- The meaning of “shown on the card” must distinguish board tiles, card detail, tracker rows, and other work-item surfaces.
- Visibility, download, deletion, and upload permissions need an explicit workspace/card policy.
- The MVP must decide whether multiple images, cover selection, ordering, captions, and individual deletion are in scope.
- Upload failure, abandoned forms, deleted cards, and deleted workspaces need a defined lifecycle.
- Success means visual evidence is available after refresh without making the board slow or losing the association when a card moves or changes status.

### First Principles Thinking — creative

Key insights:

- The core job is durable visual evidence attached to one work item, not a general file manager.
- Binary content, attachment metadata, and visual preview are separate concerns with different size and lifecycle needs.
- The association must remain stable when a card's title, column, status, or position changes.
- A preview is a recognition affordance; the original image still needs a deliberate full-view or download path.
- Image bytes are untrusted input, so filename, declared MIME type, extension, and detected content must not be treated as equivalent.

### Six Thinking Hats — structured

Key insights:

- **White:** The issue requires image upload and card preview; current cards have no media; existing uploads are logo-oriented and public; chat attachments are text/CSV/Markdown and separate.
- **Red:** Users will expect the image to feel immediately attached; a missing or broken preview will undermine trust in the task record.
- **Yellow:** Visual evidence can improve bug reports, design review, handoff, and team context without duplicating files elsewhere.
- **Black:** Unbounded storage, cross-workspace access, unsafe image formats, broken links, board payload growth, and orphaned files are credible failure modes.
- **Green:** A single cover thumbnail with a `+N` count, a detail gallery, and paste/drag-and-drop are promising interaction concepts.
- **Blue:** Define scope and lifecycle before selecting the data/storage shape; validate the experience on board and detail surfaces separately.

### Constraint Mapping — deep

Key insights:

- Board cards and tracker items have different tables, mutation routes, and audit streams; attachment scope must not accidentally write across that boundary.
- The local named volume is viable for the current single-host topology but does not itself provide privacy, backups, or multi-instance sharing.
- Multipart upload, CSRF, content validation, upload limits, authorized delivery, and error states must work as one user-visible flow.
- Original images and board previews have different performance requirements; full-size binaries should not inflate every card response.
- Delete, replace, failed association, card deletion, and workspace deletion must not leave metadata or files orphaned.

### Reverse Brainstorming — creative

Key insights:

- Accepting arbitrary, unlimited files would allow storage exhaustion; limits and quotas become essential.
- Trusting browser MIME or filename alone could allow disguised or unsafe content; content validation and an explicit format allowlist are needed.
- Rendering every full-size image on every card would make the board slow and visually noisy; previews must be bounded and deferred.
- Public guessable URLs would turn a workspace attachment into an access-control bypass; delivery must check authorization.
- Separating upload success from card association could create orphaned files or misleading UI; failure and cleanup need a coordinated lifecycle.

---

## Advisor Synthesis

The strongest common pattern is that the visible UX is straightforward, while secure and durable storage plus lifecycle semantics determine whether an approach is viable. The advisor curated an image-only, board-card-first MVP: one lazy cover thumbnail and a `+N` indicator on the board, with gallery and management in card detail. It discarded generic files, full-size images in board payloads, public guessable URLs, base64 card data, and agent/search/annotation capabilities for the first release.

---

## Spike Results

**Unknown resolved:** Can the current deployment safely provide durable, workspace-private image storage?

**Finding:** The production server has a named `camel_uploads` volume mounted at `/app/client/public/uploads`, so files can survive ordinary container recreation on the same host while the volume is retained. Deployment shows one server container, but no object storage, shared filesystem, or multi-instance arrangement. The application serves `/uploads` through unauthenticated `express.static`, so the existing delivery path is public rather than workspace-private.

**Implication:** A local storage provider can support an initial single-host implementation, but private attachments need an authorization-aware delivery path and must not reuse the public static contract. Portability to object storage should remain possible without making a cloud vendor part of this pitch.

---

## Approach Directions

### Direction A: Extend Existing Upload Mechanism

Adapt the current logo-oriented `multer` and local-volume path for card images.

- Fastest path with maximum reuse of existing upload code.
− Couples private attachment semantics to public/static infrastructure and increases cleanup and authorization debt.

### Direction B: Dedicated Attachment Capability, Local Provider First

Treat card images as a dedicated capability with a private delivery contract and a local named-volume provider for the current deployment. Keep the storage choice replaceable as durability or scale requirements grow.

- Fits the current topology while preserving a clean migration path and explicit attachment lifecycle.
− Requires more initial product and operational design than a direct extension.

### Direction C: Object Storage from Day One

Start with private object storage and authorized or presigned delivery instead of local disk.

- Strongest durability and scaling model from the beginning.
− Adds provider configuration, credentials, operations, and deployment complexity before the current topology requires them.

---

## Discarded During Pitch

- Generic document or arbitrary-file attachment support in the first release.
- Rendering every image directly on the board.
- Storing image binaries or base64 in card API payloads.
- Public, guessable URLs without workspace authorization.
- Agent ingestion, search indexing, image annotation, or image replacement workflows beyond the core attachment need.

---

## Open Questions for pocket-grinding

- [ ] Is the first release strictly board-card-only, or must the unified tracker surface also expose the same attachments?
- [ ] What image formats, per-file size, per-card count, workspace quota, and dimension/animation rules define the MVP?
- [ ] Which workspace roles may upload, view, download, and delete an attachment, and should delivery require a session on every request?
- [ ] What thumbnail-generation strategy and retention policy fit the current server dependencies and local-volume deployment?
- [ ] What exact activity/realtime behavior is expected for upload, delete, and preview changes?
- [ ] What cleanup and recovery behavior is required when binary storage, metadata association, or card deletion fails independently?

---

## Recommended Direction

Direction B — it matches the existing single-host deployment for a pragmatic MVP while preventing the public logo-upload path from becoming the security and lifecycle contract for private card evidence.

---

## Handoff Context (for pocket-grinding)

When pocket-grinding reads this doc:

- Start with this problem statement and root tension.
- Use Direction B as the working hypothesis for Phase 5 Design Proposals.
- Treat the Open Questions above as Phase 3 Discovery targets.
- Keep the initial scope image-only and board-card-first unless discovery proves tracker parity is required.
- Validate preview placement, permissions, lifecycle, and storage behavior through GWT scenarios.
- Do not treat the Approach Directions as final architecture; validate them through GWT first.
