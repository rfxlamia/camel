# Task T3 — Shared vocabulary/card response and batched hydration

**Phase:** 2
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: Shared vocabulary/card response and batched hydration [depends: T2]

## OBJECTIVE

Extract one shared vocabulary response serializer and one card response
contract. GET board and GET card must expose additive `key`, `status` (with
slot), `priority`, `labels`, `project`, and `phase` fields while preserving
existing camelCase/timestamp/assignee fields. Hydration must batch labels and
assignees so multiple cards do not multiply rows or trigger an N+1 query.
The tracker route must consume the shared vocabulary serializer; do not import
the tracker router into card responses.

Files:
- Create: `server/src/routes/vocabulary-response.ts`,
  `server/src/routes/vocabulary-response.test.ts`,
  `server/src/routes/card-response.ts`,
  `server/src/routes/card-response.test.ts`,
  `server/src/routes/card-response.integration.test.ts`
- Modify: `server/src/routes/cards.ts`, `server/src/routes/board.ts`,
  `server/src/routes/tracker-items.ts`, `server/src/routes/board.test.ts`,
  `client/src/types.ts`

Steps:

1. Write unit tests for the complete response contract before implementation:

   - `serializeVocabulary` emits the existing id/kind/name/position/colour and
     emits `slot` only when supplied; tracker status output remains compatible;
   - a keyed card maps `formatKey(derivePrefix(workspace.name), key_number)`;
   - status includes id, kind, name, position, colour, category, and slot;
   - priority/labels use the shared serializer, and null taxonomy remains
     explicit (`null` or `[]`);
   - a null key number produces `key: null`, never a formatted null string;
   - board and card builders call the shared mapper rather than private inline
     camelCase maps.

2. Run the unit files and verify missing-module RED:

   ```text
   npm run test --workspace=server -- src/routes/vocabulary-response.test.ts
   npm run test --workspace=server -- src/routes/card-response.test.ts
   ```

3. Implement `vocabulary-response.ts` and use it from both
   `tracker-items.ts` and `card-response.ts`. Keep slot optional so tracker
   priority/label payloads do not change. Implement the card select/join and
   mapper, remove duplicated inline maps from `cards.ts` and `board.ts`, and
   update the client `Card` type with optional additive fields so old
   fixtures remain valid.

4. Add the real DB/HTTP integration test before declaring the task complete.
   Seed several cards with different priorities, projects, phases, two or
   more labels each, and assignees. GET the board and GET an individual card;
   assert each card occurs exactly once, every label is present, and all
   hydration fields match. The loader must use batched `IN (card ids)` label
   and assignee queries. Instrument the test executor/query hook (or the
   loader boundary) to prove one labels query and one assignee query for the
   board rather than one query per card; do not accept a test that merely
   checks the shape of one mocked row.

5. Run all server unit/integration files:

   ```text
   npm run test --workspace=server -- src/routes/vocabulary-response.test.ts
   npm run test --workspace=server -- src/routes/card-response.test.ts
   npm run test --workspace=server -- src/routes/board.test.ts
   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/card-response.integration.test.ts
   ```

   Refactor only while green. Commit:

   ```text
   git add server/src/routes/vocabulary-response.ts server/src/routes/vocabulary-response.test.ts server/src/routes/card-response.ts server/src/routes/card-response.test.ts server/src/routes/card-response.integration.test.ts server/src/routes/cards.ts server/src/routes/board.ts server/src/routes/tracker-items.ts server/src/routes/board.test.ts client/src/types.ts
   git commit -m "feat(board-tracker): share vocabulary and card response serializers"
   ```

## REFERENCES LOADED

`server/src/routes/cards.ts`, `server/src/routes/board.ts`,
`server/src/routes/tracker-items.ts`, `server/src/core/tracker-key.ts`,
`client/src/types.ts`, and tracker serialization tests.

## WHY THIS APPROACH

There are already two card response maps and a private tracker vocabulary
serializer. A small route-layer vocabulary serializer and batched hydration
remove the concrete duplication while keeping the two table owners separate.

## SANDWICH CONTEXT

[CRITICAL: JSON is additive camelCase; reuse `formatKey`/`derivePrefix`; no
status writes, tracker key resolution, row multiplication, or tracker-router
import from card responses.]

## DELIVERABLE

GET board and GET card expose the same hydrated card contract, including
batched labels and slotted status. Tracker vocabulary responses remain
compatible.

## QUALITY BAR

- Shared serializer is used by tracker and card paths.
- Integration coverage proves labels are batched and cards are not duplicated.
- Null key/taxonomy semantics are explicit.
- TDD, `.js` imports, and conventional commit.

## STOP CONDITIONS

Escalate if hydration requires resolving tracker items by board key or if a
solution imports the entire tracker router instead of the shared serializer.
