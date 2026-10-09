# Task T9 — Board panel pickers and dirty-state protection

**Phase:** 3
**Depends:** T8
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 9: Board panel pickers and dirty-state protection [depends: T8]

## OBJECTIVE

Add board ContextPanel controls for priority, labels, project, and phase by
reusing `TrackerPropertyPicker` and the same workspace lists as tracker. Save
through the existing `DetailsSection`/`saveCard` version path. Add no status
picker. Extend dirty-state protection so taxonomy edits are not overwritten by
SSE, successful saves update the baseline, and loading/error/empty option
lists do not destructively clear current selections.

Files:
- Create: `client/src/components/BoardCardTaxonomyFields.tsx`,
  `client/src/components/BoardCardTaxonomyFields.test.tsx`
- Modify: `client/src/api.ts`, `client/src/components/ContextPanel.tsx`,
  `client/src/components/ContextPanel.test.tsx`

Steps:

1. Write component and ContextPanel tests before implementation. Cover:

   - all four pickers render from mocked workspace option props and selection
     sends priority/label/project/phase ids, never `statusId`;
   - priority and labels clear to `null`/`[]`;
   - save includes the current version and updates the panel baseline after a
     successful PATCH;
   - an incoming SSE card update cannot overwrite unsaved taxonomy changes;
   - an SSE update after a successful save can update the now-clean baseline;
   - loading, request-error, and empty vocabulary/project/phase lists show a
     non-destructive state and retain existing selections; no crash or silent
     reset occurs;
   - the rendered panel has no status picker.

2. Run the client files and verify RED for the missing component/fields:

   ```text
   npm run test --workspace=client -- src/components/BoardCardTaxonomyFields.test.tsx
   npm run test --workspace=client -- src/components/ContextPanel.test.tsx
   ```

3. Implement `BoardCardTaxonomyFields` with `TrackerPropertyPicker`, mount it
   from `DetailsSection`, extend `api.ts` PATCH types, and load the same
   workspace vocabularies/projects/phases as tracker. Keep the outer panel's
   dirty guard, but include taxonomy values in its snapshot/baseline. Do not
   invent a board-only picker or a status control.

4. Run both files again and verify PASS. Refactor while green, remove unused
   imports/parameters required by client typecheck, and commit:

   ```text
   git add client/src/components/BoardCardTaxonomyFields.tsx client/src/components/BoardCardTaxonomyFields.test.tsx client/src/api.ts client/src/components/ContextPanel.tsx client/src/components/ContextPanel.test.tsx
   git commit -m "feat(board-tracker): add board taxonomy panel fields"
   ```

## REFERENCES LOADED

`client/src/components/ContextPanel.tsx`,
`client/src/components/tracker/TrackerPropertyPicker.tsx`, `client/src/api.ts`,
`client/src/lib/cardPanel.ts`, and the creative brief.

## WHY THIS APPROACH

The existing tracker picker and workspace loaders are the concrete reusable
surface. A dedicated section keeps the large ContextPanel bounded and makes
dirty/baseline behavior testable without a second picker implementation.

## SANDWICH CONTEXT

[CRITICAL: No status picker, no statusId payload, no Roadmap UI, and no
destructive reset when option requests are loading/empty/error.]

## DELIVERABLE

Users can set/clear all four taxonomy fields, save with version, preserve
unsaved edits across SSE, and recover safely from option-list states.

## QUALITY BAR

- Same workspace lists and picker chrome as tracker.
- Taxonomy participates in dirty/baseline/SSE semantics.
- Client tests and no-unused typecheck remain green.
- TDD and conventional commit.

## STOP CONDITIONS

Escalate if a status picker or Roadmap surface is requested, or if preserving
unsaved values would require changing the server SSE contract.
