# Task T12 — Extract tracker reference parsers and use integerIdArray

**Phase:** 4
**Depends:** T11
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 12: Extract tracker reference parsers and use integerIdArray [depends: T11]

## OBJECTIVE
`server/src/lib/tracker-item-parsers.ts` is 373 lines and is being touched, so extract (300-on-touch). Move EXACTLY `parsePriorityId` (line 34), `parseLabelIds` (line 62) and `parseAssigneeIds` (line 93) — current lines 34-129, none of which use `lookupProject`/`lookupPhase` — into new `server/src/lib/tracker-reference-parsers.ts` (barrel drops to ~277 lines; both files <=300). Re-export them from `tracker-item-parsers.ts` so `parseProjectPhase`, `parseDateRange`, `parseAssigneeIds` and `parseLabelIds` (and every other current export) stay importable from that exact path (`tracker-items.write.test.ts` mocks it by path). Then rewrite the array check inside `parseLabelIds`/`parseAssigneeIds` to use `integerIdArray` via `parseWith`. Messages unchanged: `labelIds must be an array of integers`, `assigneeIds must be an array of integers`, `label must belong to this workspace`, `assignee must be a member of this workspace`.

Steps:
1. Write characterization test for: parser behavior and re-export surface (extend the EXISTING test file)
   Test file: `server/src/lib/tracker-item-parsers.test.ts` (modify; it already mocks `../db/kysely.js` and has `parsePriorityId`/`parseLabelIds` cases that stay; extend its import list with `parseAssigneeIds`)
   Level: unit (kysely `db` chain mocked as the file already does)
   Test intent: Given the existing `db` mock, When `parseLabelIds({ labelIds: null }, 1)` / `{ labelIds: "1,2" }` / `{ labelIds: [1,"x"] }` / `{}` Then each returns `{ error: "labelIds must be an array of integers" }` and no DB call happened; Given `parseAssigneeIds` with the same four inputs Then `{ error: "assigneeIds must be an array of integers" }`; Given valid assignee ids and a mocked miss Then `{ error: "assignee must be a member of this workspace" }`; Given `[]` for either Then `[]` with no DB calls. Also pin the barrel's full export surface: `Object.keys(await import("./tracker-item-parsers.js"))` equals today's set (record it first; expected today: `parsePriorityId`, `parseLabelIds`, `parseAssigneeIds`, `parseProjectPhase`, `parseCardProjectPhase`, `parseDateRange`), each a defined function.
   Exercise through: the exports of `./tracker-item-parsers.js`
   Test doubles: the existing kysely `db` mock; do NOT mock the parsers
   Expected RED: characterization — passes on current code by design. Prove live: change one expected message, see FAIL, restore.
2. Run baseline — verify PASS: `npm run test --workspace=server -- src/lib/tracker-item-parsers.test.ts`
3. Extract (pure move, same commit includes the extended test file): `refactor(server): extract tracker reference parsers`. Run `npm run test --workspace=server -- src/lib src/modules/tracker src/modules/board`, `wc -l server/src/lib/tracker-item-parsers.ts server/src/lib/tracker-reference-parsers.ts` (both <=300) and `npm run typecheck --workspace=server` — verify PASS; then switch the array check to `integerIdArray` (commit `refactor(server): use integerIdArray in reference parsers`) and re-run the same commands — verify PASS.

## REFERENCES LOADED
Spec — Rule 4, AC "Parsers still exported from lib/tracker-item-parsers", "300-on-touch"; `server/src/lib/tracker-item-parsers.ts`, `tracker-item-parsers.test.ts`; `server/src/modules/tracker/tracker-items.write.test.ts` (path mock); `server/src/lib/work-item-create-metadata.ts`, `board/card-update-parse.ts`, `tracker/tracker-item-update-parse.ts` (importers).

## WHY THIS APPROACH
Complexity: standard
Justification: a mock-by-path constraint plus a size budget plus a schema swap; extraction and rewiring are separate commits.

## SANDWICH CONTEXT
[CRITICAL: Every current export of `lib/tracker-item-parsers.ts` must stay importable from that exact path (tests mock it); behavior and messages must not change]
You are implementing the parser extraction for #198 PR-4.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: integerIdArray consumed by parseLabelIds/parseAssigneeIds; extraction by domain, not utils.
Files in scope: server/src/lib/tracker-item-parsers.ts, server/src/lib/tracker-reference-parsers.ts, server/src/lib/tracker-item-parsers.test.ts
Available after: T11
Architecture rule: `.js` import extensions; extracted file named by responsibility; both files <=300 lines.
[RESTATE: The barrel keeps its full export surface with unchanged behavior]

## DELIVERABLE
Given non-array / null / non-integer element input, When parseLabelIds or parseAssigneeIds runs, Then `{ error: "<field> must be an array of integers" }` and no DB call
Given `[]`, When parsed, Then `[]` without DB calls
Given the module `tracker-item-parsers`, When imported, Then its export keys equal the pinned set and the file is <=300 lines
Given `tracker-items.write.test.ts`, When run, Then it passes unmodified

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Extraction commit and rewire commit are separate
  - Existing board/tracker tests pass unmodified
Must-not-have:
  - Changing parser messages or return shapes
  - Adding dedupe or rejecting duplicates
  - Removing exports from `tracker-item-parsers.ts`
  - Moving `lookupProject`/`lookupPhase`/`parseProjectPhase` (they stay)
Open question risks:
  - Line numbers drifted since planning → re-derive the three functions by name; if the barrel is still >300 lines after moving them, report DONE_WITH_CONCERNS with the measured counts
Rollback note:
  - Revert the two commits independently
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: `tracker-items.write.test.ts` mock stops intercepting after the move
Escalate when: an importer needs a different import path
