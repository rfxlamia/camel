# Task T13 — Render board cover thumbnails and overflow badge

**Phase:** 3
**Depends:** T4, T9
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
