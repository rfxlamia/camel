# Task T7 — Show formatted key on card face and list view

**Phase:** 2
**Depends:** T3
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 7: Show formatted key on card face and list view [depends: T3] [parallel: T4]

## OBJECTIVE

Render the server-provided `card.key` on the kanban `CardBody` (including its
existing drag overlay) and in the list-view ID column. Keep the numeric id out
of the user-facing ID cell, use the tracker mono/tabular treatment, and do not
add a status picker.

Files:
- Modify: `client/src/components/CardView.tsx`,
  `client/src/components/ListView.tsx`,
  `client/src/components/ListView.test.tsx`
- Test: `client/src/components/CardView.test.tsx`
- Do not modify: `client/src/pages/BoardPage.tsx` (it already renders CardBody
  for the drag overlay)

Steps:

1. Write both display tests first: `CA-41` is visible on the card face and in
   the list ID column while the title remains; a longer prefix remains
   readable. Run:

   ```text
   npm run test --workspace=client -- src/components/CardView.test.tsx
   npm run test --workspace=client -- src/components/ListView.test.tsx
   ```

   Verify RED where the current UI renders no key or raw numeric id.

2. Implement with the existing tracker visual language. Use the server string
   directly (no client formatKey fork), widen/minmax the first list grid track
   beyond the current numeric 48px assumption, and render nothing for an old
   SSE payload with no key.

3. Run both client files again, refactor while green, and commit:

   ```text
   git add client/src/components/CardView.tsx client/src/components/ListView.tsx client/src/components/CardView.test.tsx client/src/components/ListView.test.tsx
   git commit -m "feat(board-tracker): show formatted card keys on board surfaces"
   ```

## REFERENCES LOADED

T3 `Card` type/response, `client/src/components/CardView.tsx`,
`client/src/components/ListView.tsx`, `TrackerRow`, and the creative brief.

## WHY THIS APPROACH

This is display-only against the additive server payload. Reusing `CardBody`
automatically covers the existing drag preview.

## SANDWICH CONTEXT

[CRITICAL: Do not add a status picker, tracker-key search, or BoardPage edit.]

## DELIVERABLE

Live cards show the same formatted key on card face and list row without
breaking old payloads.

## QUALITY BAR

- No client-side key formatting fork.
- Long keys fit the list layout.
- TDD and conventional commit.

## STOP CONDITIONS

Escalate if product changes the agreed list ID contract back to numeric ids.
