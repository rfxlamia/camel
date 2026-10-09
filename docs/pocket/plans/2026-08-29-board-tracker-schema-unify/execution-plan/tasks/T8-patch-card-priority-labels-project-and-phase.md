# Task T8 — PATCH card priority, labels, project, and phase

**Phase:** 3
**Depends:** T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 8: PATCH card priority, labels, project, and phase [depends: T5]

## OBJECTIVE

Extend PATCH `/cards/:id` with nullable `priorityId`, `labelIds`, `projectId`,
and `phaseId`, using existing tracker parsers for workspace/kind validation,
the existing optional-version/409 behavior, `card_labels`, and
`recordActivity` to `card_events`. Introduce one domain-neutral `diffIds`
helper for assignees, tracker labels, and card labels. Preserve the exact
board effective-project contract described in the overview.

Files:
- Create: `server/src/core/diff-ids.ts`, `server/src/core/diff-ids.test.ts`,
  `server/src/routes/card-labels.ts`, `server/src/routes/card-labels.test.ts`,
  `server/src/routes/cards-taxonomy.integration.test.ts`
- Modify: `server/src/routes/cards.ts`, `server/src/routes/card-assignees.ts`,
  `server/src/routes/tracker-items.ts`, `server/src/routes/tracker-item-parsers.ts`,
  `server/src/routes/tracker-item-parsers.test.ts`

Steps:

1. Write unit tests before implementation for `diffIds`, parser validation,
   and card label synchronization. `diffIds` must dedupe `next`, return added
   and removed ids, and be imported by assignee and both label sync paths.
   Parser tests cover valid/null priority, wrong kind/workspace labels and
   priority, and existing `parseProjectPhase` consistency behavior. Do not
   change tracker route semantics while changing its import.

2. Run the unit files and verify RED only for missing helper/parser/module
   exports:

   ```text
   npm run test --workspace=server -- src/core/diff-ids.test.ts
   npm run test --workspace=server -- src/routes/tracker-item-parsers.test.ts
   npm run test --workspace=server -- src/routes/card-labels.test.ts
   ```

3. Implement `diffIds`; replace the misleading `diffAssigneeIds` reuse in
   `card-assignees.ts`, `tracker-items.ts`, and `card-labels.ts`. Keep the
   assignee behavior unchanged. Implement `parsePriorityId` beside the other
   parsers and `syncCardLabels` against `card_labels`, never
   `tracker_item_labels`.

4. Write one HTTP integration suite containing all PATCH scenarios before
   wiring `cards.ts`:

   - set and clear priority/labels/project/phase, with version bump and
     `card_events`, and GET fields present;
   - stale version returns the existing 409 shape and leaves fields unchanged;
   - cross-workspace/wrong-kind project, priority, label, and phase values
     return 4xx before mutation;
   - phase-only on a card with no project returns 4xx;
   - phase-only on a card with an existing project is allowed only when the
     phase belongs to that effective project;
   - `projectId: null` with a non-null phase is 4xx even if the card currently
     has a project;
   - labels-only PATCH without a version key retains today's optional-version
     behavior; this characterization may begin GREEN;
   - POST/PATCH `statusId` remains 4xx from T4.

   The test must invoke real HTTP routes and real `parseProjectPhase`; do not
   claim that the parser itself rejects every phase-only request. The board
   route loads the current `project_id`, computes the effective project from
   current row plus body, then applies the board-specific guard around the
   parser result.

5. Implement the PATCH wiring. Expand `hasSets`, parse before writing, update
   the card and label junction in the existing transaction, preserve optional
   version semantics, and record card activity. Clear priority to `null` and
   labels to `[]`. Do not add status writes or modify tracker item routes
   beyond the shared diff import.

6. Run all tests:

   ```text
   npm run test --workspace=server -- src/core/diff-ids.test.ts
   npm run test --workspace=server -- src/routes/tracker-item-parsers.test.ts
   npm run test --workspace=server -- src/routes/card-labels.test.ts
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/cards-taxonomy.integration.test.ts
   ```

   Refactor while green and commit:

   ```text
   git add server/src/core/diff-ids.ts server/src/core/diff-ids.test.ts server/src/routes/card-labels.ts server/src/routes/card-labels.test.ts server/src/routes/cards.ts server/src/routes/card-assignees.ts server/src/routes/tracker-items.ts server/src/routes/tracker-item-parsers.ts server/src/routes/tracker-item-parsers.test.ts server/src/routes/cards-taxonomy.integration.test.ts
   git commit -m "feat(board-tracker): add card taxonomy patch validation"
   ```

## REFERENCES LOADED

`server/src/routes/cards.ts`, `server/src/routes/tracker-item-parsers.ts`,
`server/src/routes/tracker-items.ts`, `server/src/routes/card-assignees.ts`,
`server/src/routes/helpers.ts`, and the spec Rule 8.

## WHY THIS APPROACH

The shared diff operation now has three concrete consumers, so a domain-neutral
helper removes a real naming violation without a speculative utility layer.
Existing parsers provide validation knowledge; the board-only effective-project
guard adapts their tracker semantics without changing the parser contract.

## SANDWICH CONTEXT

[CRITICAL: `card_events`, not `tracker_events`; statusId remains rejected;
reuse parser checks; phase requires an effective project; no tracker table
merge or status picker.]

## DELIVERABLE

Card taxonomy can be set/cleared with correct validation, version conflicts,
activity, and board effective-project behavior; labels use the card junction
and `diffIds`.

## QUALITY BAR

- `diffIds` is shared by assignee and label paths.
- Real HTTP tests prove every 4xx/409 contract.
- Current optional-version behavior is characterized, not tightened silently.
- TDD and conventional commit.

## STOP CONDITIONS

Escalate if the requested behavior requires accepting statusId, writing
tracker events, changing tracker list/detail resolution, or weakening the
phase-without-effective-project rule.
