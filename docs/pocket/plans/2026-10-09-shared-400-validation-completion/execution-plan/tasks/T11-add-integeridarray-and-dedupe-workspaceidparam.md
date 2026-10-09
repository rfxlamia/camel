# Task T11 — Add integerIdArray and dedupe workspaceIdParam

**Phase:** 4
**Depends:** T10
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 11: Add integerIdArray and dedupe workspaceIdParam [depends: T10]

## OBJECTIVE
In `server/src/validators/schemas.ts` add `integerIdArray(field)` — a zod schema for "array whose every element passes `Number.isInteger`", failing with `"<field> must be an array of integers"` for non-arrays AND bad elements (including `null`). Use `.refine(Number.isInteger)` on elements, NOT `z.number().int()` (zod v4 `.int()` is safe-integer-only; behavior must match today's `Number.isInteger` loop). Also redefine `workspaceIdParam` as `positiveIdParam(WORKSPACE_ID_MESSAGE)` so digit/safe/positive logic lives once. No caller changes in this task.

Steps:
1. Write failing test for: integerIdArray + workspaceIdParam equivalence
   Test file: `server/src/validators/schemas.test.ts` (modify)
   Level: unit
   Test intent: Given `integerIdArray("labelIds")`, When parsed with [], [1,2], [1,1] Then ok and data unchanged (no dedupe); When parsed with null, "1,2", {}, [1,"x"], [1.5], [null], Then fails with error `labelIds must be an array of integers`; When parsed with undefined Then fails (absence is handled by callers via key presence, as today). Given `workspaceIdParam`, When parsed with "1", "01" Then ok 1; "0", "-1", "1e2", "", " 1", "abc", "9007199254740993" Then error `workspaceId must be an integer` (pins the post-refactor equivalence).
   Exercise through: `parseWith` from `validators/http.ts`
   Test doubles: none
   Expected RED: `integerIdArray` is not exported
2. Run test — verify FAIL: `npm run test --workspace=server -- src/validators/schemas.test.ts`
3. Implement; run the same command — verify PASS; run `npm run test --workspace=server -- src/modules/settings` — verify PASS (consumers of workspaceIdParam unchanged). Commit: `feat(server): add integerIdArray schema and dedupe workspace id param`

## REFERENCES LOADED
Spec — Rules 4 and 5, Design Decision (zod `integerIdArray`); `server/src/validators/schemas.ts`; `server/src/lib/tracker-item-parsers.ts:62-120` (current array loops and messages).

## WHY THIS APPROACH
Complexity: lightweight
Justification: two small schema definitions with table-driven tests; no caller changes.

## SANDWICH CONTEXT
[CRITICAL: integerIdArray must accept/reject exactly what the current parseLabelIds/parseAssigneeIds loops do — `Array.isArray` plus `Number.isInteger` per element, no dedupe, no new rules]
You are implementing the shared schema for #198 PR-4.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: zod `integerIdArray` in validators/schemas.ts consumed by parsers.
Files in scope: server/src/validators/schemas.ts, server/src/validators/schemas.test.ts
Available after: T10
Architecture rule: validators/ is kernel; no imports from modules/ or lib/.
[RESTATE: Same acceptance as today's loops; no new validation rules (no duplicate rejection)]

## DELIVERABLE
Given [1,2], When parsed, Then ok
Given [1,"x"] or null or "1,2", When parsed, Then error "<field> must be an array of integers"
Given [1,1], When parsed, Then ok with duplicates preserved
Given workspaceIdParam after the refactor, When tested with the table above, Then results are unchanged from before the refactor

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Existing workspaceIdParam tests still pass untouched
Must-not-have:
  - `z.number().int()` for elements; duplicate rejection; changes to callers
Open question risks:
  - zod v4 refine API → mirror `positiveIdParam` in the same file
Rollback note:
  - Revert the commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: element refine semantic differs for large floats
Escalate when: equivalence with the current loop cannot be shown by test
