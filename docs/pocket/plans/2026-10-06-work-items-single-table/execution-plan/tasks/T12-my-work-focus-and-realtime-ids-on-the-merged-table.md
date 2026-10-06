# Task T12 — My-work, focus and realtime ids on the merged table

**Phase:** 4
**Depends:** T9, T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 12: My-work, focus and realtime ids on the merged table [depends: T9, T5]

## OBJECTIVE
Move my-work (list, detail, hydration, mark-done tracker branch), focus lookups and SSE payloads to the merged table with new ids.

Steps:
1. Write failing test for: "My Work lists merged items without duplicates"
   Test file: `server/src/modules/my-work/my-work.merged.integration.test.ts`
   Level: integration
   Test intent: Given a user assigned to board cards and column-less items / When My Work list and detail load / Then each item appears once, `source` is derived from `column_id`, labels and assignees hydrate from the merged junctions, and the shadow-dedup `NOT EXISTS` over tracker tables is gone
   Exercise through: `my-work-data-source-list.ts:107-163`, `-detail.ts:34-47`, `my-work-response-hydration.ts:38,161,269-276`
   Test doubles: none
   Expected RED: queries still reference tracker tables
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/my-work/my-work.merged.integration.test.ts`
3. Rewrite those sites and the tracker branch of `core/my-work-mark-done.ts:113`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(my-work): read assigned items from the merged table"`.
4. Write failing test for: "Focus sessions and SSE carry the new id"
   Test file: same
   Level: integration
   Test intent: Given a migrated focus session with `task_source='tracker'` / When it is loaded (`focus-session-repo.ts:226-262`, `focus-session-inputs.ts:9-13,31,48-49`) and a Tracker item is updated / Then `findTask('tracker', id)` resolves via `cards` where `column_id IS NULL`, `buildReturnPath` still returns `/tracker/<key>`, and the SSE payload (`realtime/types.ts:53`, `my-work-router.ts:252`) carries the new numeric id as `trackerItemId`
   Exercise through: repo functions and the my-work router publisher
   Test doubles: stub the Redis/SSE publisher with the existing fake used by realtime tests
   Expected RED: lookup queries `tracker_items`
5. Run test — verify FAIL (same command). Rewrite. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "refactor(focus): resolve tracker tasks from the merged table"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 1 (focus), Story 3 (forced reload), Appendix B.4; Appendix C (id-only references; client files compare `trackerItemId`)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: several read paths and an id contract used by six client files; must not require client edits.

## SANDWICH CONTEXT
[CRITICAL: The server must emit the NEW ids everywhere (API, SSE, focus); the client is not edited and must keep working.]
You are implementing my-work/focus/realtime moves for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: the my-work, focus, realtime-type files above, core/my-work-mark-done.ts (tracker branch), test file
Available after: T9, T5
Architecture rule: no Redis/SSE topology change
[RESTATE: New ids everywhere; client unchanged.]

## DELIVERABLE
Given merged items, When My Work loads, Then each once with correct source
Given a migrated focus session and an item update, Then lookups and SSE use new ids and the return path is unchanged

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `my-work` URLs still use identity (workspace, source, key)
Must-not-have:
  - Client edits beyond typecheck; board branch changes (T5)
Open question risks:
  - Query shapes in my-work and the scheduler were not fully inspected → NEEDS_CONTEXT
Rollback note:
  - Revert PR (ships at cutover).
Red flags:
  - Client file modified → STOP

## STOP CONDITIONS
Done when: both scenarios pass and existing my-work/focus tests adapted
Uncertain when: the SSE fake cannot assert payload ids
Escalate when: the client needs a code change
