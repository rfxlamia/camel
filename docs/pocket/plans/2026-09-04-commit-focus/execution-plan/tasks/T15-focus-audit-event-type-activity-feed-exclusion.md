# Task T15 — Focus audit event type + activity feed exclusion

**Phase:** 2
**Depends:** T3
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 15: Focus audit event type + activity feed exclusion [depends: T3]

## OBJECTIVE

Give focus-session audit rows their own `card_events.event_type` and exclude them from the workspace activity feed, so that T4, T5, T6, and T14 can satisfy the repository's "every mutation calls `recordActivity()`" rule without spraying empty rows through every member's activity list.

Files:
- Modify: `server/src/routes/helpers.ts`
- Modify: `server/src/routes/activity.ts`
- Test: `server/src/routes/activity.focus-exclusion.integration.test.ts`

**Why this exists.** `recordActivity`'s `eventType` parameter is a closed union — `"create" | "update" | "move" | "reorder" | "delete" | "linear_ticket_created"` (`server/src/routes/helpers.ts:499`) — with no focus member, so the focus tasks would otherwise be forced onto `"update"`. And `activitySelect()` in `server/src/routes/activity.ts` filters on `workspace_id` alone, with no `event_type` predicate. A focus row logged as `"update"` with `card_id: null` therefore renders in **every** workspace member's feed as `{ type: "update", cardId: null, cardTitle: null, fromColumn: null, toColumn: null }` — four or more such rows per focus session, for a feature the spec calls *personal*. A distinct event type is both the correct label and the thing the feed can filter on.

Scope note: `card_events.event_type` is a plain `TEXT` column with a default and **no CHECK constraint** (`schema.sql:60`), so adding a union member is a TypeScript-only change — no migration, no `focus_events` table. Issue #107 stays deferred.

Scope note: `getUnifiedWorkspaceActivity` (`server/src/routes/work-item-events.ts:275`) already carries `AND e.card_id IS NOT NULL`, so focus rows are excluded there by construction. `GET /cards/:id/activity` filters by `card_id` and is likewise unaffected. `GET /activity` is the only leak, and the only query this task changes.

Steps:

1. Write failing test for: `Given a focus_session event in the workspace, When GET /activity, Then it is not in the feed`
   Test file: `server/src/routes/activity.focus-exclusion.integration.test.ts`
   Level: integration (real PostgreSQL)

   Test intent:
   Given an isolated fixture — a dedicated user, workspace, column, and card — with two seeded `card_events` rows for that workspace: one `event_type: "move"` bound to the card, and one `event_type: "focus_session"` with `card_id: null` and a `{ kind: "focus_session", action: "start" }` payload
   When `GET /workspaces/<id>/activity` is requested by that member
   Then the response `events` array has exactly one entry and it is the `"move"` row — the focus row is absent

   This is an integration test rather than a unit test **on purpose**. The assertion is about a SQL predicate, and the `chainable()` helper in `work-items.test.ts` only stubs `where`/`select`/`orderBy` terminating on `executeTakeFirst`. `activitySelect()` builds `selectFrom` + four `leftJoin`s and this route terminates on `.execute()` after `.limit()`, so that helper cannot express the query at all — and a fake that only records `where` calls cannot distinguish a SQL predicate from a JavaScript `.filter()`, which is the exact distinction this task exists to enforce.

   Fixture boundary: seed and clean up only the dedicated user, workspace, column, card, and `card_events` rows, following `server/src/routes/work-item-member-concurrency.integration.test.ts`; do not rely on pre-existing rows or hard-coded generated ids.

   Exercise through:
   - HTTP `GET` against the real `activityRouter`, via `supertest`, with an app builder that sets **both** `req.user` and `req.workspace` (`work-items.test.ts`'s builder sets only the latter, and `requireWorkspaceMember` reads `req.user!.id`)

   Test doubles: none; gate the file with `describe.skipIf(!process.env.RUN_INTEGRATION)` so the default suite collects but skips it without a database

   Expected RED:
   - `activitySelect()` has no `event_type` predicate, so `events` contains both rows

2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/activity.focus-exclusion.integration.test.ts` (needs `make db-up && make db-migrate`)
   Expected failure: `expected 2 to be 1` — the focus row is in the feed.

3. Implement minimal code to satisfy the test:
   File: `server/src/routes/helpers.ts` — add `"focus_session"` to `recordActivity`'s `eventType` union. Change nothing else in that function; the insert already accepts a null `card_id` (`schema.sql:64`) and a null `to_column_id` (`schema.sql:62`).
   File: `server/src/routes/activity.ts` — add `.where("e.event_type", "<>", "focus_session")` to the `GET /activity` query, before the `limit`.

4. Run test — verify PASS: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/activity.focus-exclusion.integration.test.ts`

5. Write a separate failing test for: `Given only focus_session events exist, When GET /activity, Then the feed is empty rather than a page of blanks`
   Test file: `server/src/routes/activity.focus-exclusion.integration.test.ts`
   Level: integration (real PostgreSQL)

   Test intent:
   Given the same isolated fixture seeded with three `"focus_session"` rows and no other events for that workspace
   When `GET /workspaces/<id>/activity` is requested
   Then the response is `200 { events: [] }` — this is the user-visible symptom the task exists to prevent, and it must hold independently of the mixed-row case above.

   Exercise through: HTTP `GET` against the real router
   Test doubles: none; same `RUN_INTEGRATION` gate and isolated fixture cleanup
   Expected RED: three blank-looking events come back.

6. Run test — verify FAIL for this case, then PASS once the predicate from Step 3 covers it: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/activity.focus-exclusion.integration.test.ts`

   Both cases live in one file and the second is independent of the first, so run the whole file rather than a `-t` filter. If a filter is ever needed, use an unquoted regex with `.` for spaces — `-t "multi word"` loses its quotes to npm and can exit 0 having run nothing.

7. Register and verify:
   - Confirm `getUnifiedWorkspaceActivity` needs no change — read `server/src/routes/work-item-events.ts` and verify the board branch still carries `AND e.card_id IS NOT NULL`. If that predicate has been removed, add the same `event_type` exclusion there and say so in the completion report.
   - Run `npm run test --workspace=server`, `npm run typecheck --workspace=server`, and `make check` — this task edits `helpers.ts`, which the `check:mutation-routing` guard scans. The guard targets work-item mutation call sites rather than `recordActivity`'s signature, so it is expected to stay green; if it does not, stop and report rather than editing the guard.

8. Commit:
   `git add server/src/routes/helpers.ts server/src/routes/activity.ts server/src/routes/activity.focus-exclusion.integration.test.ts`
   `git commit -m "feat(focus): add focus_session audit event type and exclude it from the activity feed"`

## REFERENCES LOADED

- `server/src/routes/helpers.ts:499` — `recordActivity` and its closed `eventType` union
- `server/src/routes/activity.ts` — `activitySelect()`, the workspace-only predicate, and `toActivityEvent`
- `server/src/routes/work-item-events.ts:242` — `getUnifiedWorkspaceActivity`, already excluding null `card_id`
- `server/src/db/schema.sql:59-66` — `card_events.event_type` is TEXT with no CHECK; `card_id` and `to_column_id` are nullable
- `server/src/routes/work-items.test.ts` — the `express()` + `supertest` + `vi.mock` route-test harness
- `docs/pocket/plans/2026-09-04-commit-focus/execution-plan.md` — "Focus lifecycle audit while `focus_events` is deferred"

## WHY THIS APPROACH

Complexity: simple
Justification: two one-line production changes in two files. It is a separate task rather than a footnote in T4 because it touches `helpers.ts` and `activity.ts`, both explicitly outside T4-T6's declared file scope, and because T4, T5, T6, and T14 all depend on the event type existing before they can log anything correctly.

## SANDWICH CONTEXT

[CRITICAL: the exclusion belongs in the SQL `where`, not in a `.filter()` over the returned rows. `GET /activity` applies `limit` (default 50, max 200) in the database — filtering afterwards would let a run of focus events consume the page and silently hide real activity.]

You are adding a dedicated audit event type for Commit Focus (personal focus mode) and keeping it out of the shared activity feed.
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: focus mutations are audited through the existing `card_events` table under their own `event_type`; the dedicated `focus_events` table remains deferred to issue #107.
Files in scope: `server/src/routes/helpers.ts`, `server/src/routes/activity.ts`, `server/src/routes/activity.focus-exclusion.integration.test.ts` — no other files.
Test framework: Vitest, node environment, `supertest`, real PostgreSQL behind `RUN_INTEGRATION`. Single file: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/activity.focus-exclusion.integration.test.ts` (needs `make db-up && make db-migrate`).
Available after: T3 (`FOCUS_MODE_ENABLED`). Nothing in this task reads the flag — the feed exclusion is unconditional, so a rollback that flips the flag off leaves no orphaned rows visible.
Architecture rule: NodeNext ESM — relative imports carry `.js`. No schema change, no migration, no `focus_events` table. Do not alter the shape of `recordActivity`'s parameters; only its `eventType` union gains a member.

[RESTATE: SQL predicate, not a JavaScript filter — `limit` is applied in the database.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a workspace with both card events and focus events, When `GET /activity`, Then only the card events are returned
Given a workspace whose only events are focus events, When `GET /activity`, Then the response is `200 { events: [] }`
Given `recordActivity(db, actor, workspaceId, "focus_session", { cardId: null, payload })`, When it is called, Then it typechecks and inserts a row
[must-not] Given the exclusion, When it is implemented, Then it must NOT be a `.filter()` over the query result — the `limit` is applied in SQL
[must-not] Given this task, When it is implemented, Then it must NOT add a `focus_events` table, a migration, or any change to `recordActivity`'s parameter list beyond the union member
[derived] Given `GET /activity/unified` and `GET /cards/:id/activity`, When focus rows exist, Then both already exclude them and need no change

All tests PASS. Commit exists with message matching `feat(focus): add focus_session audit event type and exclude it from the activity feed`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- The exclusion is a SQL `where` on `e.event_type`, applied before `limit`, and proven against a real database rather than a recording fake
- `"focus_session"` is added to the union and nothing else in `recordActivity` changes
- Tests written BEFORE implementation (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- A `focus_events` table or any schema/migration change
- A JavaScript-side filter over the returned rows
- Any change to `getUnifiedWorkspaceActivity` unless Step 7 finds its `card_id IS NOT NULL` predicate gone
- Widening the union with anything other than `"focus_session"`

Open question risks:
- Assumption: focus sessions never belong in the shared workspace feed. If the product later wants "Ana focused on CA-42" as a visible activity line, this exclusion is the single place to revisit, and the row is already persisted with the identifiers it would need.

Rollback note:
- Purely additive. Reverting the `activity.ts` predicate restores the previous (leaky) behavior; reverting the union member is a typecheck-only change. Neither touches stored data.

Red flags:
- Work outside the three listed files → DONE_WITH_CONCERNS
- A schema change → STOP
- Filtering after the query instead of inside it → STOP

## STOP CONDITIONS

Done when: both DELIVERABLE feed scenarios pass under `RUN_INTEGRATION=1`, and `npm run test --workspace=server`, `npm run typecheck --workspace=server`, and `make check` are green; commit created
Uncertain when: the product wants focus activity visible in the shared feed after all
Escalate when: satisfying the exclusion appears to require a schema change or un-deferring `focus_events` (#107)
