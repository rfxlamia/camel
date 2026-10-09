# Task T13 — Share the lock-reference extractor and pin create rejection

**Phase:** 4
**Depends:** T11
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 13: Share the lock-reference extractor and pin create rejection [depends: T11] [test-risk]

## OBJECTIVE
Finding F1: create paths already reject non-integer `assigneeIds`/`labelIds` (via `validateTaskCreateMetadata` → `parseLabelIds`/`parseAssigneeIds`); the two local `integerIds` copies only extract references for the pre-lock step. Replace both copies — `server/src/modules/board/card-create-validation.ts:23` and the inline arrow in `server/src/modules/tracker/tracker-item-create.ts:31` — with one named helper `extractIntegerIds(value: unknown): number[]` in new `server/src/lib/integer-ids.ts` (lenient by design: non-array → `[]`, non-integers dropped; it is NOT a validator). Pin that the final create response is still 400 with `fieldErrors`.

Steps:
1. Write characterization pins FIRST, against the UNMODIFIED code (create rejection)
   Test file: `server/src/modules/board/cards-create-metadata.integration.test.ts` and `server/src/modules/tracker/tracker-item-create-metadata.integration.test.ts` (modify: add cases)
   Level: integration (real DB, supertest — same harness as the existing cases in those files)
   Test intent: Given a workspace member and a valid column, When creating a card (and separately a tracker item) with `assigneeIds: [1, "x"]`, then `labelIds: [1.5]`, then `labelIds: null`, then `assigneeIds: "1,2"` Then status 400, `fieldErrors.assigneeIds` / `fieldErrors.labelIds` equal `"<field> must be an array of integers"`, and no card/tracker row, no `card_events`/`tracker_events` row was written; Given `assigneeIds: []` and `labelIds: []` and both absent Then 201.
   Exercise through: `POST /api/workspaces/:id/cards` and the tracker item create endpoint, as the neighboring tests do
   Test doubles: none — real DB; do NOT mock `validateTaskCreateMetadata` or the parsers (the scenario is the collaboration)
   Expected RED: characterization — passes on current code by design (F1). Liveness proof: temporarily weaken the VALIDATION path (e.g. skip the `labelIds`/`assigneeIds` branch in `validateTaskCreateMetadata`) and confirm the 400 / "no row, no event" assertions FAIL, then restore.
2. Write characterization pins FIRST, against the UNMODIFIED code (update rejection; spec scenario "Update unchanged")
   Test file: `server/src/modules/board/cards-taxonomy.integration.test.ts` and `server/src/modules/tracker/tracker-items.integration.test.ts` (modify: add cases next to the existing labelIds PATCH cases; there is no existing PATCH `assigneeIds` case, so add one)
   Level: integration (real DB, supertest)
   Test intent: Given an existing card (and tracker item) with a known version, When PATCH with `labelIds: [1.5]`, then `labelIds: null`, then `assigneeIds: [1, "x"]` Then 400 with the SAME message the update path returns today (`labelIds must be an array of integers` / `assigneeIds must be an array of integers`; read the observed body from the baseline run and pin it with `toEqual`) and the row's `version` and labels/assignees are unchanged.
   Exercise through: the PATCH endpoints used by the neighboring cases in those files
   Test doubles: none — real DB; do NOT mock `parseLabelIds`/`parseAssigneeIds`
   Expected RED: characterization — passes on current code by design. Liveness proof: weaken the validation path in `parseLabelIds` (e.g. accept non-integers) and confirm the PATCH assertions FAIL, then restore.
3. Run the pins on the unmodified code (needs the Postgres from `make db-up`/CI). These suites use `describe.skipIf(!process.env.RUN_INTEGRATION)`: WITHOUT `RUN_INTEGRATION=1` they are skipped and "pass" vacuously — confirm the skipped count is 0. The `primary` CI job does not run them, only `db-integration` does, so the swap in Step 6 is proven in that job. Verify PASS: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/board/cards-create-metadata.integration.test.ts src/modules/tracker/tracker-item-create-metadata.integration.test.ts src/modules/board/cards-taxonomy.integration.test.ts src/modules/tracker/tracker-items.integration.test.ts`. Commit: `test(server): pin create and update rejection of non-integer reference ids`
4. Write failing test for: the extractor
   Test file: `server/src/lib/integer-ids.test.ts` (new)
   Level: unit
   Test intent: Given `extractIntegerIds`, When called with [1,"x",2.5,3], null, "1,2", undefined, {} , [] Then returns [1,3], [], [], [], [], [] respectively; the header comment states it is NOT validation.
   Exercise through: the exported function
   Test doubles: none
   Expected RED: `./integer-ids.js` does not exist
5. Run test — verify FAIL: `npm run test --workspace=server -- src/lib/integer-ids.test.ts`
6. Create the helper, replace both local copies, then re-run Step 3's command AND the Step 5 command — verify PASS (the pins from Steps 1–2 now prove the swap is behavior-identical). Commit: `refactor(server): share lock-reference id extractor`

> Test **intent** only — never test source code.

## REFERENCES LOADED
Spec — finding F1, Rule 3 (amended), scenarios "Board create rejects non-integer assigneeIds (already true; pin it)", "Absent and empty arrays stay valid"; `server/src/lib/work-item-create-metadata.ts:105-150`, `board/card-create-validation.ts`, `tracker/tracker-item-create.ts`, `board/cards-create-metadata.integration.test.ts:255` (existing 400 pin).

## WHY THIS APPROACH
Complexity: standard
Justification: de-duplication is simple, but the pinning tests cross create handler → lock step → metadata validation → DB and need a real DB to prove nothing is persisted.

## SANDWICH CONTEXT
[CRITICAL: Create must keep rejecting non-integer reference ids with 400 + fieldErrors and persist nothing; the extractor is lenient lock-reference plumbing only — never use it to validate]
You are implementing the duplicate-removal and pinning for #198 PR-4.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: one named domain helper in lib/; validation stays in parseLabelIds/parseAssigneeIds.
Files in scope: server/src/lib/integer-ids.ts, server/src/lib/integer-ids.test.ts, server/src/modules/board/card-create-validation.ts, server/src/modules/tracker/tracker-item-create.ts, the four integration test files (create-metadata x2, cards-taxonomy, tracker-items)
Available after: T11
Architecture rule: `.js` import extensions; new files <=300 lines; board and tracker must not import each other.
[RESTATE: Create still returns 400 with fieldErrors for bad ids and persists nothing]

## DELIVERABLE
Given `[1,"x",2.5,3]`, When extracted, Then `[1,3]`
Given create with `[1,"x"]` assigneeIds, When posted (card and tracker), Then 400 with `fieldErrors.assigneeIds` and zero rows/events written
Given absent or `[]` ids, When posted, Then 201
Given PATCH with `labelIds: [1.5]` / `null` / `assigneeIds: [1,"x"]`, When sent, Then 400 with the unchanged message and the row untouched
Given grep of `server/src` non-test files, When searching `integerIds`, Then no local copies remain

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Integration cases use real DB and assert zero persisted rows and events
  - Single extractor used by both create paths
Must-not-have:
  - Changing create status codes or messages
  - Using the extractor as validation
Open question risks:
  - No local DB available → report NEEDS_CONTEXT for the integration step; unit steps still complete
Rollback note:
  - Revert the extractor commit and the test commit independently
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: existing integration fixtures cannot express a tracker-item create with ids
Escalate when: the DB harness is unavailable and integration cannot run
