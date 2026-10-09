# EXECUTION PLAN — Commit Focus (Personal Focus Mode)

**Date:** 2026-09-04
**Spec:** docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md
**Status:** draft
**Total tasks:** 15

---

## Execution Overview

### Phases

Phase boundaries are derived from the dependency graph by `pocketto-pi structure`, not chosen by hand. Executing phase by phase means a review checkpoint at each boundary.

| Phase | Tasks | Ships |
|-------|-------|-------|
| **1 — Foundation** | T1, T2, T3 | `focus_sessions` schema, the timer state machine, the feature flag. Nothing user-visible. |
| **2 — Lifecycle API** | T4, T5, T6 | The complete focus session API over HTTP: read, focus, start/pause/resume/finish, atomic switch. Exercisable with `curl`. No UI. |
| **3 — Client session model + revocation** | T7, T14, T8, T11, T12 | The session provider (fetch, actions, 409 recovery, cross-tab SSE sync), server-side membership finalization, the three new SSE fan-out seams, the timer component, the nav indicator, and the workspace-switch guard. Nothing renders yet — with no entry point, no session can exist, so the indicator stays hidden and the guard never fires. |
| **4 — Surface + live guards** | T9, T13, T10 | `/focus`, the live auto-finish guards, and the entry buttons. Feature complete and usable. |

The feature is user-reachable only at the end of Phase 4: `/focus` (T9) and the entry points (T10) land together there, and the Phase 3 nav indicator and switch guard stay dormant until a session can be created. Stopping after Phase 2 leaves a tested, inert API behind a flag that defaults off; stopping after Phase 3 adds tested client code that nothing yet mounts. Neither leaves a half-working surface in front of users.

### Recommended Order

```
T1, T2, T3 (parallel) → T4 → T5 → T6 → T7,T14 (parallel)
                                      → T8,T11,T12 (parallel)
                                      → T9,T13 (parallel) → T10
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups

| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T1, T2, T3 | nothing (all prereq) |
| Group B | T8, T11, T12 | T7 completes |
| Group C | T9, T14 | T8 and T6 respectively |
| Group D | T10, T13 | T9 and T12 + T14 respectively |

T14 is sequenced after T6 because it consumes the transaction-bound repository and server mutation/audit contract; it has no client dependency. T13 is sequenced after T12 and T14 even though T12 does not write `FocusSessionContext.tsx`: T7 owns that file, T12 only consumes the parent hydration/active-session flags, and T13 waits so those flags are already wired before live guards land. T14 remains the server-contract dependency for access loss.

### Constraints Reminder

**Architecture:**
- Server is NodeNext ESM — every relative import MUST carry a `.js` extension, including imports of `.ts` files.
- Client uses bundler resolution — imports carry NO extension.
- No cross-table FK from `focus_sessions.task_id` to `cards` or `tracker_items`. The reference is logical, resolved through `task_source`. ADR #103 (`docs/pocket/adr/2026-09-board-tracker-dual-table.md`) forbids resolving a work item by `key_number` alone.
- Task field edits from the focus surface MUST route through `client/src/lib/workItemMutations.ts` — never `api.updateTrackerItem` or `api.updateCard` directly.
- Optimistic locking: `version` on `focus_sessions`; stale write returns HTTP 409, never 500.
- Non-member access returns **404** (matches `requireWorkspaceMember` convention), never 403.

**Out-of-scope — no task may touch:**
- Workspace `settings` / `workspace_settings` tables for personal focus state.
- Admin-only settings endpoints.
- Dual-table merge or any change to `cards` / `tracker_items` columns.
- Shared/workspace-wide focus visible to other members.
- Session history or productivity analytics UI.
- "Finish focus → auto Done" on the task.
- Board layout redesign beyond entry-point actions and the focus route.
- Calendar, notification reminders, agent pipeline integration.
- Status, labels, assignees, due date, activity, checklist, comments, attachments on the focus surface (v1 is title + description + timer/controls only).

**Assumptions at risk:**
- **Focus lifecycle audit while `focus_events` is deferred.** The spec prefers a dedicated `focus_events` table, and v1 deliberately defers that table to [issue #107](https://github.com/rfxlamia/camel/issues/107). The repository rule still requires every mutation to be audited, so focus mutations write a `card_events` row under **their own event type**: `recordActivity(executor, actor, workspaceId, "focus_session", { cardId: null, payload: { kind: "focus_session", action, sessionId, workspaceId, userId } })`.

  `"focus_session"` is not in `recordActivity`'s union today, and `activitySelect()` in `server/src/routes/activity.ts` filters on `workspace_id` alone — so a focus row logged as `"update"` would render in **every** member's activity feed as a blank entry (`cardId: null`, `cardTitle: null`), several times per session, for a feature the spec calls *personal*. **T15** adds the union member and the feed exclusion before T4 starts. `card_events.event_type` is TEXT with no CHECK constraint, so this is a TypeScript-only change — no migration.

  T4, T5, T6, and T14 inject the audit seam as a **narrow domain type**, not `typeof recordActivity`:

  ```ts
  type RecordFocusActivity = (input: {
    actor: AuthUser;
    workspaceId: number;
    sessionId: number;
    action: "focus" | "switch" | "start" | "pause" | "resume" | "finish" | "auto_finish" | "membership_removed";
  }) => Promise<void>;
  ```

  The raw five-argument helper would force a Kysely executor into every handler, contradicting "Kysely appears only in the repo". The `db`-bound default lives in one place in `focus-session.ts`; T14 binds its own to the removal `trx` instead, since that call runs inside the transaction. These tasks assert the namespaced row and must not write `cards` or `tracker_items`. The dedicated `focus_events` persistence boundary remains the follow-up.
- **Packet completeness.** Every RED block below is an independent GWT test cycle. Each block names its Test file, Level, Test intent, Exercise through, Test doubles, Expected RED, and its own Run test → implementation → PASS sequence. If one implementation satisfies multiple assertions, the assertions remain separate test cases/cycles rather than being combined into one RED.
- **`FOCUS_MODE_ENABLED` defaults to `"false"`**, matching `OAUTH_ENABLED` and `EMAIL_GATE_ENABLED` in `server/src/config.ts`. Every test that exercises focus behavior sets it explicitly.
- **Logout while Running:** session persists as-is; time accrues until Pause/Finish. Spec-accepted for v1.
- **Session rows are retained after Finish** (`finished_at` set, row kept).

**Sequencing:** Dependency order shown is recommended only — pocket enforces actual blocking rules. Do not treat `[depends: TN]` as a hard lock unless the task cannot logically proceed without the prerequisite's output.

---

## Shared Contract (pinned here, restated in every packet that touches it)

Every task below is written against these exact shapes. A task that invents its own shape is a plan violation.

**States:** `"ready" | "running" | "paused" | "finished"`
**Actions:** `"focus" | "switch" | "start" | "pause" | "resume" | "finish"`

**`return_path` — exact strings, no variants:**
- board card: `/board/card/<cardId>` (e.g. `/board/card/481`)
- tracker item: `/tracker/<key>` (e.g. `/tracker/CA-42`)

`<key>` is `formatKey(derivePrefix(workspace.name), keyNumber)` from `server/src/core/tracker-key.ts` — it is **not** a stored column. `derivePrefix` yields **1-2 characters** and `parseKeyFromUrl` enforces `/^([A-Z?]{1,2})-(\d+)$/`, so a 3-character example like `CAM-42` cannot be produced and would 404 on the client's `tracker/:key` route. Use 2-character keys in every fixture. Board cards may carry `key_number NULL`, so `taskKey` is nullable for `source: "board"` — their return path uses the card id and never needs a key.

**Wire DTO `FocusSession` (camelCase JSON, server serializes from the snake_case row):**

```json
{
  "id": 12,
  "workspaceId": 3,
  "userId": 7,
  "source": "board",
  "taskId": 481,
  "taskKey": "CA-42",
  "returnPath": "/board/card/481",
  "state": "running",
  "accumulatedSeconds": 600,
  "runningSince": "2026-09-04T10:00:00.000Z",
  "version": 4,
  "createdAt": "2026-09-04T09:50:00.000Z",
  "updatedAt": "2026-09-04T10:00:00.000Z",
  "finishedAt": null
}
```

**Endpoint responses:**
- `GET  /api/workspaces/:workspaceId/focus-session` → `200 { session: FocusSession | null, autoFinished?: { reason: "task_missing", taskKey: string | null } }`
- `POST /api/workspaces/:workspaceId/focus-session` → `201 { session: FocusSession }` (actions `focus`, `switch`)
- `PATCH /api/workspaces/:workspaceId/focus-session` → `200 { session: FocusSession }` (actions `start`, `pause`, `resume`, `finish`)
- Stale `version` → `409 { code: "version_conflict", session: FocusSession }`
- Non-member, or `FOCUS_MODE_ENABLED=false` → `404 { error: "Not found" }`
- `GET /api/focus/config` → `200 { enabled: boolean }`

**SSE event on the workspace stream:**

```json
{ "type": "focus_session.updated", "userId": 7, "workspaceId": 3,
  "payload": { "session": { "...FocusSession..." } } }
```

`payload.session` is `null` when the session finished. The event is broadcast workspace-wide; **the client MUST filter on `userId === currentUser.id`** — this is the only thing keeping one member's focus state private from another's.

**After a successful `finish()` the client's `session` is `null`, not a finished session.** The server responds `200 { session: <state: "finished"> }` so the caller can read `returnPath` off it, but the provider stores `null` — a finished session is not an active one, and T9's return navigation and T11's indicator both key on `session === null`. The acting tab and every other tab must agree.

**Existing task events — the real shapes, which are NOT uniform.** The focus guards and the focus-surface refresh consume events this feature does not author, and their ids arrive under different top-level field names. Card events always add a server-generated `payload`; tracker events do not. Verified in the server:

| Event | Payload | Source |
|---|---|---|
| `card.updated` / `card.deleted` | `{ type, actor, cardId, payload: { key } }` (the `payload` may be `{}` if the card key cannot be hydrated) | `server/src/routes/cards.ts` ~L131–147, ~L568, ~L674 |
| `tracker.updated` / `tracker.deleted` | `{ type, actor, trackerItemId }` | `server/src/routes/tracker-items.ts` ~L625–629, ~L1100–1104 |
| `membership.removed` | `{ type, userId, workspaceId, workspaceName }` | `server/src/routes/helpers.ts` ~L260–266 |

So a focus guard resolves the id **per source**: `source: "board"` reads `event.cardId`, `source: "tracker"` reads `event.trackerItemId`. Any test fixture for these events must use these exact shapes — a fabricated `{ payload: { taskId } }` passes against a stub while matching nothing in production. Membership fixtures must include `userId`, `workspaceId`, and `workspaceName`, because `BoardContext` checks all three before its existing redirect logic runs.

Note what this does *not* buy: because the two field names already differ, an implementation that keys only on field name would pass a naive id-collision test. The ADR #103 rule still has to be proven deliberately — see T13.

**Clock seam — decided at plan time, do not improvise:**
- `server/src/core/focus-session.ts` takes `now: Date` as an explicit parameter. It NEVER calls `Date.now()` or `new Date()` internally.
- `server/src/routes/focus-session.ts` is built by a factory `createFocusSessionRouter({ repo, now, publish, recordFocusActivity })` — mirroring `createScopedBoardService` / `createWorkspaceAccessService` in `server/src/routes/helpers.ts`. It takes a `FocusSessionRepo`, never a raw `db`: Kysely stays inside `focus-session-repo.ts`. `now` defaults to `() => new Date()`; tests inject a fixed clock. `publish` is `publishEvent`, whose real signature is `publishEvent(workspaceId, event)` — two arguments. Both the `FOCUS_MODE_ENABLED` gate and `requireWorkspaceMember` are mounted router-level (`router.use(...)`) so every verb is covered by construction.
- `client/src/components/FocusTimer.tsx` is tested with `vi.useFakeTimers()` + `vi.setSystemTime()`.

**Dead-task ownership — decided at plan time:** `GET /focus-session` resolves the referenced task server-side. If the task is soft-deleted or no longer accessible, the server auto-finishes the session and returns `{ session: null, autoFinished: { reason: "task_missing", taskKey } }`. The client does **not** own recovery for the load path; T13 handles only live task SSE events, while T14 closes the membership-removal path for users who are offline.

---

## File Structure Map

```
Rule: Focus audit + feed hygiene
  Modify: server/src/routes/helpers.ts                      (T15 — "focus_session" event type; T14 — membership finalizer)
  Modify: server/src/routes/activity.ts                     (T15 — exclude focus rows from GET /activity)
  Test:   server/src/routes/activity.focus-exclusion.test.ts (created by: T15)

Rule: Focus entry
  Modify: server/src/db/schema.sql                          (T1)
  Modify: server/src/db/types.ts                            (T1)
  Test:   server/src/db/focus-session-schema.test.ts        (created by: T1)
  Create: server/src/routes/focus-session.ts                (created by: T4)
  Create: server/src/routes/focus-session-repo.ts           (created by: T4)
  Modify: server/src/routes.ts                              (T3, T4)
  Test:   server/src/routes/focus-session.test.ts           (created by: T4)
  Create: client/src/components/FocusEntryButton.tsx        (created by: T10)
  Modify: client/src/components/ContextPanel.tsx            (T10)
  Modify: client/src/pages/TrackerDetailPage.tsx            (T10)
  Test:   client/src/components/FocusEntryButton.test.tsx   (created by: T10)
  Create: client/src/pages/FocusPage.tsx                    (created by: T9)
  Modify: client/src/App.tsx                                (T7, T9)
  Test:   client/src/pages/FocusPage.test.tsx               (created by: T9)

Rule: Lifecycle
  Create: server/src/core/focus-session.ts                  (created by: T2)
  Test:   server/src/core/focus-session.test.ts             (created by: T2)
  Modify: server/src/routes/focus-session.ts                (T5)
  Test:   server/src/routes/focus-session.lifecycle.test.ts (created by: T5)
  Create: server/src/routes/focus-session-serialize.ts      (conditional, T5 — only if focus-session.ts approaches ~300 lines)
  Test:   server/src/routes/focus-session.lifecycle.test.ts (covers conditional serializer, T5)
  Create: client/src/components/FocusTimer.tsx              (created by: T8)
  Test:   client/src/components/FocusTimer.test.tsx         (created by: T8)
  Create: client/src/lib/focusDuration.ts                   (conditional, T8 — only if the formatter is extracted)
  Test:   client/src/lib/focusDuration.test.ts              (conditional, T8 — created with focusDuration.ts)

Rule: Concurrency
  Modify: server/src/routes/focus-session.ts                (T5)
  Modify: server/src/realtime.ts                            (T4)
  Create: client/src/context/FocusSessionContext.tsx        (created by: T7)
  Modify: client/src/context/BoardContext.tsx               (T3, T7, T12)
  Test:   client/src/context/FocusSessionContext.test.tsx         (created by: T7)
  Test:   client/src/context/BoardContext.focusSeams.test.tsx (created by: T7)

Rule: Switch task
  Modify: server/src/routes/focus-session.ts                (T6)
  Modify: server/src/routes/focus-session-repo.ts           (T6)
  Test:   server/src/routes/focus-session.switch.test.ts    (created by: T6)
  Test:   server/src/routes/focus-session.switch.integration.test.ts (created by: T6, RUN_INTEGRATION-gated)
  Create: server/src/routes/focus-session-inputs.ts         (conditional, T6 — only if focus-session.ts crosses ~300 lines)
  Test:   server/src/routes/focus-session.switch.test.ts    (covers conditional inputs, T6)
  Modify: client/src/components/FocusEntryButton.tsx        (T10)
  Create: client/src/components/FocusSwitchDialog.tsx       (conditional, T10 — only if the dialog grows past a simple confirm)

Rule: Guards
  Modify: client/src/lib/workspaceSwitcher.ts               (T12)
  Modify: client/src/context/BoardContext.tsx               (T12)
  Test:   client/src/lib/workspaceSwitcher.test.ts          (T12, exists)
  Modify: client/src/layout/sidebar/WorkspaceSwitcher.tsx   (T12)
  Test:   client/src/layout/sidebar/WorkspaceSwitcher.test.tsx (created by: T12)
  Modify: client/src/context/FocusSessionContext.tsx        (T7, T13)
  Test:   client/src/context/BoardContext.focusGuard.test.tsx (created by: T12)
  Test:   client/src/context/FocusSessionContext.guards.test.tsx  (created by: T13)
  Create: client/src/lib/focusGuards.ts                     (conditional, T13 — only if FocusSessionContext.tsx crosses ~300 lines)
  Test:   client/src/lib/focusGuards.test.ts                (conditional, T13 — created with focusGuards.ts)

Rule: Work context
  Modify: client/src/pages/FocusPage.tsx                    (T9)
  Test:   client/src/pages/FocusPage.test.tsx               (T9)
  Create: client/src/components/FocusTaskContent.tsx        (conditional, T9 — only if FocusPage.tsx crosses ~300 lines)
  Test:   client/src/pages/FocusPage.test.tsx               (covers conditional task-content extraction, T9)

Feature flag (cross-cutting, no AC rule of its own — enables the Rollback Plan)
  Modify: server/src/config.ts                              (T3)
  Create: server/src/routes/focus-config.ts                 (created by: T3)
  Test:   server/src/routes/focus-config.test.ts            (created by: T3)
  Modify: client/src/api.ts                                 (T3, T7)
  Modify: client/src/context/BoardContext.tsx               (T3)
  Test:   client/src/context/BoardContext.focusFlag.test.tsx (created by: T3)

Rule: Membership revocation finalization
  Modify: server/src/routes/helpers.ts                  (T14; event type added by T15)
  Modify: server/src/routes/focus-session-repo.ts       (T14)
  Create: server/src/routes/focus-session-membership.ts (created by: T14)
  Test:   server/src/routes/focus-session-membership.test.ts (created by: T14)
  Test:   server/src/routes/workspaceAccess.test.ts       (extended by: T14)
  Test:   server/src/routes/members.focus-session.integration.test.ts (created by: T14, RUN_INTEGRATION-gated)

Global re-entry
  Create: client/src/layout/FocusIndicator.tsx              (created by: T11)
  Modify: client/src/layout/AppLayout.tsx                   (T11)
  Test:   client/src/layout/FocusIndicator.test.tsx         (created by: T11)

Shared types
  Modify: client/src/types.ts                               (T7)
```

**Modified-file discipline.** `BoardContext.tsx` (742 lines), `ContextPanel.tsx` (653), `TrackerDetailPage.tsx` (666), and `App.tsx` are all already large. No task in this plan may add focus *logic* to them. Each new behavior lives in a new file (`FocusSessionContext.tsx`, `FocusEntryButton.tsx`, `FocusIndicator.tsx`, `FocusTimer.tsx`, `FocusPage.tsx`); the large file only mounts it and gains a handful of lines. Extracting unrelated existing code out of these files is out of scope for this plan.

**Single-file ownership of `server/src/routes/focus-session.ts`.** T4 creates it, T5 and T6 extend it — strictly in sequence, never in parallel. Each of the three writes its own test file so the suites stay independent.

**Single-file ownership of `client/src/context/FocusSessionContext.tsx`.** T7 creates it and owns the provider state, including `focusSessionHydrated` and `hasActiveFocusSession` setters exposed to `BoardContext`; T12 consumes those fields to implement the switch guard and must not redefine their ownership or edit this file; T13 adds the live auto-finish guards. `T13 [depends: T12, T14]` waits for T12's flag wiring (not a second write to this file) and for T14's server-side membership-finalization contract. T7 and T13 are the only writers; they never run concurrently. Each writes its own test file.

**Single-file ownership of `client/src/context/BoardContext.tsx`.** T3 adds the feature flag, T7 adds all three new SSE fan-out seams, T12 adds the switch guard — in that order, never concurrently. No other task may modify it.

**The three new fan-out seams are T7 deliverables, not discoveries.** `BoardContext` fans out `tracker.*` today and nothing else: every `card.*` event falls through to the debounced board refresh with no subscriber notified, and `membership.removed` is handled inline with a redirect and fans out to nobody. T9 (refresh the focus surface on a board-card update) and T13 (auto-finish on `card.deleted` and on access loss) need `subscribeCardEvents` and `subscribeMembershipEvents`, and neither task is permitted to add them. T7 delivers all three — `subscribeFocusEvents`, `subscribeCardEvents`, `subscribeMembershipEvents` — upstream of both.

## Pocket Packets

---

### Task 1: `focus_sessions` schema + Kysely types [prereq]

## OBJECTIVE

Add the `focus_sessions` table to `server/src/db/schema.sql` and its Kysely type to `server/src/db/types.ts`, so that a personal focus session is persistable with a database-enforced "at most one active session per (user, workspace)" guarantee.

Files:
- Modify: `server/src/db/schema.sql`
- Modify: `server/src/db/types.ts`
- Test: `server/src/db/focus-session-schema.test.ts`

The DDL is verified by asserting against the **text of `schema.sql`**, exactly as `server/src/db/board-tracker-unify-migration.test.ts` does. This needs no running database. Read that file before writing the test — it is the pattern.

Steps:

1. Write failing test for: `focus_sessions` table declares the personal-session columns and constraints
   Test file: `server/src/db/focus-session-schema.test.ts`
   Level: unit

   Test intent:
   Given `schema.sql` read as a string
   When the `focus_sessions` DDL is inspected
   Then:
   - a `CREATE TABLE IF NOT EXISTS focus_sessions` block exists
   - `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
   - `task_source TEXT NOT NULL` with `CHECK (task_source IN ('board','tracker'))`
   - `task_id INTEGER NOT NULL` **with no `REFERENCES` clause** — the task link is logical (ADR #103), never a cross-table FK
   - `task_key TEXT` (nullable)
   - `return_path TEXT NOT NULL`
   - `state TEXT NOT NULL` with `CHECK (state IN ('ready','running','paused','finished'))`
   - `accumulated_seconds INTEGER NOT NULL DEFAULT 0` with `CHECK (accumulated_seconds >= 0)`
   - `running_since TIMESTAMPTZ` (nullable)
   - `version INTEGER NOT NULL DEFAULT 1`
   - `created_at` / `updated_at` `TIMESTAMPTZ NOT NULL DEFAULT now()`, `finished_at TIMESTAMPTZ` nullable
   - a table-level `CHECK` binding the two together: `running_since` is non-null exactly when `state = 'running'`

   Exercise through:
   - the file contents of `server/src/db/schema.sql` (read with `readFileSync(new URL("./schema.sql", import.meta.url), "utf8")`)

   Test doubles:
   - none — this reads a real file
   - do NOT mock: `node:fs`

   Expected RED:
   - `schema.sql` contains no `focus_sessions` DDL, so the first `expect(schemaSql).toMatch(...)` fails

2. Run test — verify FAIL: `npm run test -- server/src/db/focus-session-schema.test.ts`
   Expected failure: `AssertionError: expected '...' to match /CREATE TABLE IF NOT EXISTS focus_sessions/`

3. Implement minimal code to satisfy the test:
   File: `server/src/db/schema.sql`
   Implement: append a `-- Commit Focus: personal focus sessions` section at the end of the file with the `CREATE TABLE IF NOT EXISTS focus_sessions (...)` block. Follow the two-space-indented column style of `tracker_items`. `id SERIAL PRIMARY KEY`. Idempotent DDL only (`IF NOT EXISTS`) — `migrate()` re-runs the whole file on every `make db-migrate`.

4. Run test — verify PASS: `npm run test -- server/src/db/focus-session-schema.test.ts`
   Expected: PASS

5. Write failing test for: at most one non-finished session per (user, workspace)
   Test file: `server/src/db/focus-session-schema.test.ts`
   Level: unit

   Test intent:
   Given `schema.sql` read as a string
   When the focus session indexes are inspected
   Then:
   - a `CREATE UNIQUE INDEX IF NOT EXISTS` on `focus_sessions (user_id, workspace_id)` exists
   - it carries a `WHERE state <> 'finished'` partial predicate — so finished rows are retained and do not block a new session
   - a non-unique lookup index on `(user_id, workspace_id, finished_at)` exists for session history reads

   Exercise through:
   - the file contents of `server/src/db/schema.sql`

   Test doubles:
   - none

   Expected RED:
   - no unique index on `focus_sessions` exists yet

6. Run test — verify FAIL: `npm run test -- server/src/db/focus-session-schema.test.ts`
   Expected failure: assertion on the unique-index regex fails

7. Implement, then verify PASS: add both indexes below the table block. Run `npm run test -- server/src/db/focus-session-schema.test.ts` — expected PASS.

8. Write failing test for: Kysely `DB` registry exposes `focus_sessions`
   Test file: `server/src/db/focus-session-schema.test.ts`
   Level: unit

   Test intent:
   Given `server/src/db/types.ts` read as a string
   When the type registry is inspected
   Then:
   - an exported `interface FocusSessions` exists
   - it declares `id: Generated<number>`, `version: Generated<number>`, `accumulated_seconds: Generated<number>`, `created_at: Generated<Timestamp>`, `updated_at: Generated<Timestamp>`
   - it declares `running_since: Timestamp | null` and `finished_at: Timestamp | null`
   - the `DB` interface maps `focus_sessions: FocusSessions`

   Exercise through:
   - the file contents of `server/src/db/types.ts`, mirroring how `board-tracker-unify-migration.test.ts` asserts on `typesTs`

   Test doubles:
   - none

   Expected RED:
   - `types.ts` has no `FocusSessions` interface

9. Run test — verify FAIL: `npm run test -- server/src/db/focus-session-schema.test.ts`

10. Implement `FocusSessions` in `server/src/db/types.ts` (alphabetical field order, matching the file's existing style) and register it on `DB`. Verify PASS with the same command, then confirm the whole server suite is green: `npm run test`.

11. Refactor while green (bounded):
    - Rule of three: no logic is introduced here; nothing to extract
    - Only `schema.sql` and `types.ts` may be touched
    - Re-run `npm run test -- server/src/db/focus-session-schema.test.ts` — must stay PASS

12. Commit:
    `git add server/src/db/schema.sql server/src/db/types.ts server/src/db/focus-session-schema.test.ts`
    `git commit -m "feat(focus): add focus_sessions schema and Kysely types"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Focus entry (session persisted with `{source, id}`); Design Decision → "Proposed technical shape" table row `Schema`
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — why `task_id` gets no cross-table FK and why `key_number` alone must never identify a task
- `server/src/db/schema.sql` — `tracker_items` block is the column-style and partial-index precedent (`idx_tracker_items_workspace_active`)
- `server/src/db/board-tracker-unify-migration.test.ts` — the regex-over-`schema.sql` test pattern this task reuses
- `server/src/db/types.ts` — `TrackerItems` shows the `Generated<T>` / `Timestamp | null` convention
- `server/src/db/migrate.ts` — confirms `schema.sql` is re-executed wholesale, so all DDL must be idempotent

## WHY THIS APPROACH

Complexity: lightweight
Justification: two files, no branching logic, and the verification pattern already exists in the repo. The only judgment call — logical vs. real FK — is settled by ADR #103.

## SANDWICH CONTEXT

[CRITICAL: `focus_sessions.task_id` must have NO `REFERENCES` clause. The board/tracker dual-table shim (ADR #103) means a task id is only meaningful together with `task_source`; a real FK to either table is unrepresentable and would have to be ripped out.]

You are implementing the `focus_sessions` schema for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — dedicated `/focus` surface backed by a server-persisted `focus_sessions` table with optimistic locking.
Files in scope: `server/src/db/schema.sql`, `server/src/db/types.ts`, `server/src/db/focus-session-schema.test.ts` — no other files.
Test framework: Vitest, node environment. Single file: `npm run test -- server/src/db/focus-session-schema.test.ts`.
Available after: none (prereq).
Architecture rule: all DDL in `schema.sql` is re-executed on every migration — it MUST be idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Do not add a `focus_events` table; it is deferred to issue #107.

[RESTATE: `focus_sessions.task_id` must have NO `REFERENCES` clause — the task link is logical, discriminated by `task_source`, per ADR #103.]

## DELIVERABLE

Verification — task is DONE when all pass:

[derived] Given `schema.sql`, When the `focus_sessions` DDL is read, Then it declares `user_id`, `workspace_id`, `task_source`, `task_id`, `task_key`, `return_path`, `state`, `accumulated_seconds`, `running_since`, `version`, `created_at`, `updated_at`, `finished_at` with the constraints listed in Step 1
[derived] Given `schema.sql`, When the focus indexes are read, Then a unique index on `(user_id, workspace_id) WHERE state <> 'finished'` exists
[derived] Given `types.ts`, When the registry is read, Then `FocusSessions` is exported and mapped on `DB.focus_sessions`
[must-not] Given the `focus_sessions` DDL, When `task_id` is inspected, Then it must NOT carry a `REFERENCES cards(...)` or `REFERENCES tracker_items(...)` clause
[must-not] Given the `focus_sessions` DDL, When the unique index predicate is inspected, Then it must NOT be unconditional — finished sessions must remain insertable alongside a new active one

All tests PASS. Commit exists with message matching `feat(focus): add focus_sessions schema and Kysely types`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Partial unique index enforces single active session per `(user_id, workspace_id)` at the database level, not in application code
- All DDL idempotent — safe to run twice
- Tests written BEFORE the DDL (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- A `focus_events` table (deferred — issue #107)
- Any change to `cards`, `tracker_items`, `settings`, or `workspace_settings`
- A cross-table foreign key on `task_id`
- `focus_events` table in the schema task; audit wiring belongs to the mutation tasks and is validated there

Open question risks:
- Session rows are assumed retained after Finish (`finished_at` set, row kept). If retention turns out to be unwanted, the partial index predicate changes → report NEEDS_CONTEXT before altering it.

Rollback note:
- Rollback plan drops `focus_sessions` only after confirming no active sessions in production. Nothing here touches task data, so a drop is safe in isolation.

Red flags:
- Work outside `schema.sql`, `types.ts`, and the new test file → DONE_WITH_CONCERNS
- Adding a `REFERENCES` clause to `task_id` → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE assertions pass, `npm run test` is green, commit created
Uncertain when: the retention assumption (keep finished rows) proves wrong
Escalate when: satisfying the schema appears to require a change to `cards` or `tracker_items`, or a cross-table FK

---

### Task 2: Focus session domain core — state machine + active-time math [prereq]

## OBJECTIVE

Create the pure domain module that owns focus session state transitions and active-time accounting. This is the single source of truth for "how much active time has this session accrued" and "is this transition legal" — T4 and T5 both import it rather than reimplementing the math in route handlers.

Files:
- Create: `server/src/core/focus-session.ts`
- Test: `server/src/core/focus-session.test.ts`

The module exports, at minimum:
- `type FocusSessionState = "ready" | "running" | "paused" | "finished"`
- `type FocusAction = "start" | "pause" | "resume" | "finish"`
- `type FocusSnapshot = { state: FocusSessionState; accumulatedSeconds: number; runningSince: Date | null }`
- `elapsedSeconds(snapshot: FocusSnapshot, now: Date): number`
- `applyAction(snapshot: FocusSnapshot, action: FocusAction, now: Date): FocusSnapshot`
- an error type for illegal transitions (e.g. `InvalidFocusTransitionError extends Error`), following the `WipLimitExceededError` shape in `.claude/rules/error-handling.md`

**`now` is always an explicit parameter.** This module must never call `Date.now()` or `new Date()`. That is what makes the "waits 10 active minutes" scenarios testable without fake timers.

Steps:

1. Write failing test for: `Given Ready, When Start, Then Running with runningSince set`
   Test file: `server/src/core/focus-session.test.ts`
   Level: unit

   Test intent:
   Independent RED case A: Given a Ready snapshot and fixed base time `T0`, When `applyAction(snapshot, "start", T0)`, Then state is `"running"`, `runningSince` equals `T0`, and `accumulatedSeconds` remains `0`. The pause/accrual case is a separate cycle below.

   Exercise through:
   - the exported `applyAction` function

   Test doubles:
   - none — `now` is passed in as a plain `Date`
   - do NOT mock: the clock, `applyAction`, or `elapsedSeconds`

   Expected RED:
   - `server/src/core/focus-session.ts` does not exist — the import fails to resolve

2. Run test — verify FAIL: `npm run test -- server/src/core/focus-session.test.ts`
   Expected failure: `Failed to resolve import "./focus-session.js"`

3. Implement minimal code to satisfy RED case A:
   File: `server/src/core/focus-session.ts`
   Implement: the types above plus `applyAction` handling `start` and `pause` only. Accumulate with `Math.round((now.getTime() - runningSince.getTime()) / 1000)`.

4. Run test — verify PASS: `npm run test -- server/src/core/focus-session.test.ts`

5. Write a separate failing test for: `Given Running 0s, When Pause after 10m, Then Paused 600s`
   Test file: `server/src/core/focus-session.test.ts`
   Level: unit

   Test intent:
   Independent RED case B: Given a Running snapshot with `runningSince: T0` and zero accumulated seconds, When `applyAction(s, "pause", T0 + 600s)`, Then state is `"paused"`, `runningSince` is `null`, and `accumulatedSeconds` is `600`. Resume accrual is a separate cycle below.

   Exercise through: `applyAction`
   Test doubles: none
   Expected RED: `pause` is not yet a handled action — `applyAction` throws or returns the snapshot unchanged

6. Run test — verify FAIL, implement `pause`, then verify PASS: `npm run test -- server/src/core/focus-session.test.ts`

7. Write a separate failing test for: `Given Paused 600s, When Resume 5m then Pause, Then ~900s`
   Test file: `server/src/core/focus-session.test.ts`
   Level: unit

   Test intent:
   Independent RED case C: Given a Paused snapshot with `accumulatedSeconds: 600`, When `applyAction(s, "resume", T0)` then `applyAction(result, "pause", T0 + 300s)`, Then resume sets Running without accruing and the second action ends Paused at `900` seconds.

   Exercise through: `applyAction`
   Test doubles: none
   Expected RED: `resume` is not yet a handled action.

8. Run test — verify FAIL, implement `resume`, then verify PASS: `npm run test -- server/src/core/focus-session.test.ts`

7a. Write a separate failing test for: `Given Running, When read mid-flight, Then duration = accumulated + time since runningSince`
    Test file: `server/src/core/focus-session.test.ts`
    Level: unit

    Test intent:
    Independent RED case D: Given Running with `accumulatedSeconds: 1200` and `runningSince: T0`, When `elapsedSeconds(snapshot, T0 + 90s)`, Then it returns `1290`. Use separate test cases for Paused (returns `1200`) and Ready (returns `0`) so neither is hidden in the Running GWT.

    Exercise through: `elapsedSeconds`
    Test doubles: none
    Expected RED: `elapsedSeconds` is not exported yet.

8a. Run test — verify FAIL, implement `elapsedSeconds`, then verify PASS: `npm run test -- server/src/core/focus-session.test.ts`

9. Write a separate failing test for: `Given Running, When Finish, Then session closes with accrued time`
   Test file: `server/src/core/focus-session.test.ts`
   Level: unit

   Test intent:
   Independent RED case E: Given Running with `accumulatedSeconds: 300` and `runningSince: T0`, When `applyAction(s, "finish", T0 + 120s)`, Then state is `"finished"`, `runningSince` is `null`, and `accumulatedSeconds` is `420`. Paused and Ready finish behavior is covered by separate test cases in the same file.

   Exercise through: `applyAction`
   Test doubles: none
   Expected RED: `finish` is not a handled action

10. Run test — verify FAIL, implement Running `finish`, then verify PASS: `npm run test -- server/src/core/focus-session.test.ts`

10a. Write, run, and pass separate RED→implementation→PASS cases for finishing Paused without accrual and finishing Ready at zero. Keep these cases independent from the Running finish case.
    Test file: `server/src/core/focus-session.test.ts`
    Level: unit
    Exercise through: `applyAction`, with one independent test case for Paused and one for Ready
    Test doubles: none
    Expected RED: the new `finish` branch does not yet handle each non-running state.

11. Write independent failing test cases for: each illegal transition is rejected
    Test file: `server/src/core/focus-session.test.ts`
    Level: unit

   Test intent:
   Each row below is its own GWT test case with its own RED assertion and PASS assertion: Given the listed state, When the listed illegal action is applied, Then `applyAction` throws `InvalidFocusTransitionError` and the input snapshot is not mutated. Cover at least: `start` from `running`; `start` from `paused` (must use `resume`); `resume` from `ready`; `resume` from `running`; `pause` from `ready`; `pause` from `paused`; and each action from `finished`. A table-driven implementation is fine, but it must preserve one independently reported test case per row.

    Exercise through: `applyAction`
    Test doubles: none
    Expected RED: illegal transitions currently fall through and return a snapshot instead of throwing

12. Run test — verify FAIL for every illegal-transition case, implement the transition table + error, then verify PASS for every case: `npm run test -- server/src/core/focus-session.test.ts`

13. Refactor while green (bounded):
    - Rule of three: if the "accrue in-flight seconds" computation appears in `pause`, `finish`, and `elapsedSeconds`, extract one private helper inside this module — do NOT create a generic `utils.ts`
    - This file must stay well under ~300 lines and every exported function under ~50
    - Refactor only within `server/src/core/focus-session.ts`
    - Re-run `npm run test -- server/src/core/focus-session.test.ts` — must stay PASS

14. Commit:
    `git add server/src/core/focus-session.ts server/src/core/focus-session.test.ts`
    `git commit -m "feat(focus): add focus session state machine and active-time math"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Lifecycle, all five GWT scenarios under "Story: Session lifecycle" (Rule 1 active time only, Rule 2 finish preserves task status)
- `server/src/core/position.ts` + `position.test.ts` — the pure-core-module convention: no I/O, no clock, throws a typed error on an impossible input
- `server/src/core/work-item-debt.ts` — kebab-case file naming used throughout `server/src/core/`
- `.claude/rules/error-handling.md` — typed business-logic error class shape (`WipLimitExceededError`)

## WHY THIS APPROACH

Complexity: standard
Justification: one file, but it encodes a four-state machine with an accrual invariant and is the shared dependency of two later route tasks. Getting the transition table wrong here surfaces as wrong timer numbers three tasks downstream.

## SANDWICH CONTEXT

[CRITICAL: this module must never read the clock. `now: Date` is a required parameter on every function that needs a time. A single `Date.now()` inside makes the route tests in T4/T5 and the timer tests in T7 unable to assert exact durations.]

You are implementing the focus session domain core for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — server-authoritative timer stored as `accumulated_seconds` + `running_since`; active time only, pauses excluded.
Files in scope: `server/src/core/focus-session.ts`, `server/src/core/focus-session.test.ts` — no other files.
Test framework: Vitest, node environment. Single file: `npm run test -- server/src/core/focus-session.test.ts`.
Available after: none (prereq). Runs in parallel with T1 and T3.
Architecture rule: `server/src/core/` is pure — no database, no Express, no Redis, no imports from `../routes/` or `../db/`. Server is NodeNext ESM, so relative imports in the test file carry `.js` (`from "./focus-session.js"`).

[RESTATE: never call `Date.now()` or `new Date()` inside this module — `now: Date` is always passed in.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given Ready session with 0 accumulated seconds, When Start then Pause 10 minutes later, Then accumulated seconds is 600
Given Paused session with 600 accumulated seconds, When Resume then Pause 5 minutes later, Then accumulated seconds is 900
Given Running session with 1200 accumulated seconds and `runningSince` = T0, When duration is read at T0+90s, Then it is 1290
Given Running session with 300 accumulated seconds, When Finish 120s later, Then state is finished and accumulated seconds is 420
[derived] Given Paused session, When duration is read at any later time, Then it does not advance
[derived] Given Ready session, When duration is read, Then it is 0
[must-not] Given a Running session, When `start` is applied, Then the module must NOT silently restart the timer — it must throw `InvalidFocusTransitionError`
[must-not] Given a Finished session, When any action is applied, Then the module must NOT produce a new active state — it must throw

All tests PASS. Commit exists with message matching `feat(focus): add focus session state machine and active-time math`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- `now: Date` is an explicit parameter on `elapsedSeconds` and `applyAction`
- Paused time never accrues — this is the whole point of the feature's "active time only" promise
- Illegal transitions throw a typed error, not a generic `Error`
- Input snapshots are treated as immutable — `applyAction` returns a new object
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — no accrual logic duplicated 3+ times in this file
- Commit message follows conventional commits format

Must-not-have:
- Any import of `../db/`, `../routes/`, `express`, or `kysely`
- `Date.now()` / `new Date()` anywhere in the module
- The `switch` action — that is a route-level transaction concern (T5), not a snapshot transition
- Anything that changes the task's own status (Finish must not complete the task)

Open question risks:
- Assumption: logging out while Running keeps accruing time until Pause/Finish. This module encodes that by simply not knowing about sessions — if the product wants auto-pause on logout, that is a new action here → report NEEDS_CONTEXT rather than inventing one.

Rollback note:
- Pure module, no persistence. Deleting the file is a complete rollback.

Red flags:
- Work outside the two listed files → DONE_WITH_CONCERNS
- A clock read inside the module → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` is green, commit created
Uncertain when: the logout-while-Running assumption proves wrong
Escalate when: the state machine appears to need database access, or a transition cannot be expressed without knowing the task

---
### Task 3: `FOCUS_MODE_ENABLED` flag + client visibility [prereq]

## OBJECTIVE

Add the server feature flag that the Rollback Plan depends on, expose it to the client through a config endpoint, and surface it on `BoardContext` as `focusModeEnabled` — so later tasks can hide entry points when the feature is off.

This mirrors the existing ticket-intake flag end to end: `GET /api/ticket-intake/config → { enabled }` → `api.ticketIntake.getConfig()` → `ticketIntakeEnabled` on `BoardContext`. Read that path before writing anything; it is the precedent, and there is no `import.meta.env` pattern in this codebase.

Files:
- Modify: `server/src/config.ts`
- Create: `server/src/routes/focus-config.ts`
- Modify: `server/src/routes.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/context/BoardContext.tsx`
- Test: `server/src/routes/focus-config.test.ts`
- Test: `client/src/context/BoardContext.focusFlag.test.tsx`

The config endpoint lives in its own router file, separate from the lifecycle router T4 creates, so the two tasks never edit the same file.

Steps:

1. Write the first independent failing test for: config endpoint reports enabled=true
   Test file: `server/src/routes/focus-config.test.ts`
   Level: unit

   Test intent:
   Independent RED case A: Given `FOCUS_MODE_ENABLED=true`, When an authenticated user requests `GET /focus/config`, Then the response is `200 { enabled: true }`. Flag-off and unauthenticated cases are separate cycles below.

   Exercise through:
   - HTTP, via `supertest` against a bare `express()` app with the router mounted — the same harness as `server/src/routes/work-items.test.ts`

   Test doubles:
   - mock `../config.js` so `config.FOCUS_MODE_ENABLED` can be flipped per test
   - mock `../auth.js` `requireAuth` to a pass-through, as `work-items.test.ts` mocks `requireWorkspaceMember`
   - do NOT mock: the router itself

   Expected RED:
   - `server/src/routes/focus-config.ts` does not exist — import fails to resolve

2. Run test — verify FAIL for case A only: `npm run test -- server/src/routes/focus-config.test.ts -t "enabled true"`
   Expected failure: `Failed to resolve import "./focus-config.js"`

3. Implement the enabled-true path: add `FOCUS_MODE_ENABLED: z.enum(["true", "false"]).default("false")` to `envSchema` in `server/src/config.ts` beside `EMAIL_GATE_ENABLED`; create `server/src/routes/focus-config.ts` exporting `focusConfigRouter` with `GET /focus/config` returning `{ enabled: config.FOCUS_MODE_ENABLED === "true" }`, guarded by `requireAuth`. Model it on `ticketIntakeRouter.get("/ticket-intake/config", ...)` in `server/src/routes/ticket-intake.ts`.

4. Run test — verify PASS for case A only: `npm run test -- server/src/routes/focus-config.test.ts -t "enabled true"`

4a. Write/run a separate RED→implementation→PASS cycle for enabled=false: Given `FOCUS_MODE_ENABLED=false`, When the same authenticated request is made, Then the response is `200 { enabled: false }`.
    Test file: `server/src/routes/focus-config.test.ts`
    Level: unit
    Exercise through: `supertest` against the same mounted router
    Test doubles: flag-off `../config.js` mock, pass-through `requireAuth`
    Expected RED: the handler always returns `{ enabled: true }` or omits the false branch.
    Run FAIL then PASS: `npm run test -- server/src/routes/focus-config.test.ts -t "enabled false"`

4b. Write/run a separate RED→implementation→PASS cycle for unauthenticated access: Given an unauthenticated request, When `GET /focus/config` is made, Then auth rejects it while workspace membership is not required.
    Test file: `server/src/routes/focus-config.test.ts`
    Level: unit
    Exercise through: `supertest` against the same router with `requireAuth` stubbed to 401
    Test doubles: 401 `requireAuth` stub; do not mount `requireWorkspaceMember`
    Expected RED: the route is unguarded and returns 200, or it incorrectly requires workspace membership.
    Run FAIL then PASS: `npm run test -- server/src/routes/focus-config.test.ts -t "unauthenticated"`
    Do not combine the flag-value assertions with the auth assertion.

5. Register the router: in `server/src/routes.ts`, import `focusConfigRouter` from `./routes/focus-config.js` and mount it with `api.use(focusConfigRouter)` alongside the other top-level (non-workspace-scoped) routers. Verify nothing regressed: `npm run test`.

6. Write the first independent failing test for: client exposes `focusModeEnabled` default false while pending
   Test file: `client/src/context/BoardContext.focusFlag.test.tsx`
   Level: unit (component/hook, jsdom)

   Test intent:
   Independent RED case A: Given the config request is pending, When the provider mounts, Then `focusModeEnabled` is `false`. Enabled-true settle and rejection degrade are separate cycles below.

   Exercise through:
   - a probe component calling `useBoard()`, rendered inside `BoardProvider` via `@testing-library/react`

   Test doubles:
   - mock `../api` with `vi.hoisted` (the pattern in `client/src/pages/TrackerDetailPage.test.tsx`), stubbing every `api` method `BoardProvider` calls on mount
   - stub `EventSource` with a `MockEventSource` class, as `client/src/context/BoardContext.viewMode.test.tsx` does
   - do NOT mock: `BoardProvider` or `useBoard`

   Expected RED:
   - `focusModeEnabled` is not a member of the context value — the probe reads `undefined`

7. Run test — verify FAIL for case A only: `npm run test -- client/src/context/BoardContext.focusFlag.test.tsx -t "pending defaults false"`
   Expected failure: `expected undefined to be false`

8. Implement the pending default: in `client/src/api.ts` add `focus: { getConfig: () => request<{ enabled: boolean }>("/focus/config") }`, mirroring `api.ticketIntake.getConfig`. In `client/src/context/BoardContext.tsx` add `focusModeEnabled: boolean` to `BoardContextValue`, a `useState(false)`, a mount-time effect copying the ticket-intake effect verbatim in shape (`let active = true` guard, `.catch(() => setFocusModeEnabled(false))`), and the field on the provider value.

9. Run test — verify PASS for case A only: `npm run test -- client/src/context/BoardContext.focusFlag.test.tsx -t "pending defaults false"`

9a. Write/run a separate RED→implementation→PASS cycle for enabled true: Given `getConfig` resolves `{ enabled: true }`, When the provider settles, Then `focusModeEnabled` becomes `true`.
    Test file: `client/src/context/BoardContext.focusFlag.test.tsx`
    Level: unit (component/hook, jsdom)
    Exercise through: the same `useBoard()` probe after the mocked config promise resolves
    Test doubles: `vi.hoisted` `api.focus.getConfig` resolving `{ enabled: true }`; `MockEventSource`; do not mock `BoardProvider`
    Expected RED: the effect never writes `true` from the payload.
    Run FAIL then PASS: `npm run test -- client/src/context/BoardContext.focusFlag.test.tsx -t "enabled true"`

9b. Write/run a separate RED→implementation→PASS cycle for config rejection: Given `getConfig` rejects, When the provider settles, Then `focusModeEnabled` stays `false` and no error is surfaced. A missing flag endpoint degrades silently to feature off.
    Test file: `client/src/context/BoardContext.focusFlag.test.tsx`
    Level: unit (component/hook, jsdom)
    Exercise through: the same probe after the mocked config promise rejects
    Test doubles: `vi.hoisted` `api.focus.getConfig` rejecting; `MockEventSource`; do not mock `BoardProvider`
    Expected RED: the rejection surfaces as an error or leaves the field undefined.
    Run FAIL then PASS: `npm run test -- client/src/context/BoardContext.focusFlag.test.tsx -t "config reject stays false"`

10. Refactor while green (bounded):
    - Rule of three: the flag-fetch effect now exists twice (ticket intake, focus). Two is not three — do NOT extract a shared hook yet
    - `BoardContext.tsx` is already ~742 lines: this task may add only the state, the effect, and the value field. Do not extract unrelated existing code out of it — that is out of scope for this plan
    - Re-run `npm run test -- server/src/routes/focus-config.test.ts` and `npm run test -- client/src/context/BoardContext.focusFlag.test.tsx` — must stay PASS

11. Commit:
    `git add server/src/config.ts server/src/routes/focus-config.ts server/src/routes/focus-config.test.ts server/src/routes.ts client/src/api.ts client/src/context/BoardContext.tsx client/src/context/BoardContext.focusFlag.test.tsx`
    `git commit -m "feat(focus): add FOCUS_MODE_ENABLED flag and client visibility"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — Rollback Plan ("Disable `FOCUS_MODE_ENABLED` flag — hides entry points and /focus route"); Open Questions row on `FOCUS_MODE_ENABLED` client visibility
- `server/src/routes/ticket-intake.ts` (line ~217) — the `GET /<feature>/config → { enabled }` endpoint precedent
- `client/src/api.ts` (line ~805) — `api.ticketIntake.getConfig` shape
- `client/src/context/BoardContext.tsx` (lines ~182, ~201–214, ~731) — the `ticketIntakeEnabled` state + mount effect + context value wiring this task copies
- `server/src/config.ts` — `OAUTH_ENABLED` / `EMAIL_GATE_ENABLED` establish `z.enum(["true","false"]).default("false")` as the flag convention
- `client/src/context/BoardContext.viewMode.test.tsx` — `MockEventSource` stub needed to render `BoardProvider` in jsdom

## WHY THIS APPROACH

Complexity: standard
Justification: six files across both workspaces, but every one of them is a near-mechanical copy of an existing, working flag. The interpretation cost is in matching the precedent exactly rather than in novel design.

## SANDWICH CONTEXT

[CRITICAL: the flag defaults to `"false"`. Every test that exercises focus behavior — here and in T4, T5 — must set `FOCUS_MODE_ENABLED` explicitly rather than relying on the default, or it will pass for the wrong reason.]

You are implementing the `FOCUS_MODE_ENABLED` feature flag for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A, gated behind a server config flag so the Rollback Plan can hide the entire feature without a code revert.
Files in scope: `server/src/config.ts`, `server/src/routes/focus-config.ts`, `server/src/routes.ts`, `client/src/api.ts`, `client/src/context/BoardContext.tsx`, plus the two new test files — no other files.
Test framework: Vitest. Server (node): `npm run test -- server/src/routes/focus-config.test.ts`. Client (jsdom): `npm run test -- client/src/context/BoardContext.focusFlag.test.tsx`.
Available after: none (prereq). Runs in parallel with T1 and T2.
Architecture rule: server imports carry `.js` extensions (NodeNext ESM); client imports carry none. Never read `process.env` outside `config.ts`. Never use `import.meta.env` — no such pattern exists in this codebase.

[RESTATE: `FOCUS_MODE_ENABLED` defaults to `"false"` — set it explicitly in every test that depends on it.]

## DELIVERABLE

Verification — task is DONE when all pass:

[derived] Given `FOCUS_MODE_ENABLED=true`, When an authenticated user requests `GET /api/focus/config`, Then the response is `200 { enabled: true }`
[derived] Given `FOCUS_MODE_ENABLED=false`, When the same request is made, Then the response is `200 { enabled: false }`
[derived] Given `BoardProvider` mounts and `getConfig` resolves `{ enabled: true }`, When the context is read, Then `focusModeEnabled` is `true`
[derived] Given `getConfig` rejects, When the context is read, Then `focusModeEnabled` is `false`
[must-not] Given `getConfig` rejects, When the app renders, Then it must NOT surface an error toast or block rendering — an unreachable flag endpoint degrades silently to "feature off"

All tests PASS. Commit exists with message matching `feat(focus): add FOCUS_MODE_ENABLED flag and client visibility`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Flag default is `"false"`, matching `OAUTH_ENABLED` / `EMAIL_GATE_ENABLED`
- Config endpoint requires auth
- Client failure path degrades to "off", never to an error state
- Tests written BEFORE implementation (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- Any focus lifecycle logic — this task ships a flag and nothing else
- Editing `server/src/routes/focus-session.ts` (T4 owns that file)
- Adding focus logic inline to `BoardContext.tsx` beyond the flag state, its effect, and the context field
- `import.meta.env` or a direct `process.env` read outside `config.ts`

Open question risks:
- Assumption: the flag is deployment-wide, not per-workspace. If focus must be enabled per workspace, this endpoint's shape changes → report NEEDS_CONTEXT before adding a workspace param.

Rollback note:
- This task IS the rollback mechanism. Setting `FOCUS_MODE_ENABLED=false` must leave the app fully functional with no focus surface — verify that path explicitly rather than assuming it.

Red flags:
- Work outside the listed files → DONE_WITH_CONCERNS
- Focus lifecycle behavior implemented here → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run test` are green, commit created
Uncertain when: the deployment-wide vs. per-workspace assumption proves wrong
Escalate when: exposing the flag appears to require changing `/me` or the workspace read payload

---
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


---
### Task 4: Focus session route — read + create [depends: T1, T2, T3, T15]

## OBJECTIVE

Create the focus session HTTP surface for reading the current session and committing to a task: `GET` and `POST` with action `focus`. Establish the router factory, the data-access seam, the serializer, and the SSE event type that T5 and T6 then extend.

Files:
- Create: `server/src/routes/focus-session.ts`
- Create: `server/src/routes/focus-session-repo.ts`
- Modify: `server/src/routes.ts`
- Modify: `server/src/realtime.ts`
- Test: `server/src/routes/focus-session.test.ts`

**Structure — build it this way, T5 and T6 depend on it:**

`focus-session-repo.ts` exports `type FocusSessionRepo` and `createFocusSessionRepo(db)`. The interface is the only place Kysely appears:
- `findActive(userId, workspaceId): Promise<FocusSessionRow | null>` — the row where `state <> 'finished'`
- `insert(input): Promise<FocusSessionRow>`
- `update(id, patch, expectedVersion): Promise<FocusSessionRow | null>` — returns `null` when the version guard matched no row
- `findTask(source, taskId, workspaceId): Promise<{ id: number; keyNumber: number | null; title: string; workspaceName: string } | null>` — resolves a board card (`cards`, `deleted_at IS NULL`) or a tracker item (`tracker_items`, `deleted_at IS NULL`) scoped to the workspace, joining `workspaces.name` in the same query

  The display key is **not** stored. It is `formatKey(derivePrefix(workspaceName), keyNumber)` — both exported and pure from `server/src/core/tracker-key.ts`. Import them into `focus-session.ts`; do not re-derive the prefix and do not copy `getWorkspacePrefix` (it is module-private in `tracker-items.ts`). `derivePrefix` yields **1-2 characters** (`KEY_PATTERN = /^([A-Z?]{1,2})-(\d+)$/`), so every fixture in this task uses a 2-character key such as `CA-42` — a 3-character key like `CAM-42` cannot be produced and would fail `parseKeyFromUrl` on the client's `tracker/:key` route. Board cards may have `key_number NULL`; their return path uses the card id, so `task_key` is nullable for `source: "board"`.

This repo must stay logic-free — queries and row mapping only. Every decision lives in the route or in `core/focus-session.ts`, both of which are tested.

`focus-session.ts` exports `createFocusSessionRouter(deps)` plus a default `focusSessionRouter` built from the real repo:

```ts
type FocusAuditAction =
  | "focus" | "switch" | "start" | "pause" | "resume" | "finish" | "auto_finish";

type RecordFocusActivity = (input: {
  actor: AuthUser;
  workspaceId: number;
  sessionId: number;
  action: FocusAuditAction;
}) => Promise<void>;

createFocusSessionRouter(deps: {
  repo: FocusSessionRepo;
  now?: () => Date;
  publish?: typeof publishEvent;
  recordFocusActivity?: RecordFocusActivity;
})
```

The audit seam is this **narrow domain type**, not `typeof recordActivity`. The raw helper's signature is `recordActivity(dbExec, actor, workspaceId, eventType, opts)` — passing it directly would force a Kysely executor into the handler, contradicting "Kysely appears only in the repo", and its `eventType` union has no focus member. The default implementation lives in one place at the bottom of `focus-session.ts` and is the only thing that touches `db`:

```ts
const defaultRecordFocusActivity: RecordFocusActivity = ({ actor, workspaceId, sessionId, action }) =>
  recordActivity(db, actor, workspaceId, "focus_session", {
    cardId: null,
    payload: { kind: "focus_session", action, sessionId, workspaceId, userId: actor.id },
  });
```

`"focus_session"` is a real member of the `recordActivity` event-type union and is excluded from the workspace activity feed — both are delivered by **T15, which must be complete before this task starts**. Do not use `"update"`: it is indistinguishable from a card edit and would render in every member's feed. Tests construct their own router with a fake repo, a fixed clock, a publisher spy, and a `vi.fn()` audit spy — they never mock Kysely, and they assert against the narrow input object, not the five-argument helper.

Steps:

1. Write the first independent failing test for: `Given no session, When GET, Then null`
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit

   Test intent:
   Independent RED case A: Given a router built with a repo whose `findActive` resolves `null`, When `GET /workspaces/3/focus-session` is requested by a member, Then the response is `200 { session: null }`. This case has no feature-gate or membership assertion; those are separate RED cycles below.

   Exercise through:
   - HTTP, via `supertest` against `express().use("/workspaces/:workspaceId", createFocusSessionRouter({ repo: fakeRepo, now, publish }))`, following the harness in `server/src/routes/work-items.test.ts`

   **Harness gap — read before copying `work-items.test.ts`.** Its `createApp` injects `req.workspace` but never `req.user`. Every focus assertion about `userId` reads `req.user!.id`, and the real `requireWorkspaceMember` reads it too, so the suite crashes before asserting anything. The app builder in this file needs both, plus a JSON body parser for the `POST`/`PATCH` cycles:
   ```ts
   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
     req.user = { id: 7, username: "ana", display_name: "Ana" } as AuthUser;
     req.workspace = { workspaceId: 3, role: "member" };
     next();
   });
   app.use("/workspaces/:workspaceId", router);
   ```
   In production `requireAuth` is applied once on the parent `api` router (`server/src/routes.ts:42`), so the focus router never mounts it itself. `req.user` is typed `AuthUser` (`server/src/auth.js`) and is what `defaultRecordFocusActivity` forwards to `recordActivity` as its `actor` — read the real `AuthUser` shape before writing the fixture rather than casting a guess, so the seam does not typecheck in the test and fail in production.

   Test doubles:
   - fake `FocusSessionRepo` — a plain object of `vi.fn()`s
   - mock `../config.js` to flip `FOCUS_MODE_ENABLED`
   - mock `../middleware/workspace.js` `requireWorkspaceMember` as a pass-through for this member case
   - injected `publish: vi.fn()` and `now: () => FIXED_DATE`
   - do NOT mock: the router, the serializer, or `core/focus-session.ts`

   Expected RED:
   - `server/src/routes/focus-session.ts` does not exist — the import fails to resolve

2. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
   Expected failure: `Failed to resolve import "./focus-session.js"`

3. Implement minimal code to satisfy RED case A:
   File: `server/src/routes/focus-session-repo.ts` — the interface and the Kysely implementation.
   File: `server/src/routes/focus-session.ts` — the factory, a `Router({ mergeParams: true })` instance, and `GET` returning `{ session: null }`.

   **Both gates are mounted router-level, not per-route:**
   ```ts
   const router = Router({ mergeParams: true });
   router.use(requireFocusModeEnabled);   // 404 when FOCUS_MODE_ENABLED !== "true"
   router.use(requireWorkspaceMember);    // 404 for non-members
   ```
   This is load-bearing for T5 and T6, whose rollback notes both say the flag 404 is "inherited from T4's guard". A per-route gate on `GET` alone ships `POST` and `PATCH` ungated and makes the Rollback Plan's first step silently fail. Router-level `.use()` covers every verb by construction, including verbs T5 and T6 have not added yet.

4. Run test — verify PASS: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

4a. Write/run a separate RED→implementation→PASS cycle for the non-member gate: with a 404-responding `requireWorkspaceMember` stub, `GET` returns exactly `404 { error: "Not found" }`. The test uses the actual `express().use("/workspaces/:workspaceId", router)` mount and fails until the middleware is mounted on the GET route.
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit (HTTP route)
   Exercise through: `supertest` against the actual workspace parent mount
   Test doubles: 404 `requireWorkspaceMember` stub, fake repo, fixed clock, flag-on config, and publisher spy
   Expected RED: the middleware is absent from the GET route and the request reaches the handler.
   Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

4b. Write/run a separate RED→implementation→PASS cycle for the disabled-feature gate: with `FOCUS_MODE_ENABLED=false` and membership allowed, `GET` returns exactly `404 { error: "Not found" }`. Keep this as an independent test case.
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit (HTTP route)
   Exercise through: `supertest` against the same workspace parent mount
   Test doubles: pass-through membership stub, flag-off config, fake repo, fixed clock, and publisher spy
   Expected RED: the route currently returns the no-session 200 response instead of the feature-off 404.
   Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

5. Write failing test for: `Given Running session, When GET, Then state and duration restored from server`
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit

   Test intent:
   Given `findActive` resolves a row `{ state: "running", accumulated_seconds: 1200, running_since: T0, version: 4, task_source: "board", task_id: 481, task_key: "CA-42", return_path: "/board/card/481" }` and `findTask` resolves that card
   When `GET /workspaces/3/focus-session` is requested with the injected clock at `T0 + 90s`
   Then the response is `200` and `body.session` matches the Shared Contract DTO exactly: camelCase keys, `state: "running"`, `accumulatedSeconds: 1200`, `runningSince` as an ISO string, `version: 4`, `source: "board"`, `taskId: 481`, `taskKey: "CA-42"`, `returnPath: "/board/card/481"`, `finishedAt: null`

   Note: the response carries the **stored** `accumulatedSeconds` plus `runningSince`. It does not pre-compute the live total — the client derives that. This keeps one authority for the number and lets the client tick between polls.

   Exercise through: HTTP `GET`
   Test doubles: fake repo, fixed clock, `vi.fn()` publisher
   Expected RED: `GET` currently always returns `{ session: null }`

6. Run test — verify FAIL, implement the serializer + the `findActive` branch, verify PASS: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

7. Write failing test for: `Given board card C, When "Focus on this task", Then Ready session persisted with {source: "board", id: C.id}`
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit

   Test intent:
   Given no active session and `findTask` resolving the target
   When `POST /workspaces/3/focus-session` with `{ action: "focus", source: "board", taskId: 481 }`
   Then:
   - the response is `201` and `body.session.state` is `"ready"` with `accumulatedSeconds: 0`, `runningSince: null`, `version: 1`
   - `repo.insert` was called with `return_path: "/board/card/481"` and `task_key` taken from the resolved task
   - `publish` was called once as **two arguments** — `publishEvent(workspaceId, event)` is the real signature (`server/src/realtime.ts:408`), so the assertion is `expect(publish).toHaveBeenCalledWith(3, { type: "focus_session.updated", userId, workspaceId, payload: { session } })`, never a single object. `userId` must be present, because the client's privacy filter depends on it
   Exercise through: HTTP `POST`
   Test doubles: fake repo, fixed clock, `vi.fn()` publisher, and injected `recordFocusActivity()` audit spy. Do NOT mock the return-path construction — that is the behavior under test
   Expected RED: `POST` is not routed yet — 404 from Express itself, with `insert` never called

8. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
   Expected failure: `POST` is not routed and Express returns 404.

9. Implement the minimal no-active board focus branch, then verify PASS: add the `POST` route, resolve the board task by source and id, insert the Ready row, serialize it, publish the exact event shape, and call the injected `recordFocusActivity()` audit seam once with the namespaced focus payload. Assert that no card/task row is written. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts` — expected PASS for the board case.

10. Write a separate failing test for: `Given tracker item T, When "Focus on this task", Then Ready session preserves tracker identity and return path`
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit

    Test intent:
    Given no active session and `findTask` resolving tracker item `CA-42`
    When `POST /workspaces/3/focus-session` has `{ action: "focus", source: "tracker", taskId: 77 }`
    Then the response is `201`, `source` is `"tracker"`, `taskId` is `77`, and `returnPath` is `/tracker/CA-42`; `repo.insert` receives the tracker task key.

    Exercise through: HTTP `POST`
    Test doubles: fake repo, fixed clock, `vi.fn()` publisher
    Expected RED: the board-only implementation does not yet branch to the tracker task lookup.

11. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: the tracker request is rejected or resolves the wrong return path.

12. Implement the source-specific tracker branch, then verify PASS: reuse the same no-active path, branch `findTask` on `source`, and construct `/tracker/<taskKey>` without a key-number-only lookup. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts` — expected PASS.

13. Write a separate failing test for: `Given a task id that resolves in no table for this workspace, When focus is requested, Then 404 and no insert`
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit

    Test intent:
    Given no active session and `findTask` resolves `null`
    When the focus POST is requested
    Then the response is `404 { error: "Not found" }`, `repo.insert` is not called, and `publish` is not called.

    Exercise through: HTTP `POST`
    Test doubles: fake repo, fixed clock, `vi.fn()` publisher
    Expected RED: the route currently attempts to insert without a resolvable task.

14. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: the route returns success or reaches `repo.insert`.

15. Implement the missing-task 404 branch, then verify PASS: reject a null `findTask` result before building the insert. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts` — expected PASS.

16. Write a separate failing test for: `Given the user previously finished task T, When focus is requested again, Then a new Ready session starts at zero`
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit

    Test intent:
    Given `findActive` resolves `null` because the old row is finished and `findTask` resolves the same task
    When focus is requested
    Then a new row is inserted with `state: "ready"`, `accumulatedSeconds: 0`, and `version: 1`; the finished row is never revived.

    Exercise through: HTTP `POST`
    Test doubles: fake repo whose `findActive` explicitly models the partial-index query, fixed clock, `vi.fn()` publisher
    Expected RED: the finished-session path is not yet asserted and may incorrectly reuse the old row.

17. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: the new-row assertion fails or the old finished row is returned.

18. Verify the finished-row behavior PASS: keep `findActive` limited to `state <> 'finished'`, insert a fresh Ready row, and run `npm run test --workspace=server -- src/routes/focus-session.test.ts`.

19. Write failing test for: `Given Ready session on task T, When focus on T again, Then session remains Ready` (idempotent re-focus)
   Test file: `server/src/routes/focus-session.test.ts`
   Level: unit

   Test intent:
   Given `findActive` resolves an existing session on `{ source: "board", task_id: 481 }` in any non-finished state
   When `POST` with `{ action: "focus", source: "board", taskId: 481 }`
   Then:
   - the response is `201` carrying the existing session unchanged — same `id`, same `version`, same `state`, same `accumulatedSeconds`
   - `repo.insert` was NOT called — re-focusing must never reset a running timer to zero
   - `publish` was NOT called — nothing changed, so no tab should be told anything did

   Exercise through: HTTP `POST`
   Test doubles: fake repo, fixed clock, `vi.fn()` publisher
   Expected RED: the handler inserts unconditionally, so `insert` is called and a fresh `version: 1` session comes back

20. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: the handler inserts a fresh row and publishes an event.

21. Implement the idempotent branch, then verify PASS: compare `(source, taskId)`, return the existing active session unchanged, and do not insert or publish. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts`.

22. Write failing test for: focusing a **different** task while a session is active is refused
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit

    Test intent:
    Given `findActive` resolves an active session on task A
    When `POST` with `{ action: "focus", source: "board", taskId: <B, different from A> }`
    Then:
    - the response is `409 { code: "session_active", session: <session on A> }`
    - `repo.insert` was NOT called and session A is untouched

    This is what makes the client's confirm-then-switch dialog possible: the plain `focus` action can never silently discard an in-flight session. Replacing it requires the explicit `switch` action (T6).

    Exercise through: HTTP `POST`
    Test doubles: fake repo, fixed clock, `vi.fn()` publisher
    Expected RED: the handler treats any active session as a re-focus, or inserts a second one

23. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: the handler treats any active session as a re-focus or inserts a second one.

24. Implement the conflict branch, then verify PASS: return `409 { code: "session_active", session }` without changing session A. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts`.

24a. Write/run a separate RED→implementation→PASS cycle for `POST` body validation: Given a member with the flag on, When the body carries an unrecognized `action`, a `source` outside `"board" | "tracker"`, or a non-integer `taskId`, Then the response is `400` with no `findTask`, `insert`, or `publish` call. Without this the bad `source` reaches the insert and trips the `task_source` CHECK constraint, surfacing as a 500 — the status code `.claude/rules/error-handling.md` reserves for the unexpected. T5 Step 19a is the `PATCH` counterpart; this is the `POST` one.
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit (HTTP route)
    Exercise through: `supertest` `POST` against the workspace parent mount
    Test doubles: fake repo, fixed clock, flag-on config, pass-through membership stub, publisher spy
    Expected RED: the handler destructures the body without validating it and proceeds to the task lookup.
    Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

25. Write failing test for: `Given active session on task T, When T no longer resolves, Then session auto-finishes on read`
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit

    Test intent:
    Given `findActive` resolves an active session and `findTask` resolves `null` (the task was soft-deleted, or the user lost access, while nobody was watching)
    When `GET /workspaces/3/focus-session` is requested
   Then:
   - `repo.update` was called finishing that session — `state: "finished"`, `finished_at` set from the injected clock, `running_since` cleared, in-flight time accrued via `core/focus-session.ts` `applyAction(..., "finish", now)`
   - the response is `200 { session: null, autoFinished: { reason: "task_missing", taskKey: "CA-42" } }`
   - `publish` was called so any other open tab drops the session too
   - the injected `recordFocusActivity()` audit seam was called once with `action: "auto_finish"` and the session/workspace/user identifiers; no card/task row was written

    Exercise through: HTTP `GET`
    Test doubles: fake repo, fixed clock, `vi.fn()` publisher. Do NOT mock `core/focus-session.ts` — the accrual on auto-finish is part of what this proves
    Expected RED: `GET` returns the session as-is with no `autoFinished` field and never calls `update`

26. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.test.ts`
    Expected failure: `GET` returns the active session unchanged and never calls `repo.update`.

27. Implement the auto-finish-on-read branch, then verify PASS: apply `finish` through `core/focus-session.ts` with the injected clock, update atomically, publish `payload.session: null`, and return the `autoFinished` response. Run `npm run test --workspace=server -- src/routes/focus-session.test.ts`.

27a. Write/run a separate RED→implementation→PASS cycle for the auto-finish losing its version guard: Given `findActive` resolves an active session, `findTask` resolves `null`, and `repo.update` resolves `null` (a second tab polled `GET` concurrently and finished the row first), When `GET` is requested, Then the response is `200 { session: null }`, `publish` is NOT called, and `recordFocusActivity()` is NOT called — never a 500, never a serialization of `null`. Two tabs polling the same dead task is the ordinary case, not a rare race.
    Test file: `server/src/routes/focus-session.test.ts`
    Level: unit (HTTP route)
    Exercise through: `supertest` `GET`
    Test doubles: fake repo whose `update` resolves `null`, fixed clock, publisher spy, `recordFocusActivity()` spy
    Expected RED: the handler passes the `null` update result to the serializer and throws, producing a 500.
    Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session.test.ts`

28. Register and wire up:
    - `server/src/realtime.ts` — add `"focus_session.updated"` to the `BoardEvent["type"]` union. Reuse the existing `payload?: Record<string, unknown>` field for the session; do not add a bespoke top-level field
    - `server/src/routes.ts` — import `focusSessionRouter` from `./routes/focus-session.js` and mount `api.use("/workspaces/:workspaceId", focusSessionRouter)` beside the other workspace-scoped routers
    - Verify the router is `Router({ mergeParams: true })` (also specified in Step 3) and the mounting test uses the actual `/workspaces/:workspaceId` parent so `requireWorkspaceMember` reads the inherited `workspaceId`; then run `npm run test` and `npm run typecheck --workspace=server`

29. Refactor while green (bounded):
    - Rule of three: the "load active session, 404 if none" preamble will appear again in T5 and T6 — extract it now as a named helper inside `focus-session.ts` (e.g. `loadActiveSessionOr404`), not a generic `utils.ts`
    - Keep `focus-session.ts` under ~300 lines and every handler under ~50; if the serializer grows, move it to a named `serializeFocusSession` function in the same file
    - Refactor only within `focus-session.ts` and `focus-session-repo.ts`
    - Re-run `npm run test --workspace=server -- src/routes/focus-session.test.ts` — must stay PASS

30. Commit:
    `git add server/src/routes/focus-session.ts server/src/routes/focus-session-repo.ts server/src/routes/focus-session.test.ts server/src/routes.ts server/src/realtime.ts`
    `git commit -m "feat(focus): add focus session read and create endpoints"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Focus entry (all four criteria including the `✗` non-member 404); "Story: Focus on a task" Rule 1 and Rule 2; Implementation Notes on `return_path`, idempotent re-focus, and never resolving a task by `key_number` alone
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — why `findTask` must branch on `source` and query `cards` or `tracker_items` explicitly
- `server/src/routes/work-items.test.ts` — the `express()` + `supertest` + `vi.mock` route-test harness this task reuses
- `server/src/routes/helpers.ts` — `createScopedBoardService` / `createWorkspaceAccessService` establish the dependency-injected factory convention
- `server/src/routes/tracker-projects.ts` — router file layout: column tuples, row types, `serializeX` functions, `publishEvent` usage
- `server/src/middleware/workspace.ts` — `requireWorkspaceMember` returns 404 (not 403) for non-members
- `server/src/realtime.ts` — `BoardEvent` union and `publishEvent` signature
- `server/src/core/focus-session.ts` (from T2) — `applyAction` / `elapsedSeconds`, both taking `now: Date`

## WHY THIS APPROACH

Complexity: standard
Justification: five files, and the handler carries real branching — active vs. absent session, same vs. different task, resolvable vs. dead task. It also fixes the seams (repo interface, clock injection, event shape) that two later tasks build on, so the design decisions here outlive the task.

## SANDWICH CONTEXT

[CRITICAL: never read the clock inside a handler. The router is built by `createFocusSessionRouter({ repo, now, publish })`; `now()` is the only time source, and tests inject a fixed one. A `new Date()` inside a handler makes every duration assertion in T5 untestable.]

You are implementing the focus session read and create endpoints for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — server-persisted `focus_sessions` with optimistic locking; SSE keeps tabs and devices in sync.
Files in scope: `server/src/routes/focus-session.ts`, `server/src/routes/focus-session-repo.ts`, `server/src/routes/focus-session.test.ts`, `server/src/routes.ts`, `server/src/realtime.ts` — no other files.
Test framework: Vitest, node environment, `supertest` for HTTP. Single file: `npm run test --workspace=server -- src/routes/focus-session.test.ts`.
Available after: T1 (`focus_sessions` table + Kysely types), T2 (`core/focus-session.ts`), T3 (`config.FOCUS_MODE_ENABLED`).
Architecture rule: NodeNext ESM — every relative import carries `.js`. A task is identified by `(source, taskId)`, never by `key_number` alone (ADR #103). Non-members get 404, never 403. Every mutation calls the injected `recordFocusActivity()` audit seam with `cardId: null` and a namespaced focus payload; it must not mutate `cards` or `tracker_items`, and must not add a deferred `focus_events` table.

[RESTATE: `now()` is injected — no handler may call `new Date()` or `Date.now()` directly.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given board card C, When `POST { action: "focus", source: "board", taskId: C.id }`, Then a Ready session is persisted with `source: "board"`, `taskId: C.id`, `returnPath: "/board/card/<C.id>"`, `accumulatedSeconds: 0`
Given tracker item T with key CA-42, When focused, Then the session carries `source: "tracker"` and `returnPath: "/tracker/CA-42"`
Given a Ready session on task T, When focus is requested on T again, Then the same session is returned unchanged and no row is inserted
Given a previously Finished session on task T, When focus is requested on T again, Then a new Ready session at 0 accumulated seconds is created rather than the finished one being revived
Given Running session with 1200 accumulated seconds, When `GET`, Then `state`, `accumulatedSeconds`, `runningSince`, and `version` come back for the client to restore from
[must-not] Given a non-member, When any focus endpoint is called, Then the response must NOT be 403 or 200 — it must be `404 { error: "Not found" }`
[must-not] Given `FOCUS_MODE_ENABLED=false`, When any focus endpoint is called by a member, Then it must NOT succeed — 404
[must-not] Given an active session on task A, When focus is requested on a different task B, Then the server must NOT finish A or create a session on B — it must return `409 { code: "session_active", session }`
[derived] Given an active session whose task no longer resolves, When `GET`, Then the session is auto-finished with in-flight time accrued and the response is `{ session: null, autoFinished: { reason: "task_missing", taskKey } }`
[derived] Given a task id that resolves in no table for this workspace, When focus is requested, Then the response is 404 and nothing is inserted
[derived] Given a `POST` body with an unrecognized `action`, an invalid `source`, or a non-integer `taskId`, Then the response is 400 with no lookup, insert, or publish
[derived] Given an auto-finish on read whose `repo.update` loses the version guard, Then the response is `200 { session: null }` — not a 500
[must-not] Given a tracker task key, When a fixture or a `return_path` is written, Then it must NOT use a 3-character prefix — `derivePrefix` yields 1-2 characters, so `CA-42` is valid and `CAM-42` is not

All tests PASS. Commit exists with message matching `feat(focus): add focus session read and create endpoints`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Both the feature flag and the membership check are mounted router-level (`router.use(...)`), so every verb — including the ones T5 and T6 add later — is gated by construction
- `publish` is called as `publishEvent(workspaceId, event)` — two arguments, matching `server/src/realtime.ts:408`
- Every SSE publish includes `userId` — the client's privacy filter has nothing else to key on
- The audit seam is the narrow `RecordFocusActivity` domain type; the `db`-bound default lives in exactly one place and uses `eventType: "focus_session"`
- The display key comes from `formatKey(derivePrefix(workspaceName), keyNumber)` in `core/tracker-key.ts` — never a second prefix derivation
- `findTask` branches on `source` and queries `cards` or `tracker_items` explicitly, excluding soft-deleted rows
- The repo stays logic-free: queries and row mapping only
- The response DTO matches the Shared Contract exactly — camelCase, ISO timestamps, `finishedAt: null` when open
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — the active-session preamble is extracted once, not pasted into three handlers
- Commit message follows conventional commits format

Must-not-have:
- `PATCH` handlers or the `switch` action — T5 and T6 own those
- a direct card/task mutation or a `focus_events` table write; the audit call is required and must remain namespaced as a focus-session event
- Resolving a task by `key_number` without its `source`
- Kysely usage anywhere outside `focus-session-repo.ts` — the one exception is the `db`-bound `defaultRecordFocusActivity` at the bottom of the file, which no handler calls directly
- `typeof recordActivity` as the injected audit type, or `eventType: "update"` for a focus row
- A copy of `getWorkspacePrefix` from `tracker-items.ts`
- Any change to `cards` or `tracker_items`

Open question risks:
- Assumption: `GET` returns the stored `accumulatedSeconds` + `runningSince` and lets the client derive the live total. If the product needs a server-computed total in the payload, that is an additive field → report NEEDS_CONTEXT rather than changing the stored semantics.
- Assumption: auto-finish on read is the server's job (not the client's). T13 assumes this is already handled for the load path.

Rollback note:
- With `FOCUS_MODE_ENABLED=false` every endpoint here 404s, which is the Rollback Plan's first step. Verify that explicitly.

Red flags:
- Work outside the six listed files → DONE_WITH_CONCERNS
- A clock read inside a handler → STOP
- A cross-table FK or a `key_number`-only lookup → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=server` are green, commit created
Uncertain when: the client-derives-duration assumption proves wrong, or auto-finish-on-read turns out to belong on the client
Escalate when: the handler appears to need a dedicated `focus_events` table (deferred to issue #107), a change to `cards`/`tracker_items`, or a `key_number`-only task lookup. Do not escalate to skip `recordFocusActivity()` — the injected namespaced audit seam is required on every focus mutation.


---
### Task 5: Focus session route — lifecycle transitions + optimistic locking [depends: T4]

## OBJECTIVE

Add `PATCH /workspaces/:workspaceId/focus-session` with actions `start`, `pause`, `resume`, `finish`, delegating all time math and transition legality to `core/focus-session.ts`, and returning HTTP 409 on a stale `version`.

Files:
- Modify: `server/src/routes/focus-session.ts`
- Test: `server/src/routes/focus-session.lifecycle.test.ts`

A new test file, not an edit to `focus-session.test.ts` — T4's suite stays as the read/create contract, this one is the lifecycle contract.

The handler is thin by construction: load the active session → `applyAction(snapshot, action, now())` → `repo.update(id, patch, expectedVersion)` → publish → serialize. Anything that looks like duration arithmetic in this file belongs in `core/focus-session.ts` instead.

Steps:

1. Write failing test for: `Given Ready, When Start, Then Running with runningSince set`
   Test file: `server/src/routes/focus-session.lifecycle.test.ts`
   Level: unit

   Test intent:
   Given a Ready session (`accumulated_seconds: 0`, `running_since: null`, `version: 1`) and an injected clock fixed at `T0`
   When `PATCH /workspaces/3/focus-session` with `{ action: "start", version: 1 }`
   Then:
   - the response is `200`, `body.session.state` is `"running"`, `runningSince` is `T0` as ISO, `accumulatedSeconds` is still `0`
   - `repo.update` was called with `expectedVersion: 1`
   - `publish` was called once as **two arguments** — `publishEvent(workspaceId, event)` is the real signature (`server/src/realtime.ts:408`), so the assertion is `expect(publish).toHaveBeenCalledWith(3, { type: "focus_session.updated", userId, workspaceId, payload: { session } })`, never a single object
   - the injected `recordFocusActivity()` audit spy was called once with `cardId: null` and `{ kind: "focus_session", action: "start", sessionId, workspaceId, userId }`

   Exercise through:
   - HTTP `PATCH`, via `supertest` against a router built with `createFocusSessionRouter({ repo: fakeRepo, now: () => T0, publish: vi.fn(), recordFocusActivity: vi.fn() })`

   Reuse T4's app builder shape: `express.json()` plus a middleware that sets **both** `req.user` and `req.workspace`. `work-items.test.ts` sets only `req.workspace`, and every `userId` assertion below reads `req.user!.id`.

   Test doubles:
   - fake `FocusSessionRepo`, injected fixed clock, `vi.fn()` publisher, injected `recordFocusActivity()` audit spy
   - mock `../config.js` with `FOCUS_MODE_ENABLED: "true"` and `../middleware/workspace.js` pass-through
   - do NOT mock: `core/focus-session.ts` — its state machine is exactly what this route is supposed to be delegating to

   Expected RED:
   - `PATCH` is not routed — Express returns 404 and `repo.update` is never called

2. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
   Expected failure: `expected 404 to be 200`

3. Implement minimal code to satisfy the test:
   File: `server/src/routes/focus-session.ts` — add the `PATCH` handler reusing T4's active-session helper, handling `start` only, and calling the injected `recordFocusActivity()` audit seam on the successful mutation.

4. Run test — verify PASS: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`

5. Write failing test for: `Given Running, When Pause after 10m, Then Paused with ~600 accumulated seconds`
   Test file: `server/src/routes/focus-session.lifecycle.test.ts`
   Level: unit

   Test intent:
   Given a preloaded Running session with `running_since: T0`, `accumulated_seconds: 0`, and a clock at `T0 + 600s`
   When `PATCH { action: "pause", version: N }` is issued as the only mutation in this test
   Then `body.session.state` is `"paused"`, `accumulatedSeconds` is `600`, `runningSince` is `null`, and `recordFocusActivity()` is called once with `action: "pause"`
   The clock is a mutable `let clockNow: Date` closed over by the injected `now: () => clockNow`, advanced between requests. No fake timers — the server never reads a real clock.

   Exercise through: HTTP `PATCH`
   Test doubles: fake repo (its `update` returns the merged row so the second request sees the first one's result), injected advancing clock, `vi.fn()` publisher, injected `recordFocusActivity()` audit spy
   Expected RED: `pause` is unhandled — the response is a 4xx or the session comes back unchanged

6. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
   Expected failure: the pause request is unhandled.

7. Implement `pause` by delegating to `applyAction` and calling `recordFocusActivity()` with `action: "pause"`, then verify PASS: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.

8. Write a separate failing test for: `Given Paused 600s, When Resume 5m then Pause, Then ~900s`
    Test file: `server/src/routes/focus-session.lifecycle.test.ts`
    Level: unit

    Test intent:
    Given a Paused session with `accumulated_seconds: 600`, When `resume` at `T1` then `pause` at `T1 + 300s`, Then `accumulatedSeconds` is `900` and `runningSince` is `null`. Each successful mutation calls `recordFocusActivity()` (`action: "resume"` then `action: "pause"`).

    Exercise through: HTTP `PATCH`
    Test doubles: the advancing injected clock, fake repo, publisher spy, and `recordFocusActivity()` audit spy from the prior cycle
    Expected RED: `resume` is still unhandled.

9. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
    Expected failure: the resume request is unhandled or does not accrue the second interval.

10. Implement `resume` by delegating to `applyAction` and calling `recordFocusActivity()` with `action: "resume"`, then verify PASS: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.

11. Write failing test for: `Given Running on task T, When Finish focus, Then session ends and task status is unchanged`
   Test file: `server/src/routes/focus-session.lifecycle.test.ts`
   Level: unit

   Test intent:
   Given a Running session with `accumulated_seconds: 300`, `running_since: T0`, and a clock at `T0 + 120s`
   When `PATCH { action: "finish", version: N }`
   Then:
   - `repo.update` receives `state: "finished"`, `accumulated_seconds: 420`, `running_since: null`, and `finished_at` set from the clock
   - the response is `200` and `body.session.state` is `"finished"` — the client uses `returnPath` from this payload to navigate back
   - `publish` was called with `payload: { session: null }` — **not** the finished session. The Shared Contract makes `null` the signal that no session is active; publishing the finished row instead would have every other tab's provider adopt it as its current session, contradicting the rule the client relies on. The HTTP response still carries the finished session so the acting tab can read `returnPath` off it
   - **no task-mutating repo method exists or is called** — finishing focus must not touch the card's or tracker item's status

   Exercise through: HTTP `PATCH`
   Test doubles: fake repo, injected clock, `vi.fn()` publisher, and injected `recordFocusActivity()` audit spy
   Expected RED: `finish` is unhandled

12. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
    Expected failure: `finish` is unhandled.

13. Implement `finish`, then verify PASS: accrue through `applyAction`, persist `finished`, publish `payload.session: null`, call `recordFocusActivity()` exactly once with the namespaced focus payload, and assert that no card/task row is touched. Run `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.

14. Write failing test for: `Given stale version, When mutation, Then HTTP 409 and the client can refresh`
   Test file: `server/src/routes/focus-session.lifecycle.test.ts`
   Level: unit

   Test intent:
   Given the stored session is at `version: 4` and `repo.update` returns `null` for `expectedVersion: 3` (the guard matched no row)
   When `PATCH { action: "resume", version: 3 }`
   Then:
   - the response status is `409`, never 500
   - the body is `{ code: "version_conflict", session }` where `session` is the **current** server state at version 4, so the losing tab can reconcile without a second round trip
   - `publish` was NOT called — a rejected write changed nothing

   Exercise through: HTTP `PATCH`
   Test doubles: fake repo returning `null` from `update`, then resolving the current row from `findActive`; injected clock; `vi.fn()` publisher
   Expected RED: a failed update currently throws or returns 500, and no session is echoed back

15. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
    Expected failure: a failed update throws or returns 500 without the current session.

16. Implement the `version_conflict` branch, then verify PASS: return the current active session with 409 and do not publish. Run `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.

17. Write a separate failing test for: an illegal transition is refused without corrupting state
    Test file: `server/src/routes/focus-session.lifecycle.test.ts`
    Level: unit

   Test intent:
   Independent RED case A: Given a Running session at the correct `version`, When `PATCH { action: "start", version: N }` is sent, Then `InvalidFocusTransitionError` becomes `409 { code: "invalid_transition", session }`, never 500, and neither `repo.update` nor `publish` is called. Unknown-action validation is a separate cycle below.

    Exercise through: HTTP `PATCH`
    Test doubles: fake repo, injected clock, `vi.fn()` publisher. Do NOT mock the core module — the thrown error is the thing being translated
    Expected RED: the error escapes the handler as an unhandled rejection or a 500

18. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
    Expected failure: the error escapes or becomes a 500.

19. Implement the invalid-transition translation, then verify PASS: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.

19a. Write/run a separate RED→implementation→PASS cycle for an unknown `action`: Given a valid active session, When `PATCH` carries an unsupported action, Then the response is `400`, with no update or publish. This is input validation, not a state conflict.
    Test file: `server/src/routes/focus-session.lifecycle.test.ts`
    Level: unit
    Exercise through: HTTP `PATCH` against the route
    Test doubles: fake repo, fixed clock, flag-on config, pass-through membership middleware, and publisher spy
    Expected RED: unsupported actions are currently passed to the core or become a 500 instead of a 400.
    Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`

20. Refactor while green (bounded):
    - Rule of three: `load session → apply → update → publish → serialize` now runs for four actions. It must exist once as a single parameterized path, not four copy-pasted blocks
    - If `focus-session.ts` approaches ~300 lines, extract the serializer and the error translation into the mapped `server/src/routes/focus-session-serialize.ts`
    - Refactor only within `server/src/routes/focus-session.ts` (plus that extraction if it happens)
    - Re-run both `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts` and `npm run test --workspace=server -- src/routes/focus-session.test.ts` — both must stay PASS

21. Commit:
    `git add server/src/routes/focus-session.ts server/src/routes/focus-session.lifecycle.test.ts`
    If Step 20 extracted `server/src/routes/focus-session-serialize.ts`, additionally run `git add server/src/routes/focus-session-serialize.ts` before committing.
    `git commit -m "feat(focus): add focus session lifecycle transitions with optimistic locking"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Lifecycle (all five `✓` criteria plus the `✗` Start-failure criterion); rule: Concurrency (`✗ Given stale version, When mutation, Then HTTP 409 and client refreshes`); "Story: Session lifecycle" Rule 2 (Finish does not complete the task)
- `.claude/rules/error-handling.md` — 409 for conflicts (optimistic locking), 400 for malformed input, 500 only for the unexpected
- `server/src/core/focus-session.ts` (T2) — `applyAction(snapshot, action, now)` and `InvalidFocusTransitionError`
- `server/src/routes/focus-session.ts` (T4) — the factory, repo interface, active-session helper, and serializer this task extends
- `server/src/routes/work-items.test.ts` — route-test harness
- `server/src/routes/cards.ts` — existing optimistic-locking 409 precedent on `version`

## WHY THIS APPROACH

Complexity: standard
Justification: two files, but four actions × three outcomes (success, stale version, illegal transition) is real branching, and the 409 body contract is what the client's conflict recovery in T7 depends on.

## SANDWICH CONTEXT

[CRITICAL: no duration arithmetic in this file. Every transition goes through `applyAction(snapshot, action, now())` from `server/src/core/focus-session.ts`. A second implementation of the accrual rule here will drift from the one T2 tested, and the two will disagree about how much time a user worked.]

You are implementing the focus session lifecycle transitions for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — server-authoritative active time (`accumulated_seconds` + `running_since`), optimistic locking on `version`, SSE fan-out to other tabs.
Files in scope: `server/src/routes/focus-session.ts`, `server/src/routes/focus-session.lifecycle.test.ts` — no other files (plus a serializer extraction if Step 13 triggers one).
Test framework: Vitest, node environment, `supertest`. Single file: `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`.
Available after: T4 (router factory, repo, serializer, SSE event type), T2 (state machine), T1 (schema), T3 (flag).
Architecture rule: NodeNext ESM — relative imports carry `.js`. A stale write returns 409, never 500. Finishing focus must never mutate the task's status. Every lifecycle mutation calls the injected `recordFocusActivity()` audit seam with `cardId: null` and the namespaced focus payload; it must not write a card/task row, and dedicated `focus_events` remains deferred to issue #107.

[RESTATE: all time math goes through `core/focus-session.ts` — this file computes no durations of its own.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given Ready session with 0 accumulated seconds, When Start then Pause 10 minutes later, Then `accumulatedSeconds` is 600 and the timer is stopped
Given Paused session with 600 accumulated seconds, When Resume then Pause 5 minutes later, Then `accumulatedSeconds` is 900
Given Running session on a task in "In Progress", When Finish focus, Then the session ends and no task-status write occurs
[derived] Given a Finish, When the SSE event is published, Then `payload.session` is `null`, matching the Shared Contract that other tabs' providers depend on
Given a session at version 4, When a mutation arrives with version 3, Then the response is `409 { code: "version_conflict", session }` carrying the current version-4 session
[derived] Given Ready session, When Start, Then `runningSince` is set to the request time and `accumulatedSeconds` stays 0
[must-not] Given a Running session, When `start` is requested, Then the timer must NOT restart — respond `409 { code: "invalid_transition", session }` with no write
[must-not] Given a stale-version request, When it is rejected, Then the server must NOT publish an SSE event — nothing changed
[must-not] Given any lifecycle action, When it succeeds, Then the handler must NOT write to `cards` or `tracker_items`
[derived] Given a `PATCH` body with an unrecognized `action`, Then the response is 400

All tests PASS. Commit exists with message matching `feat(focus): add focus session lifecycle transitions with optimistic locking`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- All four actions share one parameterized path, not four copy-pasted handlers
- 409 responses carry the current session so the losing tab reconciles in one round trip
- Every successful mutation publishes `focus_session.updated` with `userId`, called as `publishEvent(workspaceId, event)` — two arguments
- Every successful `start` / `pause` / `resume` / `finish` calls the injected `recordFocusActivity()` audit seam
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — the load/apply/update/publish/serialize path exists once
- Commit message follows conventional commits format

Must-not-have:
- Duration arithmetic outside `core/focus-session.ts`
- A `new Date()` or `Date.now()` in any handler — use the injected `now()`
- The `switch` action — T6 owns it
- Any write to `cards`, `tracker_items`, `settings`, or `workspace_settings`
- a card/task row or a `focus_events` write; the required `recordFocusActivity()` audit call remains namespaced to focus
- 500 responses for a stale version or an illegal transition

Open question risks:
- Assumption: an illegal transition is a 409 (`invalid_transition`), on the reasoning that it conflicts with current server state and the client recovers the same way it does from a version conflict. If a 400 is preferred, only the status code changes → note it, do not block.
- Assumption: logout while Running keeps accruing. Nothing here auto-pauses; if that assumption breaks, a new action is needed → report NEEDS_CONTEXT.

Rollback note:
- With `FOCUS_MODE_ENABLED=false`, `PATCH` 404s along with the rest of the router. T4 mounts both the flag gate and the membership check router-level (`router.use(...)`), so a verb added here is gated the moment it is routed — no per-route wiring needed. Confirm this by reading the top of `focus-session.ts` before adding `PATCH`; if either gate turns out to be per-route, fix that first.

Red flags:
- Work outside the listed files → DONE_WITH_CONCERNS
- Duration math written in the route → STOP
- A task-status write on Finish → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, both focus route suites and `npm run test` are green, commit created
Uncertain when: the 409-for-illegal-transition choice is disputed, or the logout-while-Running assumption breaks
Escalate when: satisfying a scenario appears to require mutating the task, or duplicating the accrual rule in the route

---
### Task 6: Focus session route — atomic switch [depends: T5]

## OBJECTIVE

Add the `switch` action to `POST /workspaces/:workspaceId/focus-session`: finish the current session with its in-flight time accrued and create a Ready session on the new task, in a **single database transaction** so a user can never end up with two active sessions or with the old one destroyed and no replacement.

Files:
- Modify: `server/src/routes/focus-session.ts`
- Modify: `server/src/routes/focus-session-repo.ts`
- Test: `server/src/routes/focus-session.switch.test.ts`
- Test: `server/src/routes/focus-session.switch.integration.test.ts`

The repo gains one method: `switchSession(finish: { id, patch, expectedVersion }, create: InsertInput): Promise<{ finished: FocusSessionRow; created: FocusSessionRow } | null>`, implemented with `db.transaction().execute(...)` and returning `null` when the version guard matched no row. Keeping the transaction inside the repo is what lets the route stay testable with a fake.

Steps:

1. Write failing test for: `Given Running on task A, When switchSession creates B, Then the real transaction finishes A and leaves exactly one active session on B`
   Test file: `server/src/routes/focus-session.switch.integration.test.ts`
   Level: integration (real PostgreSQL)

   Test intent:
   Given an isolated real database fixture with a Running session on task A for `(user 7, workspace 3)`, plus a valid Ready-session insert input for task B
   When `createFocusSessionRepo(db).switchSession({ finish: { id: A.id, patch: { state: "finished", accumulated_seconds: 360, running_since: null, finished_at: T1 }, expectedVersion: A.version }, create: B })` runs
   Then:
   - exactly one row with `state <> 'finished'` exists for that `(user_id, workspace_id)`, and it points at B with `accumulated_seconds = 0`
   - A's row is present with `state = "finished"` and its accrued seconds
   - no unique-constraint violation is raised, proving the finish update occurs before the insert inside one transaction

   Fixture boundary: seed and clean up only the dedicated user, workspace, and `focus_sessions` rows, following `server/src/routes/work-item-member-concurrency.integration.test.ts`; do not rely on pre-existing rows or hard-coded generated ids.

   Exercise through: `createFocusSessionRepo(db).switchSession(...)`; the repository transaction is the unit under test
   Test doubles: none; gate the file with `describe.skipIf(!process.env.RUN_INTEGRATION)` so the default suite collects but skips it without a database
   Expected RED: `repo.switchSession is not a function` because T4's repository has no switch method yet

2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts` (needs `make db-up && make db-migrate`)
   Expected failure: `TypeError: repo.switchSession is not a function`

3. Write a separate failing test for: `Given the replacement insert fails, When switchSession runs, Then the old session remains Running`
   Test file: `server/src/routes/focus-session.switch.integration.test.ts`
   Level: integration (real PostgreSQL)

   Test intent:
   Given the same isolated fixture with Running session A, and a replacement insert input that explicitly sets `id: A.id` (Kysely's `Generated<number>` id is optional in an insert input; production leaves it generated, while this test uses the duplicate primary key as a deterministic insert failure)
   When `switchSession` attempts to finish A and insert B in one transaction
   Then:
   - the call rejects with PostgreSQL's duplicate-primary-key error
   - a fresh query shows A is still `state: "running"` with its original version and accumulated seconds — the failed insert rolled back the finish update

   Exercise through: the real `createFocusSessionRepo(db).switchSession(...)` boundary, followed by a real query of A
   Test doubles: none; use the same `RUN_INTEGRATION` gate and isolated fixture cleanup as the first integration scenario
   Expected RED: `repo.switchSession is not a function`; after the method exists, this test must fail if the implementation uses two sequential writes instead of a transaction

3a. Write a separate failing test for: `Given a stale expectedVersion, When switchSession runs against PostgreSQL, Then it returns null and A stays Running`
   Test file: `server/src/routes/focus-session.switch.integration.test.ts`
   Level: integration (real PostgreSQL)
   Test intent: Given Running session A at `version: 4`, When `switchSession` is called with `expectedVersion: 2` and a valid create input for B, Then the call resolves `null`, a fresh query shows A still Running at version 4 with original accumulated seconds, and no row for B exists. A fake-repo HTTP 409 cannot prove the SQL version guard.
   Exercise through: the real `createFocusSessionRepo(db).switchSession(...)` boundary, followed by a real query of A and a count of B
   Test doubles: none; same `RUN_INTEGRATION` gate and isolated fixture cleanup
   Expected RED: `repo.switchSession is not a function`; after the method exists, this must fail if the UPDATE omits `version = expectedVersion`

4. Run test — verify FAIL for integration RED case A only: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t exactly.one.row`.
   Expected failure: `repo.switchSession is not a function`.

4a. Run test — verify FAIL for integration RED case B only: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t old.session.remains.Running`.
   Expected failure: `repo.switchSession is not a function`.

4b. Run test — verify FAIL for integration RED case C only: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t stale.expectedVersion`.
   Expected failure: `repo.switchSession is not a function`.

   **Filter hygiene for steps 4, 4a, 4b and 6.** The `-t` values above are unquoted regexes whose `.` stands in for a space. Never write `-t "old session remains Running"`: npm strips the quotes, vitest receives `-t old` plus three stray positional filters, and the run can report `Tests N skipped (N)` at **exit 0** — a green gate that executed nothing (`CLAUDE.md`, "Never filter with `-t \"multi word\"`"). After every filtered run, confirm the summary says `Tests 1 passed (1)` or `1 failed`, not `skipped`. If that is ever in doubt, drop the filter and run the whole file.

5. Implement minimal code to satisfy the three independent integration cases:
   File: `server/src/routes/focus-session-repo.ts` — add `switchSession`, using `db.transaction().execute(...)`, applying the guarded finish update first (`WHERE id = $id AND version = expectedVersion`) and then inserting the replacement; return both rows and return `null` when the expected version matches no row.

6. Run test — verify PASS for case A, then case B, then case C, then the file as a whole: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t exactly.one.row`, `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t old.session.remains.Running`, `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts -t stale.expectedVersion`, and finally `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts`.

7. Write failing test for: `Given Running on task A with 300 accumulated seconds, When confirm switch to B, Then A is Finished with accumulated time and B is Ready at 0`
   Test file: `server/src/routes/focus-session.switch.test.ts`
   Level: unit

   Test intent:
   Given a Running session on task A (`accumulated_seconds: 300`, `running_since: T0`, `version: 2`) and a clock at `T0 + 60s`
   When `POST /workspaces/3/focus-session` with `{ action: "switch", source: "board", taskId: <B>, version: 2 }`
   Then:
   - `repo.switchSession` was called **once** — not a separate finish call followed by a separate insert
   - its `finish` argument carries `state: "finished"`, `accumulated_seconds: 360`, `running_since: null`, `finished_at` from the clock, and `expectedVersion: 2`
   - its `create` argument carries `task_source: "board"`, `task_id: B`, `state: "ready"`, `accumulated_seconds: 0`, `running_since: null`, and the `return_path` for B
   - the response is `201` and `body.session` is the **new** Ready session on B
   - `publish` was called as **two arguments** — `publishEvent(workspaceId, event)` (`server/src/realtime.ts:408`) — carrying the new session as `payload.session`, so other tabs land on B rather than a stale A. Assert `toHaveBeenCalledWith(3, {...})`, never a single object
   - the injected `recordFocusActivity()` audit spy was called once with `cardId: null` and `{ kind: "focus_session", action: "switch", sessionId, workspaceId, userId }`

   Exercise through: HTTP `POST`, via `supertest` against a router built with `createFocusSessionRouter({ repo: fakeRepo, now, publish, recordFocusActivity: vi.fn() })`. Reuse T4's app builder: `express.json()` plus a middleware setting **both** `req.user` and `req.workspace` — `work-items.test.ts` sets only the latter, and the `userId` assertions read `req.user!.id`
   Test doubles: fake `FocusSessionRepo` with `switchSession` as a `vi.fn()`; injected fixed clock; `vi.fn()` publisher; injected `recordFocusActivity()` audit spy; mock `../config.js` (`FOCUS_MODE_ENABLED: "true"`) and `../middleware/workspace.js` pass-through; do NOT mock `core/focus-session.ts`
   Expected RED: `switch` is not a recognized action, so the handler returns `409 { code: "session_active" }` instead of `201`

8. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`
   Expected failure: `expected 409 to be 201`

9. Implement minimal code to satisfy the test:
   File: `server/src/routes/focus-session.ts` — add the `switch` branch to `POST`: compute the finished snapshot via `applyAction(snapshot, "finish", now())`, build the new session input, call `repo.switchSession`, publish, serialize, and call the injected `recordFocusActivity()` audit seam once on success. The repository method is already implemented by Step 5.

10. Run test — verify PASS: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`

11. Write failing test for: switch with no active session behaves like a plain focus
    Test file: `server/src/routes/focus-session.switch.test.ts`
    Level: unit

    Test intent:
    Given `findActive` resolves `null` (the session finished in another tab between the dialog opening and the user confirming)
    When `POST { action: "switch", source: "tracker", taskId: 77 }`
    Then:
    - the response is `201` with a Ready session on the new task
    - `repo.insert` was used and `repo.switchSession` was NOT called — there is nothing to finish
    - the user is not shown an error for a race they did not cause

    Exercise through: HTTP `POST`
    Test doubles: fake repo, injected clock, `vi.fn()` publisher
    Expected RED: the switch branch assumes an active session and throws or 404s when there is none

12. Run test — verify FAIL, implement the fallback, verify PASS: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`

13. Write failing test for: a stale switch is rejected and leaves the old session running
    Test file: `server/src/routes/focus-session.switch.test.ts`
    Level: unit

    Test intent:
    Given the stored session on A is at `version: 4` and `repo.switchSession` returns `null` for `expectedVersion: 2`
    When `POST { action: "switch", source: "board", taskId: B, version: 2 }`
    Then:
    - the response is `409 { code: "version_conflict", session }` carrying the current session on A
    - `publish` was NOT called
    - `recordFocusActivity()` was NOT called — a rejected write is not an audit event
    - **no session on B exists** — a rejected switch must be all-or-nothing, never "A finished but B not created"

    Exercise through: HTTP `POST`
    Test doubles: fake repo returning `null` from `switchSession` then the current row from `findActive`; injected clock; `vi.fn()` publisher; injected `recordFocusActivity()` audit spy
    Expected RED: a `null` return is treated as success and a serialization of `null` escapes as a 500

14. Run test — verify FAIL, implement the 409 branch, verify PASS: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`

15. Write failing test for: switching to the task already focused is a no-op
    Test file: `server/src/routes/focus-session.switch.test.ts`
    Level: unit

    Test intent:
    Given an active session on task A
    When `POST { action: "switch", source: "board", taskId: <A, the same task> }`
    Then the existing session is returned unchanged, `repo.switchSession` was NOT called, `publish` was NOT called, and `recordFocusActivity()` was NOT called — a confirm dialog that resolves to the current task must never reset the running timer to zero

    Exercise through: HTTP `POST`
    Test doubles: fake repo, injected clock, `vi.fn()` publisher
    Expected RED: the switch branch runs unconditionally and returns a fresh session at 0 seconds

16. Run test — verify FAIL, implement the same-task guard (reusing T4's idempotent-focus comparison rather than writing a second one), verify PASS: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`

17. Write failing test for: switching to a task that does not resolve is refused
    Test file: `server/src/routes/focus-session.switch.test.ts`
    Level: unit

    Test intent:
    Given an active Running session on task A, and `findTask` resolving `null` for the target (soft-deleted, or belonging to another workspace)
    When `POST { action: "switch", source: "board", taskId: <B>, version: N }`
    Then:
    - the response is `404` and `repo.switchSession` was NOT called
    - session A is untouched — still Running, still holding its accumulated time
    - `publish` was NOT called

    T4 Step 7 proves this guard for the `focus` action; `switch` needs its own, and the consequence of missing it is worse. Without the guard the switch branch computes A's finish snapshot and commits the transaction, so the user loses an active session AND lands on one pointing at an inaccessible task, with `return_path` built from a null `task_key`.

    Exercise through: HTTP `POST`
    Test doubles: fake repo with `findTask` resolving `null`; injected fixed clock; `vi.fn()` publisher
    Expected RED: the switch branch never consults `findTask` — it finishes A and calls `switchSession` regardless

18. Run test — verify FAIL, implement the guard before any snapshot computation, verify PASS: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`

19. Refactor while green (bounded):
    - Rule of three: "does this request target the session's current task" now appears in the `focus` branch and the `switch` branch. Extract it once as a named predicate in `focus-session.ts` (e.g. `targetsSameTask(session, body)`) — never a generic `utils.ts`
    - The `create` input construction (`return_path`, `task_key`, Ready defaults) is shared by `focus` and `switch` — extract it once as `buildReadySessionInput(...)`. It is the single caller of `formatKey(derivePrefix(workspaceName), keyNumber)` from `core/tracker-key.ts`; do not derive the prefix a second time in the switch branch
    - If `focus-session.ts` crosses ~300 lines, move the repo-facing input builders into `focus-session-inputs.ts`; this conditional file is already listed in the File Structure Map and must be included in the commit below
    - Refactor only within `focus-session.ts` and `focus-session-repo.ts`, plus the mapped conditional `focus-session-inputs.ts`
    - Re-run all three default-run focus route suites — every one must stay PASS:
      `npm run test --workspace=server -- src/routes/focus-session.test.ts`
      `npm run test --workspace=server -- src/routes/focus-session.lifecycle.test.ts`
      `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`
    - Re-run the integration cycle: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts`

20. Commit:
    `git add server/src/routes/focus-session.ts server/src/routes/focus-session-repo.ts server/src/routes/focus-session.switch.test.ts server/src/routes/focus-session.switch.integration.test.ts`
    If Step 19 extracted `server/src/routes/focus-session-inputs.ts`, additionally run `git add server/src/routes/focus-session-inputs.ts` before committing.
    `git commit -m "feat(focus): add atomic focus session switch"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Switch task (both criteria); "Story: Switch focus task"; Implementation Notes: "Switch-focus atomicity: single server transaction (finish old + create new Ready) via `POST` action `switch`"
- `server/src/routes/focus-session.ts` (T4, T5) — the factory, repo interface, active-session helper, serializer, 409 contract
- `server/src/core/focus-session.ts` (T2) — `applyAction(snapshot, "finish", now)` computes the accrual at the switch moment
- `server/src/routes/tracker-projects.ts` — `db.transaction().execute(...)` usage in this codebase
- `server/src/routes/workspace-mutation-lock.ts` — existing precedent for serializing concurrent workspace mutations, if the transaction alone proves insufficient

## WHY THIS APPROACH

Complexity: standard
Justification: two files, but the deliverable is an atomicity guarantee — the failure mode (old session finished, new one never created, user's time silently gone) is invisible in a non-transactional implementation that otherwise passes every happy-path assertion.

## SANDWICH CONTEXT

[CRITICAL: finish-old and create-new must happen in ONE database transaction. Two sequential repo calls can leave a user with no session and lost time if the second fails, and the partial-unique index will reject a second active row anyway — producing a 500 instead of a switch.]

You are implementing the atomic focus session switch for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — confirm-then-switch; the old session is auto-stopped and Finished with its accumulated time, and the new session starts Ready at 0.
Files in scope: `server/src/routes/focus-session.ts`, `server/src/routes/focus-session-repo.ts`, `server/src/routes/focus-session.switch.test.ts`, `server/src/routes/focus-session.switch.integration.test.ts` — no other files (plus `focus-session-inputs.ts` if Step 19 triggers the mapped extraction).
Test framework: Vitest, node environment, `supertest`. Single file: `npm run test --workspace=server -- src/routes/focus-session.switch.test.ts`.
Available after: T5 (lifecycle transitions + 409 contract), T4 (factory, repo, serializer), T2 (state machine), T1 (schema, partial unique index).
Architecture rule: NodeNext ESM — relative imports carry `.js`. The transaction lives in the repo, not the route, so the route stays testable with a fake. Never mutate the task itself. Every successful switch calls the injected `recordFocusActivity()` audit seam with `cardId: null` and the namespaced focus payload; it must not write a card/task row, and dedicated `focus_events` remains deferred to issue #107.

[RESTATE: one transaction — finish-old and create-new commit together or not at all.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given Running session on task A with 300 accumulated seconds, When the user confirms a switch to task B 60 seconds later, Then A is Finished with 360 accumulated seconds and a Ready session on B exists at 0 seconds
[derived] Given no active session, When `switch` is requested, Then it behaves as a plain focus — a Ready session on the target, no finish attempted
[derived] Given the target task is the one already focused, When `switch` is requested, Then the existing session is returned unchanged with no write
[must-not] Given a stale `version`, When `switch` is requested, Then the server must NOT finish the old session — respond `409 { code: "version_conflict", session }` with no session on B created; proven against PostgreSQL when `expectedVersion` is stale (integration Case C), not only a fake `switchSession → null`
[must-not] Given any switch, When it is applied, Then it must NOT leave two non-finished sessions for the same `(user_id, workspace_id)` — proven against a real database in the `RUN_INTEGRATION`-gated cycle, since a fake repo cannot observe it
[derived] Given a successful switch, When the route persists B, Then `recordFocusActivity()` is called once with `action: "switch"` and `cardId: null`; rejected and same-task no-op switches must not audit
[derived] Given the target task does not resolve, When `switch` is requested, Then the response is 404, the transaction is never opened, and session A is untouched
[must-not] Given a switch, When the old session is finished, Then the task's own status must NOT change

All tests PASS. Commit exists with message matching `feat(focus): add atomic focus session switch`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Finish + create in a single `db.transaction().execute(...)` inside the repo
- The SQL finish update matches `version = expectedVersion` and returns `null` when it matches no row — proven against PostgreSQL, not only a fake
- The accrual at the switch moment comes from `applyAction(..., "finish", now())`, not from arithmetic in the route
- A successful switch calls the injected `recordFocusActivity()` audit seam; rejected and same-task no-ops do not
- The same-task check is shared with the `focus` branch, not reimplemented
- The response carries the **new** session; `publish` carries the same, called as `publishEvent(workspaceId, event)` — two arguments
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — same-task comparison and Ready-input construction each exist once
- Commit message follows conventional commits format

Must-not-have:
- Two sequential repo calls standing in for a transaction
- Any write to `cards` or `tracker_items`
- a card/task row or a `focus_events` write; the required `recordFocusActivity()` audit call remains namespaced to focus
- A second copy of the return-path or task-key construction from T4

Open question risks:
- Assumption: the client sends the current `version` with `switch`, matching the lifecycle actions. If the confirm dialog cannot supply one, the guard needs rethinking → report NEEDS_CONTEXT rather than dropping the version check.

Rollback note:
- `FOCUS_MODE_ENABLED=false` 404s this action along with the rest of the router, because T4 mounts the flag gate router-level (`router.use(...)`) rather than per-route. A switch in flight at rollback time leaves at most one finished and one ready row — both harmless.

Red flags:
- Work outside the listed files → DONE_WITH_CONCERNS
- Finish and create issued as separate transactions → STOP
- A task-status write → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, all three focus route suites plus `npm run test` are green, commit created
Uncertain when: the client cannot supply `version` on switch
Escalate when: atomicity appears to require `lockWorkspaceMutation` or a schema change

---
### Task 7: Client focus session model — `FocusSessionProvider` + SSE seams [depends: T6]

## OBJECTIVE

Build the client's model of the focus session: the `FocusSession` type, the `api.focus.*` methods, the three `BoardContext` fan-out seams the feature needs, and a `FocusSessionProvider` that owns session state, lifecycle actions, conflict recovery, and cross-tab sync. Every focus UI task consumes it through `useFocusSession()` and never calls the focus API directly.

**A provider, not a bare hook.** Three surfaces read this state — the focus page (T9), the nav indicator (T11), and the workspace-switch guard (T12). A per-caller hook would fetch once per mount and let the page and the indicator drift apart between SSE echoes. One provider mounted inside `BoardProvider` gives every consumer the same session object.

Files:
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/context/BoardContext.tsx`
- Create: `client/src/context/FocusSessionContext.tsx`
- Modify: `client/src/App.tsx`
- Test: `client/src/context/FocusSessionContext.test.tsx`
- Test: `client/src/context/BoardContext.focusSeams.test.tsx`

`FocusSessionProvider` wraps the router inside `BoardProvider` in `client/src/App.tsx`, so the session is available everywhere a logged-in user can navigate. `useFocusSession()` is the consumer hook, throwing outside the provider exactly as `useBoard()` does.

**Three seams, not one.** `BoardContext` fans out `tracker.*` today through the existing `subscribeTrackerEvents`, and nothing else. This task adds the other three fan-outs the focus feature needs downstream, each with its own control-flow rule:

| Seam | Events | Consumed by | Control flow after fan-out |
|---|---|---|---|
| `subscribeFocusEvents` | `focus_session.updated` | this provider | `return` — a focus event must not also schedule a board refresh |
| `subscribeCardEvents` | `card.*` | T9 (refresh the surface on a board-card update), T13 (auto-finish on delete) | **fall through** to `scheduleRefresh()` — that fall-through is what refreshes the board on every card change today |
| `subscribeMembershipEvents` | `membership.removed` | T13 (auto-finish on access loss) | fan out **first**, then let the existing redirect logic run unchanged |

None of these three exists today — only the `tracker.*` fan-out does. Verified in `client/src/context/BoardContext.tsx`: the `onmessage` handler branches on `tracker.` and returns, but every `card.*` event falls straight through to `scheduleRefresh()` with no subscriber notified, and `membership.removed` is handled inline with a redirect and fans out to nobody. Without the card seam, half of the spec's `Rule: Work context` SSE criterion — the `source: "board"` half, which is the primary entry point — has nothing to hook into. Without the membership seam, the spec's `Rule: Guards` access-revoked criterion has nothing to hook into.

Adding all three here — in the one task that owns the `BoardContext` SSE branch, upstream of T9, T12, and T13 — is what keeps every later task's "no changes to `BoardContext.tsx`" rule honest.

`subscribeFocusEvents(handler): () => void` mirrors the existing `subscribeTrackerEvents` on `BoardContext` exactly — a `useRef` set of handlers, a `useCallback` subscribe returning an unsubscribe, and a dispatch branch in the `EventSource` `onmessage` for `data.type === "focus_session.updated"`. Copy that shape; do not invent a second pattern.

Steps:

1. Write failing test for: `focus_session.updated` reaches subscribers and does NOT trigger a board refresh
   Test file: `client/src/context/BoardContext.focusSeams.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given a `BoardProvider` with an active workspace and a handler registered through `subscribeFocusEvents`
   When `MockEventSource` emits the literal Shared-Contract `focus_session.updated` payload
   Then:
   - the handler receives it
   - the board's debounced refresh does **not** run — this branch `return`s, unlike the `card.*` one
   And Given the handler is unsubscribed, When another such event arrives, Then it is not called

   Exercise through: the `subscribeFocusEvents` value on the context, driven by `MockEventSource`
   Test doubles: `MockEventSource` via `vi.stubGlobal`, mocked `../api`, `vi.useFakeTimers()` advanced past the debounce; do NOT mock `BoardProvider`'s `onmessage` handler
   Expected RED: `subscribeFocusEvents` is not on the context; the handler is never called

2. Run test — verify FAIL: `npm run test -- client/src/context/BoardContext.focusSeams.test.tsx`
   Expected failure: `subscribeFocusEvents is not a function`

3. Implement, then verify PASS: in `client/src/context/BoardContext.tsx`, add the `subscribeFocusEvents` field, subscriber ref, unsubscribe callback, and `focus_session.updated` branch that fans out and returns. Run `npm run test -- client/src/context/BoardContext.focusSeams.test.tsx` — expected PASS.

4. Write failing test for: `card.*` events reach subscribers without breaking the board refresh
   Test file: `client/src/context/BoardContext.focusSeams.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given a `BoardProvider` with an active workspace and handlers registered through `subscribeCardEvents` and the pre-existing `subscribeTrackerEvents`
   When a `card.updated` event `{ type: "card.updated", actor, cardId: 481, payload: { key: "CAM-42" } }` arrives
   Then the card handler receives it and the board's debounced refresh still runs — the card branch must fan out and fall through to `scheduleRefresh()`
   And Given a `tracker.updated` event `{ type: "tracker.updated", actor, trackerItemId: 77 }`, Then the card handler is not called and the tracker handler is called
   And Given a registered handler is unsubscribed, Then later events do not call it

   Exercise through: both subscription values on a real `BoardProvider`, driven by `MockEventSource` and a clock advance past the debounce
   Test doubles: `MockEventSource` via `vi.stubGlobal`, mocked `../api`, `vi.useFakeTimers()`; do NOT mock `BoardProvider`'s `onmessage` handler
   Expected RED: `subscribeCardEvents` is not on the context; the card handler is never called

5. Run test — verify FAIL: `npm run test -- client/src/context/BoardContext.focusSeams.test.tsx`
   Expected failure: `subscribeCardEvents is not a function`

6. Implement, then verify PASS: add `cardEventSubscribers`, its subscribe callback, the context field, and a `data.type.startsWith("card.")` branch that fans out and falls through to `scheduleRefresh()`. Run the seam test and then `npm run test` — both must PASS.

6a. Write/run a separate RED→implementation→PASS cycle for `card.deleted` on the real provider: Given a handler registered through `subscribeCardEvents`, When `MockEventSource` emits `{ type: "card.deleted", actor, cardId: 481, payload }`, Then the handler receives it and `scheduleRefresh()` still runs.
    Test file: `client/src/context/BoardContext.focusSeams.test.tsx`
    Level: unit (component, jsdom)
    Exercise through: `subscribeCardEvents` on a real `BoardProvider`, driven by `MockEventSource`
    Test doubles: `MockEventSource` via `vi.stubGlobal`, mocked `../api`, `vi.useFakeTimers()`; do NOT mock `BoardProvider`'s `onmessage` handler
    Expected RED: a `card.updated`-only branch never calls the subscriber. Do not treat T13's stubbed registry as covering this seam.
    Run FAIL then PASS: `npm run test -- client/src/context/BoardContext.focusSeams.test.tsx -t "card.deleted fans out"`

6b. Write/run a separate RED→implementation→PASS cycle for `tracker.deleted` on the real provider: Given a handler registered through the pre-existing `subscribeTrackerEvents`, When `{ type: "tracker.deleted", actor, trackerItemId: 77 }` arrives, Then the tracker handler is called. T13's live-delete GWTs cannot substitute for this — they stub the registry.
    Test file: `client/src/context/BoardContext.focusSeams.test.tsx`
    Level: unit (component, jsdom)
    Exercise through: `subscribeTrackerEvents` on a real `BoardProvider`, driven by `MockEventSource`
    Test doubles: `MockEventSource` via `vi.stubGlobal`, mocked `../api`; do NOT mock `onmessage`
    Expected RED: a `tracker.updated`-only branch never calls the subscriber.
    Run FAIL then PASS: `npm run test -- client/src/context/BoardContext.focusSeams.test.tsx -t "tracker.deleted fans out"`

7. Write failing test for: `membership.removed` reaches subscribers without breaking the existing workspace redirect
   Test file: `client/src/context/BoardContext.focusSeams.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given a `BoardProvider` with an active workspace and a handler registered through `subscribeMembershipEvents`
   When `{ type: "membership.removed", userId: currentUser.id, workspaceId: activeWorkspaceId, workspaceName: "Removed Workspace" }` arrives, once where `getRemovalRedirect` returns a redirect and once where it returns `null`
   Then:
   - the subscriber receives the event in both cases
   - the redirect case still shows the warning toast and switches workspace
   - a removal event for a different user does not call the subscriber

   Exercise through: the `subscribeMembershipEvents` value on a real `BoardProvider`, driven by `MockEventSource`
   Test doubles: `MockEventSource` via `vi.stubGlobal`, mocked `../api`, workspace fixtures producing both redirect outcomes; do NOT mock `getRemovalRedirect` or `BoardProvider`'s `onmessage` handler
   Expected RED: `subscribeMembershipEvents` is not on the context; the handler is never called

8. Run test — verify FAIL: `npm run test -- client/src/context/BoardContext.focusSeams.test.tsx`
   Expected failure: `subscribeMembershipEvents is not a function`

9. Implement, then verify PASS: add `membershipEventSubscribers`, its subscribe callback, the context field, and a fan-out at the **top** of the existing `membership.removed` block before `getRemovalRedirect`, without returning from the fan-out. Leave the redirect logic unchanged. Run the seam test and then `npm run test` — both must PASS.

10. Write failing test for: `Given Running session with 1200 accumulated seconds, When the app loads, Then state restores from the server`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Independent RED case A only: Given `api.focus.get` resolves a Running session, When a probe calls `useFocusSession()` during load and after resolution, Then the initial value is `session: null, loading: true` and the settled value adopts the session with `loading: false`. The null and auto-finished responses are separate cycles below.

    Exercise through: `renderHook(() => useFocusSession(), { wrapper })` where `wrapper` nests `FocusSessionProvider` inside a `BoardContext` stub
    Test doubles: mocked `../api` via `vi.hoisted`; stubbed `BoardContext` with `activeWorkspaceId`, `user`, `showToast`, `setHasActiveFocusSession`, `setFocusSessionHydrated`, and an in-memory `subscribeFocusEvents`; do NOT mock `FocusSessionProvider` or its reducer
    Expected RED: `client/src/context/FocusSessionContext.tsx` does not exist — the import fails

11. Run test — verify FAIL: `npm run test -- client/src/context/FocusSessionContext.test.tsx`
    Expected failure: `Failed to resolve import "../context/FocusSessionContext"`.

12. Implement the minimal load path, then verify PASS: create the provider, call `api.focus.get(activeWorkspaceId)` on mount, adopt the session payload, and keep `session` null while loading. Do **not** yet toast on `autoFinished` and do not implement mutation actions. Run `npm run test -- client/src/context/FocusSessionContext.test.tsx -t "restores from the server"`.

12a. Write/run a separate RED→implementation→PASS case for a successful `{ session: null }` response: the provider settles empty without an error or toast.
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)
    Exercise through: `renderHook` and a resolved `api.focus.get` response with `session: null`
    Test doubles: mocked `api.focus.get`, stubbed BoardContext, and real provider reducer
    Expected RED: the load path does not yet prove the successful empty response is silent.
    Run FAIL then PASS: `npm run test -- client/src/context/FocusSessionContext.test.tsx -t "session null silent"`

12b. Write/run a separate RED→implementation→PASS case for `autoFinished`: the provider settles empty and emits only the task-missing warning toast.
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)
    Exercise through: `renderHook` and a resolved `api.focus.get` response with `autoFinished`
    Test doubles: mocked `api.focus.get`, stubbed BoardContext `showToast`, and real provider reducer
    Expected RED: Step 12 adopted the payload without toasting, so `showToast` is not called. Do not use "provider does not exist" as this case's RED.
    Run FAIL then PASS: `npm run test -- client/src/context/FocusSessionContext.test.tsx -t "autoFinished toast"`

13. Write a separate failing test for: `Given focus GET rejects 404, When the provider loads, Then it stays silent with session null and hydration complete`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Given `api.focus.get` rejects `new ApiError("Not found", 404, "not_found")`, When the provider loads, Then no error or toast is exposed, `session` is `null`, and `setFocusSessionHydrated(true)` is called. A 404 from the disabled/non-member gate is normal absence, not a visible failure.
    Exercise through: `renderHook(() => useFocusSession(), { wrapper })` and the rejected GET promise
    Test doubles: mocked `api.focus.get`, stubbed BoardContext setters and `showToast`; do not mock the provider
    Expected RED: the provider exposes the 404 as an action/load error or never marks hydration complete.

14. Run test — verify FAIL: `npm run test -- client/src/context/FocusSessionContext.test.tsx`
    Expected failure: the 404 rejection is surfaced or hydration remains false.

15. Implement silent 404 load handling, then verify PASS: treat only GET 404 as an empty session, preserve unexpected errors, and mark the workspace hydrated in a `finally` path. Run `npm run test -- client/src/context/FocusSessionContext.test.tsx`.

16. Write a separate failing test for: `Given the active workspace changes, When the new GET is pending, Then the old session is cleared and focus hydration is unknown`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: integration (hook, jsdom)

    Test intent:
    Given a loaded session in workspace 3, When `activeWorkspaceId` changes to 4 and `api.focus.get(4)` is pending, Then the provider immediately exposes `session: null`, `loading: true`, calls `setHasActiveFocusSession(false)`, and calls `setFocusSessionHydrated(false)`; it must not expose workspace 3's session. This is one workspace-change GWT. A separate stale-response test then resolves workspace 3 late and proves it is ignored, while workspace 4 is adopted and hydration becomes true.
    Exercise through: `renderHook` with a rerender that changes `activeWorkspaceId`, followed by controlled promise resolution
    Test doubles: deferred `api.focus.get` promises keyed by workspace id; stubbed BoardContext flags/setters; do not mock the provider
    Expected RED: the provider only loads on mount and leaves stale workspace-3 state visible.

17. Run test — verify FAIL: `npm run test -- client/src/context/FocusSessionContext.test.tsx`
    Expected failure: the old session remains or the hydration setter is not driven.

18. Implement workspace-scoped hydration, then verify PASS: T7 owns the `focusSessionHydrated` and `hasActiveFocusSession` state/setters exposed by `BoardContext`; key the load effect by `activeWorkspaceId`, clear state before each load, invalidate late responses, set `focusSessionHydrated(false)` before the request and true after success/404, and clear both parent flags on unmount. T12 consumes these fields and must not redefine them. Run `npm run test -- client/src/context/FocusSessionContext.test.tsx`.

19. Write failing test for: provider exposes `focus()` and `switchTo()` with the server's POST contract
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Independent GWT case A: Given no current session, When `focus({ source: "board", taskId: 481 })` runs, Then `api.focus.post(3, { action: "focus", source: "board", taskId: 481 })` is called and Ready is adopted. Independent GWT case B: Given an active session on task A at version 2, When `switchTo({ source: "tracker", taskId: 77, version: 2 })` runs, Then the switch POST contract is used and Ready task 77 is adopted.
    Exercise through: `renderHook` actions and observed provider state
    Test doubles: mocked `api.focus.post`, stubbed BoardContext with active workspace and session flags; do not mock action functions
    Expected RED: the provider has no POST action functions yet.

20. Run test — verify FAIL: `npm run test -- client/src/context/FocusSessionContext.test.tsx`
    Expected failure: `focus` or `switchTo` is undefined.

21. Implement the parameterized POST action path, then verify PASS: expose `focus` and `switchTo`, adopt successful `{ session }` without optimistic state, and keep the active workspace in every request. Run `npm run test -- client/src/context/FocusSessionContext.test.tsx`.

22. Write failing test for: lifecycle actions drive the server and adopt its response
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Independent GWT cases for `start`, `pause`, and `resume`: each sends its own action with the current version and adopts the returned session. A separate finish case verifies that `finish()` returns the finished payload while storing `session: null` and clearing the active-session flag. Do not combine lifecycle actions into one assertion.
    Exercise through: `renderHook` and one provider action per test case
    Test doubles: mocked `api.focus.patch` with action-specific responses; stubbed BoardContext setters; do not mock the provider
    Expected RED: lifecycle action functions are absent.

23. Run test — verify FAIL: `npm run test -- client/src/context/FocusSessionContext.test.tsx`
    Expected failure: lifecycle callbacks are undefined.

24. Implement the parameterized PATCH lifecycle path, then verify PASS: route all four actions through one runner, never update optimistically, and special-case finish to return the server payload while storing null. Run `npm run test -- client/src/context/FocusSessionContext.test.tsx`.

25. Write failing test for: `Given Ready, When Start fails 5xx, Then stays Ready and exposes a retryable error`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Given Ready with `runningSince: null`, `api.focus.patch` rejects status 500. Then the session remains Ready, no timer state is invented, `actionError` is exposed, and a later `start()` can be attempted again.
    Exercise through: `renderHook` and the `start()` action, then a second retry
    Test doubles: mocked `api.focus.patch` that rejects once with status 500 and resolves on retry; stubbed BoardContext; do not mock the provider
    Expected RED: the rejection escapes or no retryable error state exists.

26. Run test — verify FAIL: `npm run test -- client/src/context/FocusSessionContext.test.tsx`
    Expected failure: unhandled rejection or missing `actionError`.

27. Implement retryable 5xx handling, then verify PASS: catch mutation failures into `actionError`, preserve the last server session, allow retry, and keep the error clear on success. Run `npm run test -- client/src/context/FocusSessionContext.test.tsx`.

28. Write failing test for: `Given stale version, When mutation, Then version_conflict adopts the body session silently`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Given version 3 and a `409 { code: "version_conflict", session: <version 4> }`, `resume()` adopts version 4 without a GET round trip or user-facing error, and the next action sends version 4.
    Exercise through: `renderHook`, `resume()`, and the subsequent lifecycle action
    Test doubles: mocked `api.focus.patch` rejecting with an `ApiError` carrying status 409, code, and body session; no GET fallback; do not mock the provider
    Expected RED: `ApiError` lacks the body session or treats the conflict as a generic error.

29. Run test — verify FAIL: `npm run test -- client/src/context/FocusSessionContext.test.tsx`
    Expected failure: the stale session remains or a visible error appears.

30. Implement `version_conflict` recovery, then verify PASS: extend `ApiError`/`request()` with the response session, adopt it, clear `actionError`, and resolve the conflict path without surfacing it. Run `npm run test -- client/src/context/FocusSessionContext.test.tsx`.

31. Write a separate failing test for: `Given focus() receives 409 session_active, When the caller handles it, Then the provider adopts the current session and preserves the typed conflict`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)

    Test intent:
    Given no local session and `focus()` rejects `409 { code: "session_active", session: <task A> }`, Then the provider adopts task A and rethrows the typed `ApiError` with `code: "session_active"` so T10 can show its confirmation dialog. This is intentionally different from `version_conflict`, which is reconciled silently.
    Exercise through: `renderHook` and the rejected `focus()` promise
    Test doubles: mocked `api.focus.post` rejecting with a typed `ApiError` containing the current session; stubbed BoardContext; do not mock the provider
    Expected RED: the provider swallows both 409 codes identically or loses the embedded session.

32. Run test — verify FAIL: `npm run test -- client/src/context/FocusSessionContext.test.tsx`
    Expected failure: the conflict code is lost or the caller cannot distinguish it.

33. Implement the explicit 409 split, then verify PASS: `version_conflict` resolves after adoption; `session_active` adopts the session, clears stale local state, and rethrows without a generic error toast. Run `npm run test -- client/src/context/FocusSessionContext.test.tsx`.

33a. Write/run a separate RED→implementation→PASS cycle for POST `switchTo` `version_conflict`: Given an active session at version 2, When `switchTo(...)` rejects `409 { code: "version_conflict", session: <version 4> }`, Then the provider adopts version 4 silently (same as PATCH `resume()`), clears `actionError`, and the next action sends version 4. A POST runner that does not share the PATCH conflict branch would surface a generic error on confirm-switch.
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: unit (hook, jsdom)
    Exercise through: `renderHook` and the rejected `switchTo()` promise
    Test doubles: mocked `api.focus.post` rejecting with a typed `ApiError` containing status 409, `code: "version_conflict"`, and body session; do not mock the provider
    Expected RED: only the PATCH path adopts the 409 body, so `switchTo` leaves the stale session or exposes a generic error.
    Run FAIL then PASS: `npm run test -- client/src/context/FocusSessionContext.test.tsx -t "switchTo version_conflict"`

34. Write failing test for SSE Case A only: `Given Running in tab A, When tab B pauses, Then tab A shows Paused`
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: integration

    Test intent:
    Given a Running session for user 7 in workspace 3, When the in-memory `subscribeFocusEvents` registry delivers `{ type: "focus_session.updated", userId: 7, workspaceId: 3, payload: { session: <Paused> } }`, Then the provider shows Paused with the event's duration and `api.focus.get` is not called. This cycle proves only the matching-user pause-sync path.

    Exercise through: `renderHook`, the real `subscribeFocusEvents` callback registry, and controlled event delivery
    Test doubles: stubbed BoardContext with `user.id`, `activeWorkspaceId`, and an in-memory subscriber; mocked `api.focus.get` asserted not called; do not mock the provider event handler
    Expected RED: the provider does not subscribe, so a matching Paused event does not change state

35. Run test — verify FAIL for SSE Case A only: `npm run test -- client/src/context/FocusSessionContext.test.tsx -t "tab B pauses"`
    Expected failure: delivered matching events do not change the provider.

36. Implement subscribe/unsubscribe through `BoardContext` and apply a matching-user `payload.session`. Do not yet handle `payload.session: null` or other `userId`s as part of this cycle. Run PASS: `npm run test -- client/src/context/FocusSessionContext.test.tsx -t "tab B pauses"`.

36a. Write a failing test for SSE Case B only: matching-user `payload.session: null` clears local state
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: integration
    Test intent: Given a populated session for user 7, When a matching `focus_session.updated` arrives with `payload.session: null`, Then `session` becomes null and no refetch runs.
    Exercise through: the same `subscribeFocusEvents` registry
    Test doubles: stubbed BoardContext subscriber; mocked `api.focus.get` asserted not called; do not mock the handler
    Expected RED: the Case A applier ignores null payloads or treats them as a no-op, so `session` stays populated. Do not use "no subscription exists" as Case B's RED.

36b. Run test — verify FAIL for Case B only: `npm run test -- client/src/context/FocusSessionContext.test.tsx -t "payload.session null"`
    Expected failure: the populated session remains after a null payload.

36c. Implement null-payload clearing, then verify PASS: `npm run test -- client/src/context/FocusSessionContext.test.tsx -t "payload.session null"`

36d. Write a failing test for SSE Case C only: another user's event must not change local state
    Test file: `client/src/context/FocusSessionContext.test.tsx`
    Level: integration
    Test intent: Given a Running session for user 7, When `focus_session.updated` arrives with `userId: 9` and a Paused payload, Then the current session is unchanged and no refetch runs.
    Exercise through: the same `subscribeFocusEvents` registry
    Test doubles: stubbed BoardContext with `user.id: 7`; mocked `api.focus.get` asserted not called
    Expected RED: the Case A/B applier does not filter on `event.userId === user.id`, so user 9's event is applied. Do not use "no subscription exists" as Case C's RED — that would already pass.

36e. Run test — verify FAIL for Case C only: `npm run test -- client/src/context/FocusSessionContext.test.tsx -t "other user focus event"`
    Expected failure: user 9's event changes the current session.

36f. Implement the `event.userId === user.id` privacy filter, then verify PASS: `npm run test -- client/src/context/FocusSessionContext.test.tsx -t "other user focus event"`. Re-run Cases A and B `-t` filters so they stay PASS. Keep the provider on the current workspace.

37. Refactor while green (bounded):
    - Rule of three: route the four PATCH lifecycle actions through one parameterized `runPatchAction(action)` helper, and keep POST `focus`/`switchTo` parameterized with one explicit 409 split
    - Three new subscriber registries now sit beside the existing tracker one, so extract a named `createSubscriberRegistry()` helper inside `BoardContext.tsx` and use it for all four. The real-provider coverage is in Steps 1, 4, and 7, including the pre-existing tracker seam.
    - `BoardContext.tsx` is ~742 lines: add only the three subscriber registries, callbacks, focus/card branches, membership fan-out, the focus flags/setters, and context fields. T7 owns these parent fields; no focus business logic belongs there.
    - Keep `FocusSessionContext.tsx` under ~300 lines.
    - Re-run `npm run test -- client/src/context/FocusSessionContext.test.tsx`, `npm run test -- client/src/context/BoardContext.focusSeams.test.tsx`, and the full client suite — all must stay PASS.

38. Mount the provider: in `client/src/App.tsx`, wrap the authenticated router in `<FocusSessionProvider>` inside `BoardProvider`. Verify: `npm run test` and `npm run typecheck --workspace=client`.

39. Commit:
    `git add client/src/types.ts client/src/api.ts client/src/context/BoardContext.tsx client/src/context/BoardContext.focusSeams.test.tsx client/src/context/FocusSessionContext.tsx client/src/context/FocusSessionContext.test.tsx client/src/App.tsx`
    `git commit -m "feat(focus): add focus session provider and SSE seams"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Concurrency (both criteria); rule: Lifecycle (`✗ Start fails 5xx`, `✓ refresh restores state`); "Story: Cross-tab and cross-device sync"; Design Decision → Sync row ("payload includes `userId` — client **must** filter to current user")
- `client/src/context/BoardContext.tsx` (lines ~57, ~123, ~542–559, ~575–585, ~731) — `TrackerEventHandler`, `subscribeTrackerEvents`, the `onmessage` dispatch branch this task mirrors, and the `membership.removed` block whose conditional `return` dictates where the membership fan-out must sit
- `client/src/hooks/useNotifications.ts` + `useNotifications.test.ts` — hook + `MockEventSource` testing convention
- `client/src/pages/TrackerDetailPage.test.tsx` — `vi.hoisted` API-mocking convention
- `client/src/api.ts` — `request<T>` helper and `ApiError` (carries `status` and `code`)
- `client/src/types.ts` — `WorkItemSource` already exists as `"board" | "tracker"`; reuse it rather than declaring a second union

## WHY THIS APPROACH

Complexity: standard
Justification: seven files, and the provider is the single point where three failure modes converge — action rejection, version conflict, and a workspace-wide broadcast that must be filtered by user. Every downstream UI task assumes this behaves correctly.

## SANDWICH CONTEXT

[CRITICAL: `focus_session.updated` is broadcast to the whole workspace. The hook MUST ignore any event whose `userId` is not the current user's. Without that filter, one member's focus session appears in another member's UI — the exact "shared/workspace-wide focus" outcome the spec puts out of scope.]

You are implementing the client focus session model for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — server-authoritative session; the client adopts server payloads and never invents state optimistically.
Files in scope: `client/src/types.ts`, `client/src/api.ts`, `client/src/context/BoardContext.tsx`, `client/src/context/BoardContext.focusSeams.test.tsx`, `client/src/context/FocusSessionContext.tsx`, `client/src/context/FocusSessionContext.test.tsx`, `client/src/App.tsx` — no other files.
Test framework: Vitest + `@testing-library/react`, jsdom. Single file: `npm run test -- client/src/context/FocusSessionContext.test.tsx`.
Available after: T6 (full server API incl. `switch`), T3 (`focusModeEnabled` on `BoardContext`).
Architecture rule: client imports carry NO file extension. `noUnusedLocals` / `noUnusedParameters` are on — an unused import fails typecheck. React hooks rules (`useExhaustiveDependencies`, `useHookAtTopLevel`) are enforced in `client/src/`. Do not add focus logic to `BoardContext.tsx` beyond the SSE fan-out.

[RESTATE: filter every `focus_session.updated` event on `userId === user.id` — a workspace broadcast must never leak another member's session into this UI.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a Running session with 1200 accumulated seconds, When the hook mounts, Then state and duration restore from the server response
Given two tabs and a Running session, When a `focus_session.updated` event for this user arrives with a Paused session, Then the hook shows Paused with the correct duration and issues no refetch
Given a stale version, When an action returns 409, Then the hook adopts the session from the 409 body and the next action sends the new version
Given a Ready session, When Start rejects with 5xx, Then the session stays Ready, no timer state is invented, and a retryable error is exposed
[derived] Given `api.focus.get` resolves `{ session: null }`, When the provider mounts, Then `session` is `null` and no error is surfaced
[derived] Given the load response carries `autoFinished: { reason: "task_missing" }`, When the provider mounts, Then `session` is `null` AND a task-missing warning toast is shown
[derived] Given `finish()` resolves a finished session, When it settles, Then the provider's `session` is `null` — the finished payload is returned to the caller, not stored
[derived] Given an event with `payload.session: null`, When it arrives for this user, Then `session` becomes `null`
[derived] Given a handler registered via `subscribeCardEvents`, When a `card.updated` event arrives, Then the handler is called AND the board's debounced refresh still runs
[derived] Given a handler registered via `subscribeCardEvents` on a real `BoardProvider`, When `card.deleted` arrives, Then the handler is called AND the board refresh still runs
[derived] Given a handler registered via the pre-existing `subscribeTrackerEvents`, When a `tracker.updated` event arrives, Then it still receives the event after the Step 24 registry extraction
[derived] Given a handler registered via `subscribeTrackerEvents` on a real `BoardProvider`, When `tracker.deleted` arrives, Then the tracker handler is called
[derived] Given `switchTo()` rejects `409 { code: "version_conflict", session }`, When it settles, Then the provider adopts the body session the same way PATCH `resume()` does
[derived] Given a handler registered via `subscribeFocusEvents`, When a `focus_session.updated` event arrives at a real `BoardProvider`, Then the handler is called AND no board refresh is scheduled
[derived] Given a handler registered via `subscribeMembershipEvents`, When a `membership.removed` for this user arrives and `getRemovalRedirect` yields a redirect, Then the handler is called AND the removal toast and workspace switch still happen
[derived] Given the same event where `getRemovalRedirect` yields `null`, When it arrives, Then the handler is still called
[must-not] Given a `card.*` event, When it is fanned out, Then the branch must NOT return early — doing so stops the board refreshing on every card change
[must-not] Given a `membership.removed` event, When the fan-out is placed, Then it must NOT sit after `getRemovalRedirect` — on the redirect path the existing `return` would skip it, leaving the seam dead in production while tests pass on the other path
[must-not] Given a `focus_session.updated` event whose `userId` differs from the current user, When it arrives, Then local session state must NOT change
[must-not] Given any lifecycle action, When it is invoked, Then the hook must NOT apply an optimistic state change before the server responds

All tests PASS. Commit exists with message matching `feat(focus): add focus session provider and SSE seams`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- `userId` filter on every incoming focus event
- Server payloads adopted verbatim; no optimistic session construction — except `finish()`, after which `session` is `null` rather than the finished row
- A load response carrying `autoFinished` produces a user-visible warning
- 409 recovery reads the session from the response body — no second round trip — for PATCH lifecycle actions **and** POST `switchTo`
- The focus SSE branch in `BoardContext` returns early, so a focus event does not also schedule a board refresh
- The `card.*` branch does the opposite — it fans out `card.updated` **and** `card.deleted` and then falls through to `scheduleRefresh()`
- `subscribeTrackerEvents` receives `tracker.deleted` from a real `BoardProvider`, not only `tracker.updated`
- The `membership.removed` fan-out runs at the TOP of the existing block, before `getRemovalRedirect`, so it fires on both the redirect and the no-redirect path
- All three seams are delivered by this task, so T9 and T13 never need to touch `BoardContext.tsx`
- `subscribeFocusEvents` returns an unsubscribe function and the provider calls it on unmount
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — one parameterized action runner, not four copies
- `useFocusSession()` throws outside the provider, matching `useBoard()`
- Commit message follows conventional commits format

Must-not-have:
- Any presentational UI — the provider renders only `children`; the timer, page, indicator, and entry button are T8–T11
- Focus API calls from anywhere but this provider
- `localStorage` or any browser-local persistence of session state — the server is the authority (Option C was rejected for exactly this)
- Focus business logic inside `BoardContext.tsx`
- A second `"board" | "tracker"` union — reuse `WorkItemSource`

Open question risks:
- Assumption: the 409 body always carries the current session (T5/T6 contract). If it can be absent, the hook needs a refetch fallback → report NEEDS_CONTEXT rather than silently adding one.

Rollback note:
- With `FOCUS_MODE_ENABLED=false` the API 404s. The hook must treat a 404 on load as "no session" and stay silent, not as an error.

Red flags:
- Work outside the seven listed files → DONE_WITH_CONCERNS
- A missing `userId` filter → STOP
- Optimistic state updates → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: the 409-carries-session assumption proves wrong
Escalate when: cross-tab sync appears to require a second EventSource, or session state appears to need browser-local persistence

---
### Task 8: `FocusTimer` — duration display + lifecycle controls [depends: T7]

## OBJECTIVE

Build the presentational timer component: it renders active time from `accumulatedSeconds` + `runningSince`, ticks once per second while Running, stays static while Ready or Paused, and renders the controls legal for the current state.

Files:
- Create: `client/src/components/FocusTimer.tsx`
- Test: `client/src/components/FocusTimer.test.tsx`

Props only — no data fetching, no `useFocusSession` call. The page (T9) wires the hook to this component. That is what makes every timing assertion here deterministic.

```
type FocusTimerProps = {
  session: FocusSession;
  onStart: () => void; onPause: () => void; onResume: () => void; onFinish: () => void;
  pending?: boolean;
};
```

Steps:

1. Write failing test for: a Running session's display advances with the clock
   Test file: `client/src/components/FocusTimer.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given `vi.useFakeTimers()` with system time at `T0`, and a session whose `runningSince` is the **ISO string** the server sends (`T0.toISOString()`) — matching the Shared Contract DTO and every other timestamp in `client/src/types.ts` — so `{ state: "running", accumulatedSeconds: 1200, runningSince: "<T0 ISO>" }`
   When the component renders and the clock advances 90 seconds
   Then:
   - the initial display reads `20:00` (1200s)
   - after the advance it reads `21:30` (1290s) — derived from `runningSince`, never from counting ticks, so a throttled background tab still shows the right number
   - the format is `MM:SS` under an hour and `H:MM:SS` at or above it

   Exercise through:
   - the rendered output, queried by `screen.getByText` / a `data-testid` on the duration element

   Test doubles:
   - `vi.useFakeTimers()` + `vi.setSystemTime()`; restore with `vi.useRealTimers()` in `afterEach`
   - do NOT mock: the component's own duration computation

   Expected RED:
   - `client/src/components/FocusTimer.tsx` does not exist

2. Run test — verify FAIL: `npm run test -- client/src/components/FocusTimer.test.tsx`
   Expected failure: `Failed to resolve import "./FocusTimer"`

3. Implement minimal code to satisfy the test:
   File: `client/src/components/FocusTimer.tsx` — a `useEffect` interval that only bumps a re-render counter while `state === "running"`, with the displayed value computed each render as `accumulatedSeconds + (now - Date.parse(runningSince)) / 1000`. Parse the ISO string; do not type the prop as a `Date`. A `Date`-typed fixture would make this cycle pass on a shape the server never sends, and the live display would render `NaN`. Clear the interval on unmount and whenever state leaves Running.

4. Run test — verify PASS: `npm run test -- client/src/components/FocusTimer.test.tsx`

5. Write failing test for: a Paused session does not advance
   Test file: `client/src/components/FocusTimer.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Independent RED case B: Given `{ state: "paused", accumulatedSeconds: 900, runningSince: null }`, When 10 minutes of fake time pass, Then the display still reads `15:00` and no interval remains scheduled (`vi.getTimerCount()` is 0). Ready is a separate case below.

   Exercise through: rendered output plus `vi.getTimerCount()`
   Test doubles: fake timers
   Expected RED: the interval runs regardless of state, or the paused display drifts

6. Run test — verify FAIL for the Paused case, gate the interval on `state === "running"`, then verify PASS for that case: `npm run test -- client/src/components/FocusTimer.test.tsx -t "Paused"`

6a. Write/run a separate RED→implementation→PASS case for Ready: `{ state: "ready", accumulatedSeconds: 0, runningSince: null }` renders `00:00` and schedules no interval.
    Test file: `client/src/components/FocusTimer.test.tsx`
    Level: unit (component, jsdom)
    Exercise through: rendered Ready timer and `vi.getTimerCount()`
    Test doubles: fake timers with system time fixed; do not mock the component
    Expected RED: the component still schedules an interval or does not render the Ready duration.
    Run test after implementation: `npm run test -- client/src/components/FocusTimer.test.tsx -t "Ready"`

7. Write independent failing test cases for: controls match each session state
   Test file: `client/src/components/FocusTimer.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Three independent GWT cases with separate test names: Ready renders **Start** only; Running renders **Pause** and **Finish focus**; Paused renders **Resume** and **Finish focus**. Each case separately asserts its legal callback fires once and illegal controls are absent. A fourth independent case sets `pending: true` and asserts every rendered control is disabled.

   Copy is fixed by the spec: **"Start"**, **"Pause"**, **"Resume"**, **"Finish focus"**. Not "Commit", not "Stop", not "Complete".

   Exercise through: `screen.getByRole("button", { name: ... })` and `fireEvent.click`
   Test doubles: `vi.fn()` callbacks
   Expected RED: controls are not rendered

8. Run test — verify FAIL for each state-specific control case, implement the controls, then verify PASS for each case and the pending case: `npm run test -- client/src/components/FocusTimer.test.tsx`.

9. Refactor while green (bounded):
   - Rule of three: the seconds → `MM:SS` formatter belongs in a named helper. Check `client/src/lib/` first — if nothing suitable exists, create the mapped `client/src/lib/focusDuration.ts` with `formatDuration(seconds)` and `client/src/lib/focusDuration.test.ts`. Never a generic `utils.ts`
   - Keep `FocusTimer.tsx` under ~300 lines and the component under ~50 lines of JSX
   - Re-run `npm run test -- client/src/components/FocusTimer.test.tsx` — must stay PASS

10. Commit:
    `git add client/src/components/FocusTimer.tsx client/src/components/FocusTimer.test.tsx`
    If Step 9 extracted `client/src/lib/focusDuration.ts` and its test, additionally run `git add client/src/lib/focusDuration.ts client/src/lib/focusDuration.test.ts` before committing.
    `git commit -m "feat(focus): add focus timer display and lifecycle controls"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Lifecycle; Design Decision → Timer display row ("client ticks from server `accumulated_seconds` + `running_since` when Running; reconcile on SSE/refresh"); Implementation Notes on user-facing copy ("Start", "Pause", "Resume", "Finish focus" — avoid "Commit" in UI)
- `docs/pocket/rule/creative-brief.md` — **design authority**. Button — Primary (`bg-primary-600`, white text, hover `primary-700`, focus ring `2px primary-600 offset 2px`), Button — Secondary (`bg-neutral-100`, `text-primary-700`, `border-neutral-300`), disabled (`bg-neutral-200`, `text-neutral-400`, `cursor-not-allowed`). Type scale: `xl` 31px for the duration readout, `sm` 13px for labels. Radius 6px. Tone: calm, neutral-friendly
- `client/src/index.css` — the `@theme` block exposing these as Tailwind v4 utilities (`bg-primary-600`, `text-neutral-700`, `font-sans` = Work Sans)
- `client/src/pages/TrackerDetailPage.tsx` (lines ~405–420) — existing button styling in this codebase
- `client/src/types.ts` — `FocusSession` from T7

## WHY THIS APPROACH

Complexity: lightweight
Justification: one component file plus its test, props-driven with no data access. The only subtlety — derive from `runningSince` rather than counting ticks — is stated explicitly above.

## SANDWICH CONTEXT

[CRITICAL: the displayed duration is computed from `runningSince` on every render, never accumulated by counting interval fires. Browsers throttle timers in background tabs; a tick-counting timer silently under-reports the user's work, which destroys the "trustworthy active time" the whole feature exists to provide.]

You are implementing the focus timer component for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — the server owns `accumulated_seconds` + `running_since`; the client renders from them and reconciles on SSE or refresh.
Files in scope: `client/src/components/FocusTimer.tsx`, `client/src/components/FocusTimer.test.tsx` — no other files (plus a duration-formatter extraction if Step 9 triggers one).
Test framework: Vitest + `@testing-library/react`, jsdom, `vi.useFakeTimers()`. Single file: `npm run test -- client/src/components/FocusTimer.test.tsx`.
Available after: T7 (`FocusSession` type).
Architecture rule: presentational only — no `useFocusSession`, no `api` import, no routing. Client imports carry no extension. `noUnusedLocals` is on. UI decisions come from `docs/pocket/rule/creative-brief.md`; do not invent colors, radii, or type sizes.

[RESTATE: compute the duration from `runningSince` each render — never by counting interval fires.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a Running session at 1200 accumulated seconds, When 90 seconds pass, Then the display reads 21:30
Given a Paused session at 900 seconds, When 10 minutes pass, Then the display still reads 15:00
[derived] Given a Ready session, When rendered, Then the display reads 00:00 and only a **Start** control is offered
[derived] Given a Running session, When rendered, Then **Pause** and **Finish focus** are offered and each fires its callback once on click
[derived] Given a Paused session, When rendered, Then **Resume** and **Finish focus** are offered
[derived] Given `pending: true`, When rendered, Then every control is disabled
[must-not] Given a Paused or Ready session, When time passes, Then the component must NOT keep an interval scheduled
[must-not] Given any state, When controls render, Then an action illegal from that state must NOT be offered

All tests PASS. Commit exists with message matching `feat(focus): add focus timer display and lifecycle controls`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Duration derived from `runningSince`, not from tick counting
- Interval cleared on unmount and whenever state leaves Running
- Exact spec copy: "Start", "Pause", "Resume", "Finish focus"
- Colors, type sizes, radius, and focus rings taken from `docs/pocket/rule/creative-brief.md` via the `@theme` utilities in `client/src/index.css`
- Controls reachable by `getByRole("button", { name })` — accessible names, not icon-only buttons
- Tests written BEFORE implementation (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- Any `api` call or `useFocusSession` usage — this component is props-driven
- Task fields beyond what the timer needs: no status, labels, assignees, due date, comments, or checklist
- A surveillance-style presentation — no idle-time callouts, no productivity scoring (explicitly out of scope)
- Hard-coded hex colors or arbitrary font sizes outside the brief's scale
- The word "Commit" in any user-facing string

Open question risks:
- Assumption: a one-second tick is enough. If the design later wants sub-second precision, only the interval changes → not a blocker.

Rollback note:
- Pure presentational component; deleting the file is a complete rollback.

Red flags:
- Work outside the two listed files → DONE_WITH_CONCERNS
- Tick-counted duration → STOP
- Colors or sizes invented outside the creative brief → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: the brief has no token for something the timer needs
Escalate when: rendering correctly appears to require the hook or an API call

---
### Task 9: `/focus` route + `FocusPage` [depends: T8]

## OBJECTIVE

Add the `/focus` route and the focus surface itself: redirect away when there is no session, load the committed task by `source`, show title and description and nothing else, mount `FocusTimer`, surface action errors, and navigate back to `returnPath` on Finish.

Files:
- Create: `client/src/pages/FocusPage.tsx`
- Modify: `client/src/App.tsx`
- Test: `client/src/pages/FocusPage.test.tsx`

Steps:

1. Write failing test for: `Given no active session and hydration complete, When /focus is opened directly, Then redirect to /board`
   Test file: `client/src/pages/FocusPage.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Independent RED case A: Given `useFocusSession` reports `{ session: null, loading: false }`, When `FocusPage` renders, Then `navigate("/board", { replace: true })` is called and no error is shown. The loading guard is a separate case below.

   Exercise through:
   - the rendered page plus the mocked `useNavigate` spy

   Test doubles:
   - mock `../context/FocusSessionContext` via `vi.hoisted`
   - mock `react-router`'s `useNavigate` (the `mockNavigate` pattern in `client/src/pages/TrackerDetailPage.test.tsx`)
   - mock `../api`
   - do NOT mock: `FocusPage` or `FocusTimer`

   Expected RED:
   - `client/src/pages/FocusPage.tsx` does not exist

2. Run test — verify FAIL: `npm run test -- client/src/pages/FocusPage.test.tsx`
   Expected failure: `Failed to resolve import "./FocusPage"`

3. Implement minimal code to satisfy RED case A:
   File: `client/src/pages/FocusPage.tsx` — the `useFocusSession()` call and the redirect effect gated on `!loading && session === null`.

   **The redirect effect must not fire on a finish.** Since `finish()` makes `session` become `null` (Shared Contract), the "no session → go to `/board`" effect and the "finished → go to `returnPath`" navigation in Step 11 now key on the *same* state transition, and which one wins is a race the test harness can hide. Gate the effect against it from the start — set a ref immediately before calling `finish()` and have the effect skip while it is set — rather than discovering it when a user lands on `/board` instead of the card they came from.

4. Run test — verify PASS for the no-session case: `npm run test -- client/src/pages/FocusPage.test.tsx -t "no active session"`

4a. Write/run a separate RED→implementation→PASS case for `{ session: null, loading: true }`: no redirect fires while hydration is pending. Keep the effect gated on `!loading`.
    Test file: `client/src/pages/FocusPage.test.tsx`
    Level: unit (component, jsdom)
    Exercise through: rendered `FocusPage` and the mocked `useNavigate` spy while the provider reports loading
    Test doubles: mocked `useFocusSession` with `session: null, loading: true`, mocked `useNavigate`; do not mock the redirect effect
    Expected RED: the page redirects during initial hydration.
    Run test after implementation: `npm run test -- client/src/pages/FocusPage.test.tsx -t "loading"`

5. Write failing test for: `Given a board-sourced focus session, When the surface loads, Then the card title and description are visible`
   Test file: `client/src/pages/FocusPage.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given a session with `source: "board"`, `taskId: 481`
   When the page renders
   Then `api.getCard(workspaceId, 481)` was called — not `api.getWorkItem`, and not a lookup through `BoardContext.columns` — and the card's title and description are rendered
   Loading the task by `(source, id)` rather than by key alone is an ADR #103 requirement, not a style choice.

   Exercise through: rendered output plus the API mocks' call arguments
   Test doubles: mocked `../api`, mocked `useFocusSession` returning a loaded board session, mocked `useNavigate`
   Expected RED: the page renders no task content and calls no board-card API

6. Run test — verify FAIL: `npm run test -- client/src/pages/FocusPage.test.tsx`
   Expected failure: the page does not call `api.getCard` or render the card fields.

7. Implement the board task load, then verify PASS: call `api.getCard(workspaceId, session.taskId)` and render only its title/description data. Run `npm run test -- client/src/pages/FocusPage.test.tsx`.

8. Write a separate failing test for: `Given a tracker-sourced focus session, When the surface loads, Then the tracker title and description are visible`
   Test file: `client/src/pages/FocusPage.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given `source: "tracker"`, `taskKey: "CAM-42"`, Then `api.getWorkItem(workspaceId, "CAM-42")` is called and the item's title and description render; `api.getCard` is not called.
   Exercise through: rendered `FocusPage` and the tracker API call arguments
   Test doubles: mocked `api.getWorkItem`, mocked `useFocusSession` with a tracker session, and mocked `useNavigate`; do not mock the source branch
   Expected RED: only the board source branch exists.

9. Run test — verify FAIL: `npm run test -- client/src/pages/FocusPage.test.tsx`
   Expected failure: the tracker task is not loaded.

10. Implement the tracker task load, then verify PASS: branch on `source` and use the stored tracker key. Run `npm run test -- client/src/pages/FocusPage.test.tsx`.

11. Write a separate failing test for: `Given task loading fails, When the surface renders, Then a calm error and route back are available`
    Test file: `client/src/pages/FocusPage.test.tsx`
    Level: unit (component, jsdom)

    Test intent:
    Independent RED case A: Given a board task request rejects, Then the page does not crash, shows the creative-brief error register, and exposes a control that navigates back to `/board`. Add an independent tracker rejection case with its own test name and assertion; do not combine the two source failures.
    Exercise through: rendered page after a rejected `api.getCard` or `api.getWorkItem` promise
    Test doubles: mocked API rejection per source, mocked `useFocusSession`, mocked `useNavigate`; do not mock the page error branch
    Expected RED: rejected task loads are unhandled.

12. Run test — verify FAIL: `npm run test -- client/src/pages/FocusPage.test.tsx`
    Expected failure: the rejected promise produces no calm error state.

13. Implement task-load error state, then verify PASS: catch the request failure, render the error and a `/board` route-back control, and keep the provider session intact. Run `npm run test -- client/src/pages/FocusPage.test.tsx`.

14. Write failing test for: v1 shows only title, description, and timer/controls
   Test file: `client/src/pages/FocusPage.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given a fully populated task — status, priority, labels, assignees, due date, comments, checklist all present on the loaded object
   When the page renders
   Then:
   - title, description, and the timer controls are present
   - the status name, priority name, every label name, every assignee name, and the due date are **absent** from the document
   - no activity or changelog section is rendered

   This is the spec's confirmed v1 scope. It is asserted as an absence because "we just did not build it yet" and "we deliberately keep it out" look identical until something tests it.

   Exercise through: `screen.queryByText` assertions on the rendered document
   Test doubles: mocked `../api` returning a task with every field populated
   Expected RED: fields other than title and description leak into the render

15. Run test — verify FAIL: `npm run test -- client/src/pages/FocusPage.test.tsx`
    Expected failure: fields outside the v1 scope leak into the render.

16. Restrict the render, then verify PASS: keep only title, description, and the explicit `FocusTimer` mount; run `npm run test -- client/src/pages/FocusPage.test.tsx`.

17. Write failing test for SSE Case A only: board-sourced title refreshes in place on `/focus`
   Test file: `client/src/pages/FocusPage.test.tsx`
   Level: integration

   This is the second cross-unit scenario from Phase 3 Rule 6: the workspace SSE stream must refresh focus content without unmounting the focus surface.

   Test intent:
   Given a board-sourced page showing task T with title "Old title", When the real-shape `card.updated` event `{ type: "card.updated", actor, cardId: 481, payload: { key: "CAM-42" } }` arrives through `subscribeCardEvents`, Then the title becomes "New title", navigation does not occur, and the timer identity is preserved. Tracker refresh is a separate cycle below.

   Exercise through: the same context subscription seam the page uses in production; deliver the literal event payload shape, not a component internal
   Test doubles: test-controlled `subscribeCardEvents` registry on the stubbed `BoardContext`; mocked `../api` with call-ordered `getCard` responses; do NOT mock the page's own refresh handler
   Expected RED: the title stays "Old title" — the page does not subscribe to card updates

18. Run test — verify FAIL for Case A only: `npm run test -- client/src/pages/FocusPage.test.tsx -t "card.updated refreshes title"`
    Expected failure: the title stays stale and the timer is not proven to remain mounted.

19. Implement the board in-place refresh only: subscribe through `subscribeCardEvents`, reload only the card data, preserve the `FocusTimer` element identity. Do not yet subscribe to tracker updates. Run PASS: `npm run test -- client/src/pages/FocusPage.test.tsx -t "card.updated refreshes title"`.

19a. Write a failing test for SSE Case B only: tracker-sourced title refreshes in place
    Test file: `client/src/pages/FocusPage.test.tsx`
    Level: integration
    Test intent: Given a tracker-sourced page showing task T with title "Old title", When `{ type: "tracker.updated", actor, trackerItemId: 77 }` arrives through `subscribeTrackerEvents`, Then the tracker title refreshes in place, navigation does not occur, and the timer identity is preserved.
    Exercise through: the `subscribeTrackerEvents` seam with the literal tracker payload
    Test doubles: test-controlled tracker registry; mocked `../api` with call-ordered `getWorkItem` responses; do not mock the page handler
    Expected RED: Step 19 subscribed only to card events, so a tracker page keeps "Old title"

19b. Run test — verify FAIL for Case B only: `npm run test -- client/src/pages/FocusPage.test.tsx -t "tracker.updated refreshes title"`
    Expected failure: the tracker title stays stale.

19c. Implement the tracker in-place refresh, then verify PASS: subscribe through `subscribeTrackerEvents`, reload only the work-item data, preserve timer identity. Run `npm run test -- client/src/pages/FocusPage.test.tsx -t "tracker.updated refreshes title"`, then re-run Case A's `-t` so it stays PASS.

20. Write failing test for: `Given Ready, When Start fails 5xx, Then the page surfaces a retryable error without inventing timer state`
    Test file: `client/src/pages/FocusPage.test.tsx`
    Level: unit (component, jsdom)

    Test intent:
    Given `useFocusSession` reports a Ready session and an `actionError` after a failed Start, When the page renders, Then the exact calm error copy is visible, the session still reads Ready, and the timer receives no running state.
    Exercise through: rendered output
    Test doubles: mocked `useFocusSession` with a controllable `actionError`
    Expected RED: no error is rendered.

21. Run test — verify FAIL: `npm run test -- client/src/pages/FocusPage.test.tsx`
    Expected failure: the error register is absent or the page invents running state.

22. Implement action-error rendering, then verify PASS: render `actionError` near the timer without changing the provider session, and run `npm run test -- client/src/pages/FocusPage.test.tsx`.

23. Write a separate failing test for: `Given Finish resolves, When the finished payload contains returnPath, Then the user returns to that exact surface`
    Test file: `client/src/pages/FocusPage.test.tsx`
    Level: unit (component, jsdom)

    Test intent:
    Independent GWT case A: Given `returnPath: "/board/card/481"`, When `finish()` resolves with `{ session: { state: "finished", returnPath } }` while provider state becomes null, Then `navigate("/board/card/481")` is called and the no-session redirect does not also call `/board`. Independent GWT case B: Given an empty return path, When finish resolves, Then `/board` is the fallback. Keep the two navigation outcomes as separate test cases.
    The implementation must pass `session`, `pending`, and `start`/`pause`/`resume`/`finish` callbacks to `FocusTimer`; set the finish-transition ref immediately before invoking `finish()` so the redirect effect cannot race it.
    Exercise through: rendered `FocusPage`, a controllable `FocusTimer` callback, and the provider's resolved finish payload
    Test doubles: mocked `useFocusSession` with a resolving `finish` and mocked `useNavigate`; inspect the real page-to-timer prop wiring
    Expected RED: Finish does not navigate to the returned path and the timer wiring is implicit.

24. Run test — verify FAIL: `npm run test -- client/src/pages/FocusPage.test.tsx`
    Expected failure: navigation falls back to `/board` or the timer callbacks are not wired.

25. Implement Finish navigation and explicit timer wiring, then verify PASS: mount `<FocusTimer session={session} pending={pending} onStart={start} onPause={pause} onResume={resume} onFinish={handleFinish} />`; navigate from the finished response's `returnPath`, and use `/board` only when it is empty. Run `npm run test -- client/src/pages/FocusPage.test.tsx`.

26. Register the route: in `client/src/App.tsx`, add `{ path: "focus", lazy: async () => ({ Component: (await import("./pages/FocusPage")).default }) }` inside the `AppLayout` children, matching the `tracker` and `agent` entries exactly. Verify: `npm run test` and `npm run typecheck --workspace=client`.

27. Refactor while green (bounded):
    - Rule of three: the `source`-based task load (`getCard` vs `getWorkItem`) will be needed again by nothing else in this plan — leave it inline in the page rather than pre-extracting
    - If `FocusPage.tsx` crosses ~300 lines, extract the task-content block into `client/src/components/FocusTaskContent.tsx` and add it to the commit
    - `App.tsx` gains only the route entry — no other change
    - Re-run `npm run test -- client/src/pages/FocusPage.test.tsx` — must stay PASS

28. Commit:
    `git add client/src/pages/FocusPage.tsx client/src/pages/FocusPage.test.tsx client/src/App.tsx`
    If Step 27 extracted `client/src/components/FocusTaskContent.tsx`, additionally run `git add client/src/components/FocusTaskContent.tsx` before committing.
    `git commit -m "feat(focus): add /focus route and focus surface"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Focus entry (`✓ Given no session, When open /focus directly, Then redirect to /board`); rule: Work context (both criteria); rule: Lifecycle (`✗ Start fails 5xx`, `✓ Finish returns the user to the surface they started from`); Implementation Notes on `return_path` and on loading the task via `api.getCard` / `api.getWorkItem` rather than from `BoardContext.columns`
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — a task is loaded by `(source, id)`, never by key alone
- `docs/pocket/rule/creative-brief.md` — **design authority**. Calm, uncluttered surface; type scale (`xl` 31px page heading, `base` 16px body, `sm` 13px meta); neutral surface `neutral-100`; Error Messages register; Empty State tone
- `client/src/App.tsx` (lines ~64–105) — the `lazy: async () => ({ Component })` route convention this task copies
- `client/src/pages/TrackerDetailPage.tsx` — page layout, task loading, and `mockNavigate` test conventions
- `client/src/api.ts` — `getCard(workspaceId, id)` at line ~194, `getWorkItem(workspaceId, key)` at line ~492
- `client/src/context/FocusSessionContext.tsx` (T7) and `client/src/components/FocusTimer.tsx` (T8)

## WHY THIS APPROACH

Complexity: standard
Justification: three files with branching on session presence, task source, load failure, and action failure — plus a redirect whose timing (after load, not during) is easy to get subtly wrong in a way that logs users out of their own focus session.

## SANDWICH CONTEXT

[CRITICAL: the redirect to `/board` fires only when loading has finished, the session is null, AND the transition was not caused by this page's own `finish()`. Redirecting mid-load throws a user with a live focus session back to the board on every refresh; redirecting on a finish sends them to the board instead of the task they came from, silently defeating the `returnPath` the session has carried since T4.]

You are implementing the `/focus` route and focus surface for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — a dedicated calm surface showing only the committed task; v1 context is title + description + timer/controls, nothing else.
Files in scope: `client/src/pages/FocusPage.tsx`, `client/src/pages/FocusPage.test.tsx`, `client/src/App.tsx` — no other files (plus a task-content extraction if Step 27 triggers one).
Test framework: Vitest + `@testing-library/react`, jsdom. Single file: `npm run test -- client/src/pages/FocusPage.test.tsx`.
Available after: T8 (`FocusTimer`), T7 (`useFocusSession`, `FocusSession` type), T6 (full server API).
Architecture rule: load the task by `(source, taskId)` — `api.getCard` for board, `api.getWorkItem(key)` for tracker — never from `BoardContext.columns`, never by `key_number` alone (ADR #103). Any task field edit must route through `client/src/lib/workItemMutations.ts`. Client imports carry no extension; `noUnusedLocals` is on. UI decisions come from `docs/pocket/rule/creative-brief.md`.

[RESTATE: redirect only after loading completes and the session is confirmed null — never mid-load, and never on a finish this page initiated.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given no active session, When `/focus` is opened directly, Then the user is redirected to `/board` with no error
Given a focus session on task T, When the surface loads, Then T's title and description are visible along with the timer and controls
Given a session with `source: "board"`, When the page loads the task, Then `api.getCard(workspaceId, taskId)` is used
Given a session with `source: "tracker"`, When the page loads the task, Then `api.getWorkItem(workspaceId, taskKey)` is used and tracker identity is preserved
Given another user updates T's title, When the SSE event arrives, Then the title refreshes in place and the user stays on `/focus` — proven for a board-sourced session (`card.updated`) and a tracker-sourced one (`tracker.updated`)
Given a Ready session and a failed Start, When the page renders, Then a retryable error is shown and the session still reads Ready
Given `returnPath: "/board/card/481"`, When Finish completes, Then the user is navigated to `/board/card/481`
[derived] Given the session is still loading, When the page renders, Then no redirect fires
[derived] Given the task load fails, When the page renders, Then a calm error state with a route back to the board is shown
[must-not] Given a task with status, labels, assignees, and a due date, When the focus surface renders, Then those fields must NOT appear — v1 is title + description + timer/controls
[must-not] Given an SSE task update, When it is applied, Then the page must NOT unmount the timer or reset the running duration

All tests PASS. Commit exists with message matching `feat(focus): add /focus route and focus surface`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Redirect gated on `!loading && session === null`, and suppressed for a finish-initiated transition
- Task loaded by `(source, id)`, not from board state
- SSE task refresh happens in place — the focus surface is never unmounted by it
- Copy and visuals follow `docs/pocket/rule/creative-brief.md`; the route entry in `App.tsx` uses the existing `lazy` convention
- Tests written BEFORE implementation (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- Status, labels, assignees, due date, activity, checklist, comments, or attachments on the surface
- Direct `api.updateCard` / `api.updateTrackerItem` calls — task edits go through `workItemMutations.ts`
- Any change to `BoardContext.tsx` — `subscribeTrackerEvents` already existed and T7 delivered `subscribeCardEvents`; if a needed seam appears to be missing, that is a T7 defect to report, not something to patch here
- Reading the focused task out of `BoardContext.columns`
- Focus API calls made directly instead of through `useFocusSession`

Open question risks:
- Assumption: title and description are read-only in v1. The spec allows inline edit "if offered"; this plan does not offer it. Adding an editor here would pull in `workItemMutations`, conflict handling, and dirty-state tracking — out of scope. If inline edit is wanted, that is a follow-up task → report NEEDS_CONTEXT rather than building it.

Rollback note:
- With `FOCUS_MODE_ENABLED=false`, `useFocusSession` reports no session and this page redirects to `/board` — the route stays registered but is inert. Confirm that path.

Red flags:
- Work outside the listed files → DONE_WITH_CONCERNS
- Extra task fields rendered → STOP
- A redirect that can fire during loading → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: inline title/description editing turns out to be required for v1
Escalate when: the surface appears to need fields the spec defers, or a task edit path that bypasses `workItemMutations.ts`

---
### Task 10: Entry points — "Focus on this task" + confirm-switch [depends: T6, T9]

## OBJECTIVE

Add the entry into focus mode from both task surfaces: a shared `FocusEntryButton` mounted in `ContextPanel` (board card detail) and in the `TrackerDetailPage` header, which commits the task, handles the confirm-then-switch flow when another session is already active, and navigates to `/focus`.

Files:
- Create: `client/src/components/FocusEntryButton.tsx`
- Modify: `client/src/components/ContextPanel.tsx`
- Modify: `client/src/pages/TrackerDetailPage.tsx`
- Test: `client/src/components/FocusEntryButton.test.tsx`

One component, two mount sites. There is no standalone board card menu today (`CardView.tsx` only opens the panel), so the board entry lives in the panel — this is the spec's confirmed placement, not a shortcut.

```
type FocusEntryButtonProps = { source: WorkItemSource; taskId: number; taskKey?: string | null };
```

Steps:

1. Write failing test for: `Given board card C, When "Focus on this task", Then /focus shows C, Ready, source+id persisted`
   Test file: `client/src/components/FocusEntryButton.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given no active session and `focusModeEnabled: true`
   When the button labelled **"Focus on this task"** is clicked with `{ source: "board", taskId: 481 }`
   Then `focus({ source: "board", taskId: 481 })` from `useFocusSession()` was called, and on resolution `navigate("/focus")` was called
   Exercise through:
   - `screen.getByRole("button", { name: /focus on this task/i })` and `fireEvent.click`

   Test doubles:
   - mock `../context/FocusSessionContext` via `vi.hoisted`, exposing `focus`, `switchTo`, `session`
   - mock `react-router`'s `useNavigate`; mock `../context/BoardContext`'s `useBoard` for `focusModeEnabled` and `showToast`
   - do NOT mock: the button component itself

   Expected RED:
   - `client/src/components/FocusEntryButton.tsx` does not exist

2. Run test — verify FAIL: `npm run test -- client/src/components/FocusEntryButton.test.tsx`
   Expected failure: `Failed to resolve import "./FocusEntryButton"`

3. Implement the board focus flow, then verify PASS: in `FocusEntryButton.tsx`, call `focus({ source: "board", taskId: 481 })` and navigate to `/focus` only after it resolves. Run `npm run test -- client/src/components/FocusEntryButton.test.tsx`.

4. Write a separate failing test for: `Given tracker item T, When "Focus on this task", Then the tracker source and id are preserved`
   Test file: `client/src/components/FocusEntryButton.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given no active session and `focusModeEnabled: true`, When clicked with `{ source: "tracker", taskId: 77, taskKey: "CAM-42" }`, Then `focus({ source: "tracker", taskId: 77 })` is called and successful resolution navigates to `/focus`.
   Exercise through: `screen.getByRole("button", { name: /focus on this task/i })` and the tracker click path
   Test doubles: mocked `useFocusSession` with `focus`/navigation spies and `useBoard` with the flag enabled; do not mock the button
   Expected RED: the board-only fixture/path does not yet prove the tracker identity.

5. Run test — verify FAIL: `npm run test -- client/src/components/FocusEntryButton.test.tsx`
   Expected failure: tracker source is not preserved.

6. Implement the source-agnostic entry props, then verify PASS: reuse the same `focus` call for board and tracker without direct API access. Run `npm run test -- client/src/components/FocusEntryButton.test.tsx`.

7. Write failing test for: `Given Ready session on task T, When focus on T again, Then navigate to /focus without a confirmation dialog`
   Test file: `client/src/components/FocusEntryButton.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given an active session already on `{ source: "board", taskId: 481 }`
   When the button is clicked for that same task
   Then `navigate("/focus")` was called, no dialog was rendered, and the session's state and accumulated time are unchanged — re-entering focus on the task you are already focused on must never cost the user their running timer

   Exercise through: the click handler and the absence of a dialog in the document
   Test doubles: mocked context reporting an active session on the same task
   Expected RED: the component asks the server unconditionally and a dialog appears, or the timer resets

8. Run test — verify FAIL: `npm run test -- client/src/components/FocusEntryButton.test.tsx`
   Expected failure: the component calls the server or renders a dialog for the same task.

9. Implement the same-task short circuit, then verify PASS: compare `source` and `taskId`, navigate directly, and never call `focus` or `switchTo`. Run `npm run test -- client/src/components/FocusEntryButton.test.tsx`.

10. Write failing test for: `Given Running on A, When focus on B and confirm, Then the dialog precedes switch and B starts only after confirmation`
   Test file: `client/src/components/FocusEntryButton.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given an active Running session on task A
   When the button is clicked for a different task B
   Then:
   - a confirmation dialog appears naming what happens — the current focus is finished and its time is kept — in the creative brief's neutral-friendly register
   - before confirmation, `switchTo` has not been called
   - when the user confirms, `switchTo({ source, taskId: B, version })` is called and `navigate("/focus")` follows

   Exercise through: click → dialog → confirm/cancel buttons, by accessible role and name
   Test doubles: mocked context whose `focus` can be made to reject with a 409; `vi.fn()` for `switchTo` and `navigate`
   Expected RED: clicking on a different task calls `focus` and surfaces a raw error, with no dialog

11. Run test — verify FAIL: `npm run test -- client/src/components/FocusEntryButton.test.tsx`
    Expected failure: no confirmation dialog appears or `switchTo` is called before confirmation.

12. Implement the confirm-switch dialog and confirmed path, then verify PASS: render an accessible dialog with neutral copy, call `switchTo` only from its confirm action, and navigate after it resolves. Run `npm run test -- client/src/components/FocusEntryButton.test.tsx`.

13. Write a separate failing test for: `Given Paused session on A, When focus on B is cancelled, Then A remains untouched`
    Test file: `client/src/components/FocusEntryButton.test.tsx`
    Level: unit (component, jsdom)

    Test intent:
    Given a Paused session on task A, When the user opens the dialog for B and clicks **Cancel**, Then `switchTo` and `navigate` are not called and the session fixture remains Paused with the same accumulated time.
    Exercise through: click the real dialog's accessible **Cancel** button after opening it for B
    Test doubles: mocked context with a Paused session and spies for `switchTo`/navigate; do not mock the dialog branch
    Expected RED: the cancel path is absent or mutates the session.

14. Run test — verify FAIL: `npm run test -- client/src/components/FocusEntryButton.test.tsx`
    Expected failure: cancel invokes the switch or navigation.

15. Implement the cancel path, then verify PASS: close the dialog without calling any provider action and run `npm run test -- client/src/components/FocusEntryButton.test.tsx`.

16. Write a separate failing test for: `Given focus() rejects 409 session_active, When the click is handled, Then the confirmation dialog appears`
    Test file: `client/src/components/FocusEntryButton.test.tsx`
    Level: unit (component, jsdom)

    Test intent:
    Given `focus()` rejects an `ApiError` with status 409 and `code: "session_active"` carrying the current session, Then the component opens the same confirmation dialog instead of showing a raw error; it still does not call `switchTo` before confirmation.
    Exercise through: click the real entry button and query the accessible confirmation dialog
    Test doubles: mocked context whose `focus` rejects with a typed `ApiError(409, "session_active")`; mocked `useBoard` flag-on and `useNavigate`; do not mock the component
    Expected RED: the rejection is surfaced as a generic error.

17. Run test — verify FAIL: `npm run test -- client/src/components/FocusEntryButton.test.tsx`
    Expected failure: the dialog is not opened for `session_active`.

18. Implement explicit `session_active` handling, then verify PASS: distinguish it from `version_conflict`, reuse the confirmation UI, and leave all other errors in the normal error path. Run `npm run test -- client/src/components/FocusEntryButton.test.tsx`.

19. Write failing test for: the entry is hidden when the feature is off
   Test file: `client/src/components/FocusEntryButton.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given `focusModeEnabled: false` on `BoardContext`
   When the component renders
   Then nothing is rendered — no button, no placeholder. This is the client half of the Rollback Plan; without it, disabling the flag leaves a visible button that 404s.

   Exercise through: `screen.queryByRole("button", { name: /focus on this task/i })`
   Test doubles: mocked `useBoard` with the flag off
   Expected RED: the button renders regardless of the flag

20. Run test — verify FAIL: `npm run test -- client/src/components/FocusEntryButton.test.tsx`
    Expected failure: the button renders despite the flag being false.

21. Implement the flag gate, then verify PASS: render nothing when `focusModeEnabled` is false. Run `npm run test -- client/src/components/FocusEntryButton.test.tsx`.

22. Mount at both entry points:
    - `client/src/components/ContextPanel.tsx` — render `<FocusEntryButton source="board" taskId={card.id} taskKey={...} />` in the panel header action row, beside the existing actions (the `ticketIntakeEnabled` blocks around lines 367–414 show the established placement and gating style)
    - `client/src/pages/TrackerDetailPage.tsx` — render `<FocusEntryButton source="tracker" taskId={item.id} taskKey={item.key} />` in the existing sticky breadcrumb/header strip beside the item key (the current block is around lines 438–466; it is a breadcrumb, not an action row)
    - Each file gains the import and the element and nothing else — no focus logic inline
    - Verify no regression: `npm run test` and `npm run typecheck --workspace=client`

23. Refactor while green (bounded):
    - Rule of three: the "is this the task the session already targets" comparison exists here and on the server (T4, T6). One client-side copy is correct — do not try to share code across the network boundary
    - Keep `FocusEntryButton.tsx` under ~300 lines; if the dialog grows past a simple confirm, extract `FocusSwitchDialog.tsx` and add it to the commit
    - `ContextPanel.tsx` and `TrackerDetailPage.tsx` are already 650+ lines: add only the import and the element
    - Re-run `npm run test -- client/src/components/FocusEntryButton.test.tsx` — must stay PASS

24. Commit:
    `git add client/src/components/FocusEntryButton.tsx client/src/components/FocusEntryButton.test.tsx client/src/components/ContextPanel.tsx client/src/pages/TrackerDetailPage.tsx`
    If Step 23 extracted `client/src/components/FocusSwitchDialog.tsx`, additionally run `git add client/src/components/FocusSwitchDialog.tsx` before committing.
    `git commit -m "feat(focus): add focus entry points with confirm-switch"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Focus entry (board and tracker criteria); rule: Switch task (both criteria); "Story: Focus on a task" incl. idempotent re-focus; Scope → In-Scope on entry placement ("there is no standalone board card menu today"); Implementation Notes on user-facing copy
- `docs/pocket/rule/creative-brief.md` — **design authority**. Button — Secondary for the entry action (`bg-neutral-100`, `text-primary-700`, `border-neutral-300`, radius 6px); CTA style ("Not now" / "Cancel" for secondary actions); neutral-friendly register for the dialog copy
- `client/src/components/ContextPanel.tsx` (lines ~367–414) — flag-gated action placement in the panel header
- `client/src/pages/TrackerDetailPage.tsx` (lines ~438–466) — the existing sticky breadcrumb/header strip where the tracker entry is mounted
- `client/src/context/FocusSessionContext.tsx` (T7) — `useFocusSession()`, `focus`, `switchTo`
- `client/src/types.ts` — `WorkItemSource`

## WHY THIS APPROACH

Complexity: standard
Justification: four files and a three-way branch on click (same task, no session, different session), plus a dialog whose cancel path must provably leave a running timer alone.

## SANDWICH CONTEXT

[CRITICAL: clicking "Focus on this task" while another task is focused must never silently replace the session. The plain `focus` action is refused by the server with 409 `session_active`; only an explicit user confirmation may trigger `switchTo`. Skipping the dialog throws away time the user actually worked.]

You are implementing the focus entry points for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — entry from board card detail and tracker detail; confirm-then-switch when replacing an active session.
Files in scope: `client/src/components/FocusEntryButton.tsx`, `client/src/components/FocusEntryButton.test.tsx`, `client/src/components/ContextPanel.tsx`, `client/src/pages/TrackerDetailPage.tsx` — no other files (plus a dialog extraction if Step 12 triggers one).
Test framework: Vitest + `@testing-library/react`, jsdom. Single file: `npm run test -- client/src/components/FocusEntryButton.test.tsx`.
Available after: T9 (`/focus` route exists to navigate to), T6 (server `switch` action), T7 (provider).
Architecture rule: all focus API access goes through `useFocusSession()`. `ContextPanel.tsx` and `TrackerDetailPage.tsx` receive an import and an element — no focus logic inline. Client imports carry no extension; `noUnusedLocals` is on. UI decisions come from `docs/pocket/rule/creative-brief.md`.

[RESTATE: replacing an active session requires explicit user confirmation — never an implicit switch.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given board card C, When "Focus on this task" is clicked, Then a Ready session on C is created and the user lands on `/focus`
Given tracker item T, When "Focus on this task" is clicked, Then the session preserves `source: "tracker"`
Given a Ready session on task T, When "Focus on this task" is clicked on T again, Then the user navigates to `/focus` with no confirmation dialog and the session is unchanged
Given a Running session on task A, When the user focuses task B and confirms, Then `switchTo` is called and the user lands on `/focus`
Given a Paused session on task A, When the user attempts to focus B but cancels, Then session A remains Paused, unchanged, and no navigation occurs
[derived] Given `focus()` rejects with 409 `session_active`, When the click is handled, Then the confirmation dialog is shown rather than a raw error
[must-not] Given `focusModeEnabled: false`, When either surface renders, Then the entry button must NOT appear
[must-not] Given an active session on a different task, When the entry is clicked, Then the component must NOT call `switchTo` before the user confirms

All tests PASS. Commit exists with message matching `feat(focus): add focus entry points with confirm-switch`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Exact spec copy: "Focus on this task"
- Confirmation dialog before any switch; cancel leaves the existing session untouched
- Same-task click short-circuits without a server round trip that could reset the timer
- Flag gate hides the entry entirely when focus mode is off
- Both mount sites gain only an import and an element
- Dialog and button reachable by accessible role and name
- Tests written BEFORE implementation (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- The word "Commit" in any user-facing string
- Direct `api.focus.*` calls — everything goes through `useFocusSession()`
- Focus logic inside `ContextPanel.tsx` or `TrackerDetailPage.tsx`
- Changes to `CardView.tsx` or board layout — the entry lives in the detail surfaces
- A browser `confirm()` — use an in-app dialog consistent with the creative brief

Open question risks:
- Assumption: the confirm dialog is owned by this component. If the workspace-switch dialog (T12) and this one must merge into one combined prompt when both guards fire, that is a follow-up → report NEEDS_CONTEXT rather than restructuring both.

Rollback note:
- With `FOCUS_MODE_ENABLED=false` both entry points disappear, which is the Rollback Plan's user-visible half. Verify explicitly on both surfaces.

Red flags:
- Work outside the listed files → DONE_WITH_CONCERNS
- A switch without confirmation → STOP
- Focus logic added inline to a 650-line file → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: the two confirmation dialogs need to merge
Escalate when: entry placement appears to require a board card menu that does not exist

---
### Task 11: Global "Focus active" nav indicator [depends: T7]

## OBJECTIVE

Add a persistent re-entry affordance to the app header: when a focus session is active, a **"Focus active"** control appears and returns the user to `/focus` with the session preserved.

Files:
- Create: `client/src/layout/FocusIndicator.tsx`
- Modify: `client/src/layout/AppLayout.tsx`
- Test: `client/src/layout/FocusIndicator.test.tsx`

It mounts in the header's right-hand cluster beside `PresenceBar` (`AppLayout.tsx` line ~88).

Steps:

1. Write failing test for: `Given an active session and the user on /board, When "Focus active" is clicked, Then they return to /focus with the session preserved`
   Test file: `client/src/layout/FocusIndicator.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given `useFocusSession()` reports an active session in any of Ready, Running, or Paused
   When the component renders
   Then a control labelled **"Focus active"** is present, and clicking it calls `navigate("/focus")`
   And no focus API call is made — re-entry is pure navigation; the provider already holds the session, so returning must never re-fetch or disturb the running timer

   Exercise through: `screen.getByRole("button", { name: /focus active/i })` and `fireEvent.click`

   Test doubles:
   - mock `../context/FocusSessionContext` via `vi.hoisted`; mock `react-router`'s `useNavigate`; mock `../context/BoardContext` for `focusModeEnabled`
   - do NOT mock: the indicator component

   Expected RED:
   - `client/src/layout/FocusIndicator.tsx` does not exist

2. Run test — verify FAIL: `npm run test -- client/src/layout/FocusIndicator.test.tsx`
   Expected failure: `Failed to resolve import "./FocusIndicator"`

3. Implement minimal code to satisfy the test:
   File: `client/src/layout/FocusIndicator.tsx` — the control and its navigation.

4. Run test — verify PASS: `npm run test -- client/src/layout/FocusIndicator.test.tsx`

5. Write failing test for: the indicator is absent when there is nothing to return to
   Test file: `client/src/layout/FocusIndicator.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given `session: null`, Then nothing is rendered — a permanently visible chrome element for a feature the user is not using is exactly the ambient pressure this feature is meant to avoid
   And Given `focusModeEnabled: false` with a session somehow present, Then nothing is rendered
   And Given the session is still loading, Then nothing is rendered — no flicker of an indicator that may not apply

   Exercise through: `screen.queryByRole("button", { name: /focus active/i })`
   Test doubles: mocked context in each configuration
   Expected RED: the control renders unconditionally

6. Run test — verify FAIL, implement the gates, verify PASS: `npm run test -- client/src/layout/FocusIndicator.test.tsx`

7. Mount it: in `client/src/layout/AppLayout.tsx`, render `<FocusIndicator />` in the header's right-hand cluster beside `<PresenceBar />` (line ~88). The file gains the import and the element and nothing else. Verify: `npm run test` and `npm run typecheck --workspace=client`.

8. Refactor while green (bounded):
   - Rule of three: nothing is duplicated three times; no extraction
   - Keep `FocusIndicator.tsx` well under ~300 lines
   - Re-run `npm run test -- client/src/layout/FocusIndicator.test.tsx` — must stay PASS

9. Commit:
   `git add client/src/layout/FocusIndicator.tsx client/src/layout/FocusIndicator.test.tsx client/src/layout/AppLayout.tsx`
   `git commit -m "feat(focus): add global focus active nav indicator"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — "Story: Global re-entry" (the sole GWT); Scope → In-Scope ("Global **Focus active** indicator in nav for re-entry"); Out-of-Scope ("Focus leaderboard or surveillance-style timer UX")
- `docs/pocket/rule/creative-brief.md` — **design authority**. Badge / Tag or Button — Ghost styling; `sm` 13px label; primary-600 text on transparent, hover `primary-100`; calm, low-pressure presentation
- `client/src/layout/AppLayout.tsx` (lines ~73–91) — the header structure and the `PresenceBar` mount point
- `client/src/context/FocusSessionContext.tsx` (T7) — `useFocusSession()`

## WHY THIS APPROACH

Complexity: lightweight
Justification: one small component plus one mount line; the only judgment is what NOT to show, which is stated explicitly below.

## SANDWICH CONTEXT

[CRITICAL: the indicator renders only when a session actually exists. An always-present focus chrome element turns a deliberate personal tool into ambient pressure — the exact "surveillance-style timer UX" the spec puts out of scope.]

You are implementing the global focus re-entry indicator for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — a dedicated `/focus` surface, with a nav affordance so the user can leave and come back without losing the session.
Files in scope: `client/src/layout/FocusIndicator.tsx`, `client/src/layout/FocusIndicator.test.tsx`, `client/src/layout/AppLayout.tsx` — no other files.
Test framework: Vitest + `@testing-library/react`, jsdom. Single file: `npm run test -- client/src/layout/FocusIndicator.test.tsx`.
Available after: T7 (provider). Runs in parallel with T8 and T12 — see Parallelizable Groups.
Architecture rule: read session state through `useFocusSession()` only — no `api` import, no lifecycle mutations. This control navigates; it never starts, pauses, or finishes anything. Client imports carry no extension. UI decisions come from `docs/pocket/rule/creative-brief.md`.

[RESTATE: render nothing unless a session exists — no persistent focus chrome.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given an active session and the user navigated to `/board`, When "Focus active" is clicked, Then the user returns to `/focus` and the session is preserved
[derived] Given no active session, When the header renders, Then no indicator appears
[derived] Given the session is still loading, When the header renders, Then no indicator appears
[must-not] Given `focusModeEnabled: false`, When the header renders, Then the indicator must NOT appear
[must-not] Given the indicator is clicked, When re-entry happens, Then it must NOT call a focus API endpoint or mutate the session

All tests PASS. Commit exists with message matching `feat(focus): add global focus active nav indicator`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Exact spec copy: "Focus active"
- Rendered only when a session exists, loading has settled, and the flag is on
- Reachable by accessible role and name
- `AppLayout.tsx` gains only the import and the element
- Tests written BEFORE implementation (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- Lifecycle controls in the nav — Start/Pause/Resume/Finish live on the focus surface
- Any other member's focus state — this is a personal indicator
- Productivity scoring, streaks, or idle callouts
- Focus API calls

Open question risks:
- Assumption: the indicator shows a label only, not a live duration. A ticking clock in persistent chrome pulls toward the surveillance UX the spec rejects. If a duration is wanted, it is an additive change to this component → not a blocker.

Rollback note:
- Flag off ⇒ nothing renders; `AppLayout` is otherwise unchanged.

Red flags:
- Work outside the three listed files → DONE_WITH_CONCERNS
- An always-visible indicator → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: a live duration in the nav is requested
Escalate when: re-entry appears to require re-fetching or mutating the session

---
### Task 12: Workspace switch guard [depends: T7]

## OBJECTIVE

Block a workspace switch while focus state is still hydrating or any focus session is active (Ready, Running, or Paused) and tell the user what to do. Extend the existing pure guard `getSwitchAttemptState` rather than adding a second gate somewhere else.

Files:
- Modify: `client/src/lib/workspaceSwitcher.ts`
- Modify: `client/src/context/BoardContext.tsx`
- Test: `client/src/lib/workspaceSwitcher.test.ts` (exists — extend it)
- Test: `client/src/context/BoardContext.focusGuard.test.tsx`

**Wiring, decided here so it is not rediscovered mid-task.** `BoardProvider` is the parent of `FocusSessionProvider`, so it cannot read focus state directly. T7 owns and initializes `hasActiveFocusSession`, `focusSessionHydrated`, and their setters in `BoardContext`, and its provider effects drive those setters. This task consumes that plumbing only: add the pure guard inputs and the context routing/blocked branches. No task in T12 may redefine the fields, add a second effect, or edit `FocusSessionContext.tsx`.

Steps:

1. Write failing test for: `Given any active session, When a workspace switch is attempted, Then it is blocked until Finish`
   Test file: `client/src/lib/workspaceSwitcher.test.ts`
   Level: unit

   Test intent:
   Given `getSwitchAttemptState({ activeWorkspaceId: 1, targetWorkspaceId: 2, hasUnsavedCardEdits: false, hasActiveFocusSession: true, focusSessionHydrated: true })`
   Then the result is `{ status: "focus-blocked" }` — a distinct status from `confirm-required`, because this one has no "switch anyway" path: the user must finish focus
   And Given `focusSessionHydrated: false`, Then the result is `{ status: "focus-loading" }` — the provider has not proved that the target workspace is safe to enter yet
   And Given `hasActiveFocusSession: false`, `focusSessionHydrated: true`, and no unsaved edits, Then the result is `{ status: "switch", workspaceId: 2 }` as today
   And Given both `hasActiveFocusSession: true` and `hasUnsavedCardEdits: true` with hydration complete, Then the focus block wins — it is the guard the user cannot dismiss
   And Given `activeWorkspaceId === targetWorkspaceId` with a session active, Then the result is `{ status: "noop" }` — switching to the workspace you are already in is not a switch

   Exercise through: the exported `getSwitchAttemptState` function
   Test doubles: none — pure function
   Expected RED: `hasActiveFocusSession` and `focusSessionHydrated` are not part of `SwitchAttemptInput`; the existing signature ignores them and returns `{ status: "switch" }`

2. Run test — verify FAIL: `npm run test -- client/src/lib/workspaceSwitcher.test.ts`
   Expected failure: `expected { status: 'switch', workspaceId: 2 } to deeply equal { status: 'focus-blocked' }`

3. Implement minimal code to satisfy the test:
   File: `client/src/lib/workspaceSwitcher.ts` — add `hasActiveFocusSession: boolean` and `focusSessionHydrated: boolean` to `SwitchAttemptInput`; add `{ status: "focus-loading" }` and `{ status: "focus-blocked" }` to the union; check `noop` first, then hydration, then the active-session block, then unsaved edits.

4. Run test — verify PASS: `npm run test -- client/src/lib/workspaceSwitcher.test.ts`

5. Write a failing test for: `Given the BoardContext focus flags, When WorkspaceSwitcher selects a target, Then it forwards both flags to the pure guard`
   Test file: `client/src/layout/sidebar/WorkspaceSwitcher.test.tsx`
   Level: unit (component, jsdom)

   Test intent:
   Given `useBoard()` returns `hasActiveFocusSession: true` and `focusSessionHydrated: false`, When the workspace switcher opens and workspace 2 is selected, Then `getSwitchAttemptState` receives both flags and the component does not invent a second guard or confirmation path. The existing `attemptSwitchWorkspace(2)` remains the single effectful call.
   Exercise through: the rendered `WorkspaceSwitcher` and its accessible workspace button/menu option
   Test doubles: `vi.hoisted` mocks for `useBoard`, `workspaceSwitcher` helpers, and invite actions; render the real `WorkspaceSwitcher`
   Expected RED: `WorkspaceSwitcher.tsx` calls `getSwitchAttemptState` without the new focus fields.

6. Run test — verify FAIL: `npm run test -- client/src/layout/sidebar/WorkspaceSwitcher.test.tsx`
   Expected failure: the helper was called without `hasActiveFocusSession` and `focusSessionHydrated`.

7. Implement the component wiring, then verify PASS: in `client/src/layout/sidebar/WorkspaceSwitcher.tsx`, destructure both flags from `useBoard()` and pass them to `getSwitchAttemptState`; do not add a second block in the component. Run `npm run test -- client/src/layout/sidebar/WorkspaceSwitcher.test.tsx`.

8. Write failing test for: the guard is wired end to end and the user is told what to do
   Test file: `client/src/context/BoardContext.focusGuard.test.tsx`
   Level: integration

   Test intent:
   Independent integration cases:
   - Case A: Given a `BoardProvider` whose `hasActiveFocusSession` is `true`, When `attemptSwitchWorkspace(2)` is called, Then the active and persisted workspace remain unchanged and a calm finish-first warning appears.
   - Case B: Given `hasActiveFocusSession` is `false` and hydration is complete, When `attemptSwitchWorkspace(2)` is called, Then the switch proceeds as before.
   The cases have separate test names and RED/PASS assertions.

   Exercise through:
   - a probe component calling `useBoard()` inside `BoardProvider`, driving `setHasActiveFocusSession` then `attemptSwitchWorkspace`

   Test doubles:
   - mocked `../api` via `vi.hoisted`; `MockEventSource` stub as in `client/src/context/BoardContext.viewMode.test.tsx`
   - do NOT mock: `getSwitchAttemptState` — the point is that the context actually routes through the pure guard

   Expected RED:
   - the switch goes through; `activeWorkspaceId` becomes 2

9. Run test — verify FAIL: `npm run test -- client/src/context/BoardContext.focusGuard.test.tsx`
   Expected failure: `expected 2 to be 1`

10. Implement:
   File: `client/src/context/BoardContext.tsx` — consume the T7-owned `hasActiveFocusSession` and `focusSessionHydrated` values, pass both flags into `getSwitchAttemptState` inside `attemptSwitchWorkspace`, and handle `status: "focus-loading"` and `status: "focus-blocked"` with calm warnings and an immediate return without switching. Do not add or modify the provider effects; T7 owns those.
   Verify PASS: `npm run test -- client/src/context/BoardContext.focusGuard.test.tsx`.

11. Refactor while green (bounded):
   - Rule of three: the guard logic stays in the pure `workspaceSwitcher.ts` function — resist adding a second check inside `WorkspaceSwitcher.tsx` or the sidebar; one gate, one place
   - `BoardContext.tsx` gains only the guard arguments and two blocked branches; the flags/setters/effects remain T7-owned
   - `WorkspaceSwitcher.tsx` only forwards context inputs to the pure guard; it has no focus policy
   - Re-run `npm run test -- client/src/lib/workspaceSwitcher.test.ts`, `npm run test -- client/src/layout/sidebar/WorkspaceSwitcher.test.tsx`, and `npm run test -- client/src/context/BoardContext.focusGuard.test.tsx`, plus the full client suite — all must stay PASS

12. Commit:
    `git add client/src/lib/workspaceSwitcher.ts client/src/lib/workspaceSwitcher.test.ts client/src/layout/sidebar/WorkspaceSwitcher.tsx client/src/layout/sidebar/WorkspaceSwitcher.test.tsx client/src/context/BoardContext.tsx client/src/context/BoardContext.focusGuard.test.tsx`
   `git commit -m "feat(focus): block workspace switch while a focus session is active"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Guards (`✓ Given any session state, When workspace switch attempted, Then blocked until Finish`); "Story: Workspace and access guards"; Implementation Notes ("extend `getSwitchAttemptState` (`workspaceSwitcher.ts`) with `hasActiveFocusSession` — block until Finish"); Open Questions row on workspace switch + unsaved card edits
- `client/src/lib/workspaceSwitcher.ts` (lines 6–41) — `SwitchAttemptInput`, `SwitchAttemptState`, `getSwitchAttemptState`
- `client/src/lib/workspaceSwitcher.test.ts` — the existing pure-function test file to extend
- `client/src/context/BoardContext.tsx` (lines ~72–73, ~340–402) — `hasUnsavedCardEdits` / `setHasUnsavedCardEdits` and `attemptSwitchWorkspace`, the pattern this task mirrors
- `client/src/context/BoardContext.viewMode.test.tsx` — `MockEventSource` needed to render `BoardProvider`
- `docs/pocket/rule/creative-brief.md` — Copy Guidelines, neutral-friendly register for the blocking message

## WHY THIS APPROACH

Complexity: standard
Justification: five files, but each change is small; the judgment is in guard precedence (focus beats unsaved edits) and in the parent/child wiring, both settled above.

## SANDWICH CONTEXT

[CRITICAL: the focus block is not dismissible. Unlike `hasUnsavedCardEdits`, which offers "confirm and switch anyway", an active focus session must be Finished first — switching away would strand a running server-side timer in a workspace the user is no longer in.]

You are implementing the workspace switch guard for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — workspace-scoped personal sessions; leaving the workspace requires finishing focus.
Files in scope: `client/src/lib/workspaceSwitcher.ts`, `client/src/lib/workspaceSwitcher.test.ts`, `client/src/layout/sidebar/WorkspaceSwitcher.tsx`, `client/src/layout/sidebar/WorkspaceSwitcher.test.tsx`, `client/src/context/BoardContext.tsx`, `client/src/context/BoardContext.focusGuard.test.tsx` — no other files; T7 owns the provider fields/effects consumed here.
Test framework: Vitest + `@testing-library/react`, jsdom. Commands: `npm run test -- client/src/lib/workspaceSwitcher.test.ts` and `npm run test -- client/src/context/BoardContext.focusGuard.test.tsx`.
Available after: T7 (provider plus parent focus flags/hydration setters). Runs in parallel with T8 and T11 — see Parallelizable Groups.
Architecture rule: the decision lives in the pure function in `workspaceSwitcher.ts`; the context only routes to it and reacts. `BoardProvider` never imports `FocusSessionContext` — state flows up via the setter, as `hasUnsavedCardEdits` already does. Client imports carry no extension.

[RESTATE: `focus-blocked` has no "switch anyway" path — the user must Finish focus first.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given an active session in any state (Ready, Running, or Paused) in workspace W1, When a switch to W2 is attempted, Then the switch is blocked and the user is told to finish focus first
[derived] Given no active session and no unsaved edits, When a switch is attempted, Then it proceeds unchanged
[derived] Given both an active session and unsaved card edits, When a switch is attempted, Then the focus block takes precedence
[derived] Given the target workspace is the active one, When a switch is attempted with a session active, Then the result is `noop`
[must-not] Given a blocked switch, When it is refused, Then `activeWorkspaceId` and the persisted workspace id must NOT change
[must-not] Given a blocked switch, When the user is informed, Then the UI must NOT offer a "switch anyway" path

All tests PASS. Commit exists with message matching `feat(focus): block workspace switch while a focus session is active`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- One gate, in the pure `getSwitchAttemptState` — not duplicated in the switcher component or sidebar
- Focus block takes precedence over the unsaved-edits confirm
- A visible message, not a silent no-op
- Tests written BEFORE implementation (TDD — not after)
- Unmount-clear of `hasActiveFocusSession` / `focusSessionHydrated` stays in T7 Step 18 — do not reopen `FocusSessionContext.tsx` to add it here
- Commit message follows conventional commits format

Must-not-have:
- `BoardContext` importing `FocusSessionContext` — that inverts the provider tree
- A second focus check anywhere outside `getSwitchAttemptState`; T12 does not add a provider-side check
- Auto-finishing the session to let a switch through — the user decides
- Blocking navigation between routes inside the same workspace; only workspace switching is guarded

Open question risks:
- Assumption: focus and unsaved-edits guards stay separate, with focus winning. The spec's open question floats a combined dialog if both fire; this plan takes precedence over combination → note it, do not build the combined dialog.

Rollback note:
- Flag off ⇒ no session is ever created ⇒ `hasActiveFocusSession` stays `false` and switching behaves exactly as it does today. Verify rather than assume.

Red flags:
- Work outside the six listed files → DONE_WITH_CONCERNS
- A dismissible focus block → STOP
- `BoardContext` importing the focus provider → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: a combined focus + unsaved-edits dialog is required
Escalate when: the guard appears to need `BoardContext` to read focus state directly

---
### Task 14: Server-side membership revocation finalization [depends: T6, T15]

## OBJECTIVE

Finish an active focus session inside the same transaction that removes a workspace membership. This closes the offline-user gap: a removed member may never receive the SSE event or be able to call `PATCH /focus-session`, so the membership-removal path must accrue and finish the session before deleting access, then publish `payload.session: null` after the transaction commits.

Files:
- Modify: `server/src/routes/helpers.ts`
- Modify: `server/src/routes/focus-session-repo.ts`
- Create: `server/src/routes/focus-session-membership.ts`
- Test: `server/src/routes/focus-session-membership.test.ts`
- Test: `server/src/routes/workspaceAccess.test.ts` (exists — extend it)
- Test: `server/src/routes/members.focus-session.integration.test.ts` (RUN_INTEGRATION-gated)

The route layer remains thin. `focus-session-membership.ts` owns the orchestration of `findActive → applyAction(..., "finish", now) → update`; `focus-session-repo.ts` remains queries and row mapping only.

**Audit seam (matches T4).** The injected dependency is the narrow `RecordFocusActivity` domain type defined in `focus-session.ts` — `({ actor, workspaceId, sessionId, action }) => Promise<void>` — not `typeof recordActivity`, whose five-argument signature would push a Kysely executor into this module. Extend its action union with `"membership_removed"`. Unlike T4-T6, this call runs **inside** the removal transaction, so `createWorkspaceAccessService` binds the default to its `trx` rather than to `db` before passing it in; that binding is the one place the executor is chosen. The underlying `recordActivity` call uses `eventType: "focus_session"` (delivered by T15), never `"update"`.

The real workspace-access `removeMember` transaction binds the repo to its `trx`, finishes the focus row before deleting `workspace_members`, and returns a boolean marker. `createWorkspaceAccessService` publishes the focus null event only after the deletion transaction resolves, followed by the existing membership event.

Steps:

1. Write a failing test for: `Given an active session, When membership removal finalization runs, Then in-flight time is accrued and the session is finished`
   Test file: `server/src/routes/focus-session-membership.test.ts`
   Level: unit

   Test intent:
   Independent unit RED case A: Given a fake repo with a Running row at `version: 4`, `accumulated_seconds: 300`, and `running_since: T0`, When `finishActiveFocusSessionForRemoval({ repo, userId: 7, workspaceId: 3, now: T0 + 120s, recordFocusActivity })` runs, Then it calls `repo.update` with `state: "finished"`, `accumulated_seconds: 420`, `running_since: null`, `finished_at` from the injected clock, and `expectedVersion: 4`, and calls `recordFocusActivity` with `action: "membership_removed"` and the session/workspace/user identifiers. The no-active-row return is a separate case below.
   Exercise through: exported `finishActiveFocusSessionForRemoval`
   Test doubles: fake `FocusSessionRepo`, fixed `now`, and injected `recordFocusActivity()` audit spy; do not mock `applyAction`.
   Expected RED: `focus-session-membership.ts` does not exist.

2. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session-membership.test.ts`
   Expected failure: import resolution fails.

3. Implement the pure membership finalizer, then verify PASS: add `finishActiveFocusSessionForRemoval({ repo, userId, workspaceId, now, recordFocusActivity })`, convert the row to the core snapshot, apply `finish` with the supplied `now`, update through the injected repo, and call `recordFocusActivity` with `action: "membership_removed"`. Do not import Express or Kysely, and do not write a card/task row or `focus_events`. Run `npm run test --workspace=server -- src/routes/focus-session-membership.test.ts`.

3a. Write/run a separate RED→implementation→PASS case for no active row: the finalizer returns `false`, does not update, and does not audit.
    Test file: `server/src/routes/focus-session-membership.test.ts`
    Level: unit
    Exercise through: exported `finishActiveFocusSessionForRemoval` with `findActive` resolving `null`
    Test doubles: fake repo, fixed clock, and injected audit spy
    Expected RED: the finalizer does not yet define the empty-session return contract.
    Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session-membership.test.ts`

4. Write a failing service test for: `Given membership removal finishes a focus session, When the transaction succeeds, Then the focus null event is published before the existing membership event`
   Test file: `server/src/routes/workspaceAccess.test.ts`
   Level: unit

   Test intent:
   Independent service RED case A: Given `createWorkspaceAccessService` receives a successful `removeMember` result with `focusSessionFinished: true`, When the service removes user 4 from workspace 8, Then it calls `publishEvent(8, { type: "focus_session.updated", userId: 4, workspaceId: 8, payload: { session: null } })` before the existing `membership.removed` event. The normal-removal behavior is a separate case below.
   Exercise through: `createWorkspaceAccessService(...).removeMember(...)` and the ordered `publishEvent` spy
   Test doubles: fake transaction-backed `removeMember` result, fixed service clock, ordered `publishEvent` spy, and injected `recordFocusActivity()` audit spy; do not mock the event-ordering branch
   Expected RED: the service only publishes `membership.removed`.

5. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`
   Expected failure: no focus event is published.

6. Implement the post-transaction event marker, then verify PASS for case A: extend the workspace-access dependency/result types and publish the focus null event only when the transaction reports a finished session; preserve the existing redirect event and best-effort semantics. Run `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`.

6a. Write/run a separate RED→implementation→PASS service case for a normal removal with `focusSessionFinished: false`: only `membership.removed` is published and no focus event is emitted.
    Test file: `server/src/routes/workspaceAccess.test.ts`
    Level: unit
    Exercise through: the workspace-access removal service and ordered `publishEvent` spy
    Test doubles: fake transaction result with `focusSessionFinished: false`, publish spy, and audit spy
    Expected RED: the new post-transaction branch may publish a focus event for a removal that finished nothing.
    Run test after implementation: `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`

7. Write a failing integration test for: `Given a removed member has an active focus session, When DELETE membership succeeds, Then membership and focus are finalized atomically`
   Test file: `server/src/routes/members.focus-session.integration.test.ts`
   Level: integration (`RUN_INTEGRATION=1`, requires `make db-up && make db-migrate`)

   Test intent:
   Independent integration RED case A: Given workspace 3, member 7, and a Running focus row for `(user_id: 7, workspace_id: 3)` at a fixed clock, When the actual `DELETE /workspaces/3/members/7` path runs through `membersRouter` and `workspaceAccessService`, Then the membership row is gone, the focus row remains for history but is `finished` with accrued time and `finished_at` set, and the focus-null event is delivered only after commit.
   Independent integration RED case B: inject `failAfterFocusFinalize` so the transaction throws immediately after `finishActiveFocusSessionForRemoval` returns and before the membership DELETE; then assert both the membership row and focus update roll back and no event is published. This is a test-only dependency passed to the service factory, never a global production flag. Do not test this by calling the client PATCH after removal.
   Exercise through: the actual `DELETE /workspaces/3/members/7` HTTP route for case A, and the same service factory with the explicit `failAfterFocusFinalize` seam for case B
   Test doubles: real PostgreSQL fixture and event capture for case A; isolated transaction failure seam for case B; fixed `now: () => FIXED_DATE`; card-event query asserting one `cardId: null` namespaced audit row and no card/task mutation; do not use client PATCH
   Expected RED: the existing removal transaction deletes access without finishing the focus row.

8. Run test — verify FAIL for integration RED case A only: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/members.focus-session.integration.test.ts -t "membership row is gone"`.
   Expected failure: the focus row remains Running.

8a. Run test — verify FAIL for integration RED case B only: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/members.focus-session.integration.test.ts -t "roll back both"`.
   Expected failure: the injected failure seam is missing or the rollback assertion fails.

9. Implement the transaction wiring, then verify PASS:
   - change `createFocusSessionRepo(executor = db)` so it can bind to a Kysely `Transaction<DB>` while keeping all Kysely usage in the repo
   - in the real `workspaceAccessService.removeMember` transaction, call `finishActiveFocusSessionForRemoval` with `createFocusSessionRepo(trx)` and the injected service clock before deleting `workspace_members`
   - return `focusSessionFinished` from the transaction and publish the focus null event only after commit, before `membership.removed`
   - accept `now?: () => Date` and `failAfterFocusFinalize?: () => void` as injected service dependencies; integration tests pass `now: () => FIXED_DATE` and use the failure hook at the precise post-finalization/pre-delete boundary
   - invoke the required `recordFocusActivity()` audit seam for a completed focus mutation with member/workspace/session identifiers and `cardId: null`, while leaving card/task tables and `focus_events` untouched
   Run each integration case separately with `-t "membership row is gone"` and `-t "roll back both"`, then run the complete integration file and `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`.

10. Refactor while green (bounded): keep the finalizer free of persistence-specific branching, keep the membership transaction as the only atomic boundary, and verify `npm run test --workspace=server -- src/routes/focus-session-membership.test.ts`, `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`, and `npm run test`. Also run `npm run typecheck --workspace=server`.

11. Commit:
    `git add server/src/routes/helpers.ts server/src/routes/focus-session-repo.ts server/src/routes/focus-session-membership.ts server/src/routes/focus-session-membership.test.ts server/src/routes/workspaceAccess.test.ts server/src/routes/members.focus-session.integration.test.ts`
    `git commit -m "fix(focus): finalize sessions when membership is removed"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — Architecture Constraints (`recordFocusActivity()`), the confirmed membership-removal behavior, and the `focus_events` decision
- `server/src/routes/helpers.ts` — `createWorkspaceAccessService`, the existing removal transaction, and membership event publishing
- `server/src/routes/members.ts` — actual DELETE route and `mergeParams` mounting
- `server/src/routes/focus-session-repo.ts` — repo seam that must bind to a transaction
- `server/src/core/focus-session.ts` — `applyAction(..., "finish", now)` for authoritative accrual
- `server/src/routes/workspaceAccess.test.ts` and `server/src/routes/members.mutations.test.ts` — existing service and HTTP test patterns

## WHY THIS APPROACH

Complexity: standard
Justification: membership removal is the only path that can invalidate access before the client can finish the session. Keeping the focus transition in the same transaction prevents both stranded offline sessions and a partial removal.

## SANDWICH CONTEXT

[CRITICAL: the client-side `membership.removed` guard is still required for immediate feedback, but it is not the server authority. The server must finish the row before access deletion so offline users cannot leave a Running session permanently active. Publish only after commit so subscribers never observe a focus event for a transaction that later rolls back.]

You are implementing server-side membership revocation finalization for Commit Focus.
Files in scope: `server/src/routes/helpers.ts`, `server/src/routes/focus-session-repo.ts`, `server/src/routes/focus-session-membership.ts`, their tests, and the integration test above.
Test framework: Vitest, node environment. Unit commands use `npm run test --workspace=server -- src/...`; the integration command is gated by `RUN_INTEGRATION=1` and a running database.
Available after: T6 (transaction-bound focus-session repository and server mutation contract).
Architecture rule: NodeNext ESM imports use `.js`; Kysely stays inside `focus-session-repo.ts`; no task mutation or `focus_events` write. Every completed focus mutation calls the injected `recordFocusActivity()` audit seam with a namespaced focus payload.

## DELIVERABLE

Given a member with an active focus session, When membership is removed, Then the session is finished with accrued time in the same transaction before access is deleted
Given the membership transaction rolls back, Then neither the membership deletion nor focus finalization remains
Given finalization succeeds, Then `focus_session.updated` with `payload.session: null` is published after commit, followed by `membership.removed`
[must-not] Given membership removal, When focus logging is considered, Then it must not fabricate a card/task event or write `focus_events`; the required `recordFocusActivity()` call remains namespaced to the focus session

All tests PASS. Commit exists with message matching `fix(focus): finalize sessions when membership is removed`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- finalization uses `applyAction` and an injected clock
- focus update and membership deletion share one database transaction
- focus null event publishes only after commit
- existing membership redirect event remains intact
- no card/task activity is fabricated for a focus mutation; the required audit call is covered by tests and remains namespaced
- tests written BEFORE each implementation boundary

Must-not-have:
- client-only revocation as the sole authority
- a second independent transaction for finishing focus
- Kysely queries outside `focus-session-repo.ts`
- card/task or `focus_events` writes; `recordFocusActivity()` is required through the injected audit seam

## STOP CONDITIONS

Done when: unit and integration tests pass, the root test suite is green, and the conventional commit exists
Uncertain when: the existing membership transaction cannot expose a post-commit event marker without changing its public contract
Escalate when: atomicity requires changing workspace membership schema or task tables

---
### Task 13: Live auto-finish guards — task deleted, access revoked [depends: T12, T14] [test-risk]

## OBJECTIVE

Auto-finish the focus session, with a notification, when the focused task is deleted or the user loses access while they are actively in the app. The load path is already covered server-side (T4 auto-finishes on `GET` when the task no longer resolves), and T14 finalizes membership revocation for offline users; this task covers the user who is sitting on the page when it happens.

Files:
- Modify: `client/src/context/FocusSessionContext.tsx`
- Test: `client/src/context/FocusSessionContext.guards.test.tsx`

T12 does not edit `FocusSessionContext.tsx` (T7 owns it). This task still `[depends: T12, T14]` so the switch-guard flags are already wired and the server-side revocation contract exists before live guards land — see the client single-file ownership note in the File Structure Map.

Three triggers, all arriving on the workspace SSE stream `BoardContext` already consumes: `card.deleted`, `tracker.deleted`, `membership.removed`.

**`[test-risk]` — why.** These scenarios span the SSE transport, the provider's event handling, and (for two of the three) a server call, and the right test level is genuinely arguable. They are pinned here as provider-level integration tests driven through the real subscription seam with a mocked API — not as unit tests of a private handler, and not as end-to-end tests.

Steps:

1. Write failing test for deletion Case A only: board session + matching `card.deleted` auto-finishes
   Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
   Level: integration

   Test intent:
   Given a board-sourced session on `taskId: 481`, When the production `subscribeCardEvents` seam delivers `{ type: "card.deleted", actor, cardId: 481, payload }`, Then `api.focus.patch` is called with `finish`, `session` becomes null, and `showToast` warns. This cycle proves only the matching board-delete path.

   Exercise through: the `BoardContext` `subscribeCardEvents` seam the provider uses in production, delivering the literal Shared-Contract card payload
   Test doubles: test-controlled `subscribeCardEvents` registry on a stubbed `BoardContext`, plus `user`, `activeWorkspaceId`, `vi.fn()` `showToast`, and mocked `../api`; do NOT mock the provider's event handler
   Expected RED: the provider does not subscribe to card events, so `api.focus.patch` is never called when Case A requires it to be called. A "session stays populated" assertion is not this case's RED.

2. Run test — verify FAIL for Case A only: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "matching card.deleted"`
   Expected failure: `expected "spy" to be called at least once`

3. Implement Case A only: subscribe through `subscribeCardEvents` (T7 seam; if missing, report a T7 defect — do not patch `BoardContext.tsx` here). For `source: "board"`, compare `event.cardId` to `session.taskId` and then `finish()`, clear state, and toast. Do not yet handle tracker events or membership.

4. Run test — verify PASS for Case A only: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "matching card.deleted"`

4a. Write/run a separate RED→implementation→PASS cycle for deletion Case B: board session + different `cardId` does nothing
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given the same board session on 481, When `card.deleted` arrives with `cardId: 482`, Then `api.focus.patch` is not called, `session` stays populated, and no toast fires.
    Exercise through: the same `subscribeCardEvents` seam with a literal non-matching payload
    Test doubles: stubbed `BoardContext` card registry, mocked `../api`, `vi.fn()` `showToast`; do not mock the handler
    Expected RED: a Case A handler that finishes on every `card.deleted` without comparing `cardId` fails this test because the spy was called. Do not use "no handler exists / patch never called" as Case B's RED — that would already pass before any subscription exists.
    Run FAIL: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "different cardId"`. If Step 3 already compared `cardId`, tighten nothing and continue to the PASS command; still run both commands. PASS: the same `-t "different cardId"` command.

4b. Write a failing test for deletion Case C only: tracker session + matching `tracker.deleted` auto-finishes
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given a tracker-sourced session on `taskId: 77`, When `subscribeTrackerEvents` delivers `{ type: "tracker.deleted", actor, trackerItemId: 77 }`, Then finish is called, `session` clears, and the user is warned.
    Exercise through: the T7 `subscribeTrackerEvents` seam with the literal tracker payload
    Test doubles: test-controlled tracker registry, mocked `../api`, `vi.fn()` `showToast`; do not mock the handler
    Expected RED: the provider does not subscribe to tracker deletion, so the matching-tracker spy is never called.

4c. Run test — verify FAIL for Case C only: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "matching tracker.deleted"`
    Expected failure: `expected "spy" to be called at least once`

4d. Implement the tracker matching path only: subscribe through `subscribeTrackerEvents`; compare `event.trackerItemId` to `session.taskId`, then finish/clear/toast. Do **not** check `session.source` yet and do not add a cross-source id fallback. Case C's fixture is tracker-sourced, so source filtering is not required to make Case C green; leaving source unchecked is what makes Case D's RED reachable.

4e. Run test — verify PASS for Case C only: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "matching tracker.deleted"`

4f. Write a failing test for deletion Case D only: ADR #103 colliding id must not finish a board session
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given a board-sourced session on `taskId: 481`, When `tracker.deleted` arrives with `trackerItemId: 481`, Then the session must stay populated and `api.focus.patch` must not be called. Assert the source check runs before any id comparison: a `tracker.*` event is ignored outright for a board-sourced session. Because `card.*` and `tracker.*` already use different field names, an implementation that reads `event.cardId ?? event.trackerItemId` (or any unified id) would pass Cases A/C by accident and still be wrong for a future unified `work_items` payload.
    Exercise through: the tracker subscription seam delivering a colliding-id tracker payload at a board session
    Test doubles: stubbed tracker registry, mocked `../api`, `vi.fn()` `showToast`; do not mock the handler
    Expected RED: after Step 4d, the tracker handler compares `trackerItemId` without checking `session.source`, so a board session on 481 finishes when `tracker.deleted` 481 arrives. If Step 4d already discarded tracker events for board sessions, do not chase a FAIL by stripping that guard — continue to the PASS command (same hatch as Case B). Never use "no handler exists" as Case D's RED.

4g. Run test — verify FAIL for Case D only: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "colliding tracker.deleted"`
    Expected failure: `expected "spy" not to be called` (finish ran). If the command is already green because Step 4d filtered on source, skip nothing: record that PASS and proceed to Step 4h only to make the source-before-id discard explicit.

4h. Implement the board←tracker source-before-id discard only, then verify PASS: ignore `tracker.*` events when `session.source === "board"` **before** comparing ids. Do **not** yet ignore `card.*` events for tracker-sourced sessions — that inverse is Case F below. Run `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "colliding tracker.deleted"`, then re-run Cases A–C `-t` filters so they stay PASS.

4i. Write/run a separate RED→implementation→PASS cycle for deletion Case E: tracker session + different `trackerItemId` does nothing
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given a tracker-sourced session on `taskId: 77`, When `tracker.deleted` arrives with `trackerItemId: 99`, Then `api.focus.patch` is not called, `session` stays populated, and no toast fires. After Case D's source filter, a handler that finishes on every `tracker.deleted` still passes Cases C/D.
    Exercise through: the tracker subscription seam
    Test doubles: stubbed tracker registry, mocked `../api`, `vi.fn()` `showToast`
    Expected RED: a Case C handler that finishes on every `tracker.deleted` without comparing `trackerItemId` fails this test. If Step 4d already compared `trackerItemId`, continue to PASS (same hatch as Case B). Never use "no handler exists" as Case E's RED.
    Run FAIL then PASS: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "different trackerItemId"`

4j. Write a failing test for deletion Case F only: inverse ADR #103 — tracker session must ignore colliding `card.deleted`
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given a tracker-sourced session on `taskId: 481`, When `card.deleted` arrives with `cardId: 481`, Then the session stays populated and `api.focus.patch` is not called. A unified `event.cardId ?? event.trackerItemId` matcher would finish this session after Case A exists.
    Exercise through: the card subscription seam delivering a colliding-id card payload at a tracker session
    Test doubles: stubbed card registry, mocked `../api`, `vi.fn()` `showToast`
    Expected RED: Step 4h only discarded tracker events for board sessions, so a tracker session still finishes on colliding `card.deleted`.
    Run FAIL: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "colliding card.deleted"`
    Expected failure: `expected "spy" not to be called` (finish ran).

4k. Implement the inverse source-before-id discard, then verify PASS: ignore `card.*` events when `session.source === "tracker"` before comparing ids. Run `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "colliding card.deleted"`, then re-run Cases A–E `-t` filters.

4l. Write/run a separate RED→implementation→PASS cycle for matching `*.updated` must not auto-finish
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Independent cases with their own `-t` names: (1) board session on 481 + `card.updated` `{ cardId: 481 }` does not call finish/PATCH and leaves the session populated; (2) tracker session on 77 + `tracker.updated` `{ trackerItemId: 77 }` does the same. T9 refreshes title on these events with a mocked `useFocusSession`, so it cannot catch the provider exiting focus on a title edit.
    Exercise through: the same card/tracker seams with `*.updated` payloads
    Test doubles: stubbed registries, mocked `../api` asserted not called for patch, `vi.fn()` `showToast`
    Expected RED: a `card.*` / `tracker.*` handler that finishes on any matching id, including `updated`, calls PATCH. Restrict auto-finish to `*.deleted` only.
    Run FAIL then PASS separately: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "card.updated does not finish"` and `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "tracker.updated does not finish"`

4m. Write/run a separate RED→implementation→PASS cycle for deletion auto-finish when PATCH rejects
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given a board session on 481, When matching `card.deleted` arrives and `api.focus.patch` rejects `409 { code: "version_conflict", session }` (and a second named case for 5xx), Then local `session` is still null, the toast still fires, and the provider must NOT adopt the 409 body as the active session. T7's PATCH `version_conflict` handler would otherwise put the user back on a deleted task.
    Exercise through: the card subscription seam plus the provider `finish()` path
    Test doubles: mocked `../api` rejecting with typed 409 then 5xx; stubbed card registry; `vi.fn()` `showToast`; do not mock the handler
    Expected RED: finish rejection is routed through T7's silent 409 adoption, so `session` stays populated with the body.
    Run FAIL then PASS separately: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "deleted finish 409 still clears"` and `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "deleted finish 5xx still clears"`

5. Write failing test for membership Case A only: matching `membership.removed` auto-finishes even when PATCH 404s
   Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
   Level: integration

   Test intent:
   Given an active session in workspace 3 for user 7, When `subscribeMembershipEvents` delivers `{ type: "membership.removed", userId: 7, workspaceId: 3, workspaceName: "Workspace 3" }` and `api.focus.patch` rejects 404, Then local state is cleared and the user is notified; no unhandled rejection or phantom session remains. Do not assert BoardContext's redirect here (T7 Steps 7–9 cover the real provider).

   Exercise through: the T7 `subscribeMembershipEvents` seam with the literal four-field membership payload
   Test doubles: mocked `../api` whose `patch` rejects with a 404; stubbed membership registry; `vi.fn()` `showToast`; do not mock the handler
   Expected RED: the provider ignores membership events, so state stays populated, or the rejected finish surfaces as an unhandled rejection

6. Run test — verify FAIL for membership Case A only: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "matching membership.removed"`
   Expected failure: the event is ignored or the 404 rejection is unhandled.

6a. Implement the matching membership path only: subscribe through `subscribeMembershipEvents`; on a matching `userId`/`workspaceId` clear state and toast even when finish 404s. Do not yet add the different-user filter as a combined assertion.

6b. Run test — verify PASS for membership Case A only: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "matching membership.removed"`

6c. Write/run a separate RED→implementation→PASS cycle for membership Case B: `membership.removed` for a different user does nothing
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given the same session for user 7, When `membership.removed` arrives with `userId: 9`, Then no finish call, state clear, or toast occurs.
    Exercise through: the membership seam with `userId: 9`, `workspaceId: 3`, `workspaceName: "Workspace 3"`
    Test doubles: mocked `../api`, stubbed membership registry, `vi.fn()` `showToast`
    Expected RED: a membership handler that does not compare `userId` finishes the current user's session. Do not use "no membership handler exists" as this case's RED.
    Run FAIL: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "different user membership"`. Implement the user-id guard if the spy was called. PASS: the same `-t` command.

7. Write failing test for null-session Case A only: `card.deleted` is inert when `session` is null
   Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
   Level: integration

   Test intent:
   Given `session: null`, When a `card.deleted` event arrives, Then no API call or toast occurs. Write this after the deletion handlers exist so the RED is a handler that runs unconditionally, not the absence of a handler.

   Exercise through: `subscribeCardEvents` with a null session
   Test doubles: mocked `../api` asserted not called; stubbed card registry; `vi.fn()` `showToast`
   Expected RED: the Case A card handler runs unconditionally and calls `finish()` on a null session

7a. Run test — verify FAIL for null-session Case A only: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "no session card.deleted"`
    Expected failure: `finish`/patch is called against a null session.

7b. Guard the card handler on an active session, then verify PASS: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "no session card.deleted"`

7c. Write/run a separate RED→implementation→PASS cycle for null-session Case B: `tracker.deleted` with `session: null` makes no API call or toast
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Exercise through: `subscribeTrackerEvents` with a null session
    Test doubles: mocked `../api` asserted not called
    Expected RED: the tracker handler runs unconditionally on a null session
    Run FAIL then PASS: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "no session tracker.deleted"`

7d. Write/run a separate RED→implementation→PASS cycle for null-session Case C: `membership.removed` with `session: null` makes no API call or toast
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Exercise through: `subscribeMembershipEvents` with a null session
    Test doubles: mocked `../api` asserted not called
    Expected RED: the membership handler runs unconditionally on a null session
    Run FAIL then PASS: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx -t "no session membership.removed"`

8. Re-run the full guards file after the independent cycles: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx`
   Expected: PASS for every named `-t` case above.

9. Refactor while green (bounded):
   - Rule of three: "does this event refer to the focused task" is asked by three handlers — extract one named predicate (e.g. `eventTargetsFocusedTask(session, event)`) inside the provider, comparing `source` and `taskId` together. Never a generic `utils.ts`
   - "clear state + toast" also runs three times — one `autoFinish(reason)` helper
   - If `FocusSessionContext.tsx` crosses ~300 lines, extract the guard handlers into the mapped `client/src/lib/focusGuards.ts` as pure functions and add `client/src/lib/focusGuards.test.ts` covering the extracted predicates; both conditional files belong in the commit below
   - Re-run `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx`, the T7 suite `npm run test -- client/src/context/FocusSessionContext.test.tsx`, and the full client suite — all must stay PASS

10. Commit:
    `git add client/src/context/FocusSessionContext.tsx client/src/context/FocusSessionContext.guards.test.tsx`
    If Step 9 extracted `client/src/lib/focusGuards.ts` and its test, additionally run `git add client/src/lib/focusGuards.ts client/src/lib/focusGuards.test.ts` before committing.
    `git commit -m "feat(focus): auto-finish focus session on task deletion or access loss"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Guards (`✓ task deleted → auto-Finish + notification`, `✓ access revoked → auto-Finish + notification`); "Story: Workspace and access guards"; Implementation Notes ("subscribe to `card.deleted`, `tracker.deleted`, `membership.removed` SSE; toast via `showToast`"); Open Questions row confirming auto-finish + toast then the existing workspace redirect on `membership.removed`
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — `cards` and `tracker_items` ids overlap; an event must be matched on `source` **and** id, never id alone
- `client/src/context/BoardContext.tsx` (lines ~528–585) — the `onmessage` dispatch, the `membership.removed` handling, and the existing removal redirect this guard must not interfere with
- `client/src/context/FocusSessionContext.tsx` (T7) — the provider, its `finish` action, and the subscription seam
- `docs/pocket/rule/creative-brief.md` — Copy Guidelines; the notification is informative and calm, not alarming

## WHY THIS APPROACH

Complexity: standard
Justification: one primary file, but three event paths with different failure characteristics — and the revocation path must work correctly precisely when the API is guaranteed to fail.

## SANDWICH CONTEXT

[CRITICAL: match deletion events on `source` AND `taskId` together. `cards` and `tracker_items` have independent id sequences, so card 481 and tracker item 481 both exist. Matching on id alone will silently finish a user's focus session because an unrelated item in the other table was deleted.]

You are implementing the live auto-finish guards for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — the server is the session authority, but the client reacts to realtime events so a user watching the page is not left focused on a task that no longer exists.
Files in scope: `client/src/context/FocusSessionContext.tsx`, `client/src/context/FocusSessionContext.guards.test.tsx` — no other files (plus a pure-guards extraction if Step 9 triggers one).
Test framework: Vitest + `@testing-library/react`, jsdom. Single file: `npm run test -- client/src/context/FocusSessionContext.guards.test.tsx`.
Available after: T12 and T14 (T12 consumes parent flags only and must not edit this file; T14 supplies the server-side offline-revocation contract), and through them T7 (provider, all three subscription seams, `finish` action). T7 and T13 are the only writers of `FocusSessionContext.tsx`.
Architecture rule: react to events through the existing `BoardContext` subscription seam — do not open a second `EventSource`. On `membership.removed`, clear local state and toast even when the server call fails, and let `BoardContext`'s existing removal redirect proceed. Client imports carry no extension.

[RESTATE: compare `source` and `taskId` together — a dual-table id collision must never finish the wrong session.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given an active session on task T, When T is soft-deleted and the `card.deleted` or `tracker.deleted` event arrives, Then the session auto-finishes and the user is notified
Given an active session in workspace W, When the user is removed from W, Then the session auto-finishes with a notification (that the existing workspace redirect still runs is proven by T7 Steps 7–9 against a real `BoardProvider`; T13 stubs the context, so do not try to assert it here)
[derived] Given a deletion event for a different task, When it arrives, Then nothing happens — proven for both board (`different cardId`) and tracker (`different trackerItemId`)
[derived] Given a `membership.removed` for a different user, When it arrives, Then nothing happens
[derived] Given no active session, When any guard event arrives, Then no API call is made and no toast is shown
[must-not] Given a board-sourced session on `taskId: 481`, When `tracker.deleted` arrives for tracker item 481, Then the session must NOT be finished — the ids come from different tables, and the source must be checked before any id comparison, not inferred from which field happens to be present
[must-not] Given a tracker-sourced session on `taskId: 481`, When `card.deleted` arrives for card 481, Then the session must NOT be finished — the inverse ADR #103 collision
[must-not] Given an active session on task T, When `card.updated` or `tracker.updated` arrives for T, Then the session must NOT auto-finish — only `*.deleted` finishes; title refresh is T9
[must-not] Given matching `card.deleted`, When finish/PATCH rejects 409 or 5xx, Then the UI must NOT retain the 409 body as the active session — clear locally and toast
[must-not] Given `membership.removed` and a failing finish call, When the guard runs, Then the UI must NOT retain a phantom session or surface an unhandled rejection

All tests PASS. Commit exists with message matching `feat(focus): auto-finish focus session on task deletion or access loss`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Source checked **before** id on every deletion event — a `tracker.*` event is discarded for a board-sourced session without ever comparing ids, and vice versa
- Local state cleared and the user notified even when the server call fails
- The existing `membership.removed` redirect in `BoardContext` still runs
- Guards inert when no session is active
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — one target predicate and one auto-finish helper, not three copies of each
- Commit message follows conventional commits format

Must-not-have:
- A second `EventSource` or a polling loop
- Auto-finish on any trigger not listed here — in particular, not on a task status change, and not on the user simply navigating away
- Swallowing `membership.removed` so the workspace redirect never fires
- A `notifications` table write — the spec makes that optional and this plan does not include it

Open question risks:
- Assumption: a `showToast` warning is sufficient notification; no `notifications` row is written. If a persistent notification is required, that is additive → note it, do not block.
- Assumption: T7's `subscribeCardEvents`, `subscribeTrackerEvents`, and `subscribeMembershipEvents` all deliver their events. If a seam is missing, report it as a T7 defect rather than patching `BoardContext` here.

Rollback note:
- Flag off ⇒ no sessions exist ⇒ these handlers never fire. Nothing here changes board or tracker behavior.

Red flags:
- Work outside the two listed files → DONE_WITH_CONCERNS
- Id-only event matching → STOP
- Editing `BoardContext.tsx` → STOP
- A second SSE connection → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: a persistent `notifications` row is required instead of a toast
Escalate when: the guards appear to need a second realtime connection, or `BoardContext`'s removal redirect cannot coexist with the auto-finish

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|------------------|
| T1 | `focus_sessions` schema + Kysely types | prereq | lightweight | Partial unique index allows at most one non-finished session per (user, workspace); `task_id` carries no cross-table FK |
| T2 | Focus session domain core | prereq | standard | Start → 10m → Pause yields 600s; Resume → 5m → Pause yields 900s; paused time never accrues |
| T3 | `FOCUS_MODE_ENABLED` flag + client visibility | prereq | standard | `GET /focus/config` reports the flag; a rejected fetch degrades to "feature off" |
| T4 | Focus session route — read + create | T1, T2, T3 | standard | Focus on a board card persists Ready + `returnPath`; re-focus is idempotent; a different task returns 409 `session_active` |
| T5 | Focus session route — lifecycle + locking | T4 | standard | Pause after 10m records 600s; Finish leaves task status untouched; stale version returns 409 with the current session |
| T6 | Focus session route — atomic switch | T5 | standard | Switch finishes A and creates B Ready in one transaction; stale `expectedVersion` returns null against PostgreSQL; successful switch audits |
| T7 | Client focus session provider + 3 SSE seams | T6 | standard | Multi-tab pause syncs via SSE; PATCH and POST `version_conflict` adopt the body; `card.deleted` / `tracker.deleted` fan out from a real BoardProvider |
| T8 | `FocusTimer` display + controls | T7 | lightweight | Running display advances 1200s → 1290s over 90s; paused keeps no interval scheduled |
| T9 | `/focus` route + `FocusPage` | T8 | standard | No session redirects to `/board`; task loads by `(source, id)`; only title + description render |
| T10 | Entry points + confirm-switch | T6, T9 | standard | Entry from board and tracker; re-focus needs no dialog; cancel leaves the running session untouched |
| T11 | Global "Focus active" nav indicator | T7 | lightweight | Indicator appears only with an active session and returns the user to `/focus` |
| T12 | Workspace switch guard | T7 | standard | Any active session blocks a workspace switch, with no "switch anyway" path |
| T14 | Server-side membership revocation finalization | T6 | standard | Membership removal finishes the active focus row atomically before deleting access and publishes the null session event after commit |
| T13 | Live auto-finish guards | T12, T14 | standard | Task deletion or access loss auto-finishes with a notification; `source` + id matched both directions; `*.updated` does not finish |
