# Multi-Workspace MVP — Workspace-scoped board, metrics, activity, and card APIs (Phase 2 of 3)

**Date:** 2026-06-13
**Original plan:** docs/pocket/plans/2026-06-13-multi-workspace/execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T4, T5, T6}
**Unlocks next:** Phase 3

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T4: Workspace-scoped board, metrics, activity, and card APIs [depends: T3]
T5: Per-workspace realtime, presence, and removal events [depends: T3]
T6: Client workspace selection state and scoped data context [depends: T4, T5]

---

## Pocket Packets

---

### Task 4: Workspace-scoped board, metrics, activity, and card APIs [depends: T3]

## OBJECTIVE

Move board data routes under `/api/workspaces/:workspaceId/...` and enforce workspace isolation for columns, cards, moves, metrics, activity, and card deep-link reads.

Files:
- Modify: `server/src/routes.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/types.ts`
- Test: `server/src/routes/workspaceAccess.test.ts`
- Test: `client/src/api.test.ts`

Steps:
1. Write failing test for: Cross-workspace board/card isolation.
   File: `server/src/routes/workspaceAccess.test.ts`
   Test verifies: Given user "oscar" is member of WS-A only, When oscar requests a card or board data in WS-B by ID, Then 404; Given board reads in WS-A, When columns/cards/events exist in WS-B, Then WS-B rows are absent.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import { createScopedBoardService } from "../routes.js";

   describe("scoped board service", () => {
     it("returns 404 for non-member card reads", async () => {
       const service = createScopedBoardService({
         getMembership: vi.fn(async (_workspaceId, userId) => (userId === 1 ? null : { role: "member" })),
         getCardById: vi.fn(async () => ({ id: 42, workspaceId: 2, title: "Hidden" })),
         getBoardRows: vi.fn(),
         getActivityRows: vi.fn(),
       });

       await expect(service.getCard({ userId: 1, workspaceId: 2, cardId: 42 }))
         .resolves.toEqual({ status: 404, error: "Not found" });
     });

     it("filters board rows to the requested workspace", async () => {
       const service = createScopedBoardService({
         getMembership: vi.fn(async () => ({ role: "member" })),
         getCardById: vi.fn(),
         getBoardRows: vi.fn(async (workspaceId) => [
           { id: 10, workspaceId, title: "WS-A column", cards: [{ id: 100, workspaceId, title: "Keep" }] },
         ]),
         getActivityRows: vi.fn(async (workspaceId) => [
           { id: 200, workspaceId, cardTitle: "Keep activity" },
         ]),
       });

       const board = await service.getBoard({ userId: 1, workspaceId: 1 });
       expect(board).toMatchObject({
         columns: [{ id: 10, workspaceId: 1, cards: [{ id: 100, workspaceId: 1 }] }],
         activity: [{ id: 200, workspaceId: 1 }],
       });
       expect(JSON.stringify(board)).not.toContain("WS-B");
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`
   Expected failure: board routes are still global and not path-prefixed.

3. Implement minimal code to satisfy the test:
   File: `server/src/routes.ts`
   Implement: path-prefixed board routes for board, columns, cards, card update/delete/move, metrics, metrics history, activity, and per-card activity; add workspace membership checks; constrain every query by `workspace_id`; keep optimistic locking and WIP behavior unchanged inside scoped queries.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`
   Expected: PASS

5. Write failing client API tests for scoped board paths.
   File: `client/src/api.test.ts`
   Test verifies: board, metrics, history, activity, presence, card, column, and move methods include `/workspaces/:workspaceId` in the request path.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";

   const mockFetch = vi.fn();
   vi.stubGlobal("fetch", mockFetch);

   describe("scoped board API paths", () => {
     it("prefixes board, metrics, activity, presence, and card methods with workspace id", async () => {
       mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
       const { api } = await import("./api");

       await api.getBoard(7);
       await api.getMetrics(7);
       await api.getMetricsHistory(7);
       await api.getActivity(7);
       await api.getPresence(7);
       await api.getCard(7, 42);
       await api.createCard(7, { columnId: 1, title: "New" });
       await api.moveCard(7, 42, { toColumnId: 2, position: 1000, version: 3 });

       const paths = mockFetch.mock.calls.map(([path]) => path);
       expect(paths).toEqual([
         "/api/workspaces/7/board",
         "/api/workspaces/7/metrics",
         "/api/workspaces/7/metrics/history",
         "/api/workspaces/7/activity",
         "/api/workspaces/7/presence",
         "/api/workspaces/7/cards/42",
         "/api/workspaces/7/cards",
         "/api/workspaces/7/cards/42/move",
       ]);
     });
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/api.test.ts`
   Expected failure: API wrapper methods currently call global paths.

7. Implement minimal code to satisfy the test:
   File: `client/src/api.ts`
   Implement: workspaceId argument or scoped API factory for all board methods.
   File: `client/src/types.ts`
   Implement: any additional response fields needed by scoped routes.

8. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts && npm run test --workspace=client -- src/api.test.ts`
   Expected: PASS

9. Commit:
   `git add server/src/routes.ts server/src/routes/workspaceAccess.test.ts client/src/api.ts client/src/api.test.ts client/src/types.ts`
   `git commit -m "feat(workspaces): scope board api"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — rules: Data isolation and real-time, Deep links.
server/src/routes.ts — current board, columns, cards, metrics, activity, presence, SSE routes.
client/src/api.ts — current global board method paths.

## WHY THIS APPROACH

Complexity: deep
Justification: Board scoping spans many routes, but all are in one router file and share the same membership/query boundary.

## SANDWICH CONTEXT

[CRITICAL: All board, metrics, activity, and card queries must filter by workspace membership and `workspace_id`.]
You are implementing scoped board APIs for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: API path prefix `/api/workspaces/:id/...`.
Files in scope: `server/src/routes.ts`, `server/src/routes/workspaceAccess.test.ts`, `client/src/api.ts`, `client/src/api.test.ts`, `client/src/types.ts`
Test framework: Vitest colocated in `server/src/**/*.test.ts` and `client/src/**/*.test.ts`
Available after: T3
Architecture rule: keep core modules pure by passing only scoped rows into `computeFlowMetrics`, `computeMetricsHistory`, and WIP helpers.
[RESTATE: All board, metrics, activity, and card queries must filter by workspace membership and `workspace_id`.]

## DELIVERABLE

Given user "oscar" member of WS-A only, When oscar requests card in WS-B by ID, Then 404.
Given WS-A board read, When WS-B columns/cards/events exist, Then they are not returned.
Given card move in WS-A, When optimistic locking and WIP checks run, Then existing 409 behavior remains scoped to WS-A.
Given card not in active workspace, When client loads it through scoped API, Then the API returns 404 for the client to redirect silently.

All tests PASS. Commit exists with message matching `feat(workspaces): scope board api`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - All board/data queries include workspace membership and `workspace_id` filters.
  - Existing WIP, optimistic locking, activity recording, and soft delete semantics remain intact.
  - Client board APIs require an active workspace id.
  - Tests written before implementation.
  - Commit message follows conventional commits format.

Must-not-have:
  - No changes to `server/src/core/*`.
  - No cross-workspace dashboard or aggregation.
  - No slug-based URL routing.

Open question risks:
  - Deep links intentionally redirect to `/board` instead of auto-switching workspace.

Rollback note:
  - Partial deploy with scoped client and unscoped server is unsafe; deploy scoped API/client together or rollback both.

## STOP CONDITIONS

Done when: scoped API tests pass, client API path tests pass, commit created.
Uncertain when: any global route must remain for compatibility.
Escalate when: any route cannot distinguish non-member 404 from missing entity without leaking workspace existence.

---

### Task 5: Per-workspace realtime, presence, and removal events [depends: T3]

## OBJECTIVE

Scope Redis pub/sub, local SSE fallback, presence keys, and membership removal events per workspace.

Files:
- Modify: `server/src/realtime.ts`
- Modify: `server/src/routes.ts`
- Test: `server/src/realtime.test.ts`
- Test: `server/src/routes/workspaceAccess.test.ts`

Steps:
1. Write failing test for: Realtime workspace isolation and Redis degradation.
   File: `server/src/realtime.test.ts`
   Test verifies: Given WS-A and WS-B clients connected through local fallback, When event fires in WS-B, Then WS-A clients do not receive it; Given Redis channel naming, Then events publish to `camel:workspace:{id}:events`; Given presence keys, Then scans are restricted to `camel:workspace:{id}:presence:*`.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import {
     createRealtimeHub,
     workspaceEventChannel,
     workspacePresencePattern,
   } from "./realtime.js";

   describe("workspace realtime isolation", () => {
     it("keeps local fallback clients isolated by workspace", async () => {
       const hub = createRealtimeHub({ publisher: null, subscriber: null });
       const wsA = hub.connectLocalClient({ workspaceId: 1, userId: 10 });
       const wsB = hub.connectLocalClient({ workspaceId: 2, userId: 11 });

       await hub.publishEvent(2, { type: "card.created", cardId: 42 });

       expect(wsA.drain()).toEqual([]);
       expect(wsB.drain()).toEqual([{ type: "card.created", cardId: 42 }]);
     });

     it("uses workspace-specific Redis channels and presence key scans", async () => {
       expect(workspaceEventChannel(7)).toBe("camel:workspace:7:events");
       expect(workspacePresencePattern(7)).toBe("camel:workspace:7:presence:*");

       const publish = vi.fn(async () => 1);
       const scanIterator = vi.fn(async function* () {
         yield "camel:workspace:7:presence:1";
       });
       const hub = createRealtimeHub({ publisher: { publish }, subscriber: null, presence: { scanIterator } });

       await hub.publishEvent(7, { type: "card.updated", cardId: 5 });
       await hub.onlineUsers(7);

       expect(publish).toHaveBeenCalledWith("camel:workspace:7:events", expect.any(String));
       expect(scanIterator).toHaveBeenCalledWith({ MATCH: "camel:workspace:7:presence:*" });
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/realtime.test.ts`
   Expected failure: realtime uses global channel, global presence prefix, and global local client set.

3. Implement minimal code to satisfy the test:
   File: `server/src/realtime.ts`
   Implement: workspace-aware `publishEvent`, `sseHandler`, `heartbeat`, `clearPresence`, and `onlineUsers`; per-workspace Redis channels; per-workspace local client registry; graceful degradation unchanged.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/realtime.test.ts`
   Expected: PASS

5. Write failing route test for: membership removal event.
   File: `server/src/routes/workspaceAccess.test.ts`
   Test verifies: Given nina is removed from WS-R, When removal succeeds, Then `membership.removed` is published to WS-R and includes removed user id and workspace name; Given nina is removed from WS-R while viewing WS-S, Then no WS-S event is published.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import { createWorkspaceAccessService } from "../routes.js";

   describe("membership removal events", () => {
     it("publishes membership.removed only to the removed workspace", async () => {
       const publishEvent = vi.fn(async () => undefined);
       const clearPresence = vi.fn(async () => undefined);
       const service = createWorkspaceAccessService({
         getActorMembership: vi.fn(async () => ({ userId: 1, role: "admin" })),
         getWorkspaceOwner: vi.fn(async () => ({ userId: 1, role: "owner" })),
         getWorkspace: vi.fn(async () => ({ id: 8, name: "WS-R" })),
         removeMember: vi.fn(async () => ({ userId: 4, username: "nina" })),
         publishEvent,
         clearPresence,
       });

       await service.removeMember({ actorId: 1, workspaceId: 8, userId: 4 });

       expect(publishEvent).toHaveBeenCalledWith(8, {
         type: "membership.removed",
         userId: 4,
         workspaceId: 8,
         workspaceName: "WS-R",
       });
       expect(publishEvent).not.toHaveBeenCalledWith(9, expect.anything());
       expect(clearPresence).toHaveBeenCalledWith(8, 4);
     });
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`
   Expected failure: removal does not emit workspace-scoped `membership.removed`.

7. Implement minimal code to satisfy the test:
   File: `server/src/routes.ts`
   Implement: publish workspace-scoped `membership.removed` after member removal and delete presence for removed user in that workspace.

8. Run test — verify PASS:
   `npm run test --workspace=server -- src/realtime.test.ts src/routes/workspaceAccess.test.ts`
   Expected: PASS

9. Commit:
   `git add server/src/realtime.ts server/src/realtime.test.ts server/src/routes.ts server/src/routes/workspaceAccess.test.ts`
   `git commit -m "feat(workspaces): isolate realtime events"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — rules: Removal and real-time, Data isolation and real-time.
server/src/realtime.ts — current Redis Pub/Sub, SSE local fan-out, presence scan implementation.
Redis Node.js Client docs — `scanIterator`, `mGet`, `subscribe`, and `publish` usage.

## WHY THIS APPROACH

Complexity: standard
Justification: Event producer/consumer isolation is independent after workspace route contracts exist and can run parallel to board query scoping.

## SANDWICH CONTEXT

[CRITICAL: Redis-down local fan-out must still filter events by active workspace.]
You are implementing per-workspace realtime for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: Redis channels `camel:workspace:{id}:events`; presence keys `camel:workspace:{id}:presence:{userId}`.
Files in scope: `server/src/realtime.ts`, `server/src/realtime.test.ts`, `server/src/routes.ts`, `server/src/routes/workspaceAccess.test.ts`
Test framework: Vitest colocated in `server/src/**/*.test.ts`
Available after: T3
Architecture rule: preserve Redis degradation semantics while preventing cross-workspace event delivery.
[RESTATE: Redis-down local fan-out must still filter events by active workspace.]

## DELIVERABLE

Given oscar SSE connected to WS-A, When card created in WS-B, Then oscar does not receive that event.
Given Redis is down and local fan-out is used, When event fires in WS-B, Then WS-A clients do not refresh.
Given user "nina" is viewing WS-R and has personal workspace WS-N, When admin removes nina from WS-R, Then SSE event `membership.removed` is delivered for WS-R.
Given nina is viewing WS-S, When nina is removed from WS-R, Then no redirect-triggering event occurs for WS-S.

All tests PASS. Commit exists with message matching `feat(workspaces): isolate realtime events`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - Redis channel and local fallback both include workspace separation.
  - Presence list is per workspace.
  - Unknown event fields are tolerated by clients.
  - Tests written before implementation.
  - Commit message follows conventional commits format.

Must-not-have:
  - No global SSE channel remains for board events.
  - No cross-workspace event delivery.
  - No changes to `server/src/core/*`.

Open question risks:
  - Personal workspace redirect depends on `is_personal` being reliable.

Rollback note:
  - Partial deploy risks stale client reconnects; keep old and new event paths aligned during deployment.

## STOP CONDITIONS

Done when: realtime tests pass, removal event route test passes, commit created.
Uncertain when: Redis client cannot subscribe dynamically per workspace without a connection strategy adjustment.
Escalate when: local fallback cannot know each client's workspace id.

---

### Task 6: Client workspace selection state and scoped data context [depends: T4, T5]

## OBJECTIVE

Add active workspace state to the client root, restore last-active workspace, load/scope all board context by workspace, reconnect SSE, handle membership removal redirect, and silently clear invalid card deep links.

Files:
- Modify: `client/src/App.tsx`
- Modify: `client/src/context/BoardContext.tsx`
- Modify: `client/src/components/ContextPanel.tsx`
- Modify: `client/src/api.ts`
- Modify: `client/src/types.ts`
- Test: `client/src/lib/workspaceSelection.test.ts`
- Test: `client/src/api.test.ts`
- Test: `client/src/lib/cardPanel.test.ts`

Steps:
1. Write failing test for: workspace selection state decisions.
   File: `client/src/lib/workspaceSelection.test.ts`
   Test verifies: Given last-active workspace valid, When session initializes, Then restore it; Given single workspace and no saved id, Then auto-land; Given invalid saved workspace, Then picker state is required and saved id is cleared; Given removal from active workspace with personal workspace available, Then redirect target is personal workspace and toast copy is "You were removed from {name}."
   Test code:
   ```ts
   import { describe, expect, it } from "vitest";
   import {
     WORKSPACE_STORAGE_KEY,
     chooseInitialWorkspace,
     getRemovalRedirect,
     planWorkspaceRefresh,
   } from "./workspaceSelection";

   const wsA = { id: 1, name: "WS-A", role: "member", isPersonal: false };
   const wsB = { id: 2, name: "WS-B", role: "admin", isPersonal: false };
   const personal = { id: 3, name: "Nina's Workspace", role: "owner", isPersonal: true };

   describe("workspace selection", () => {
     it("restores a valid saved workspace", () => {
       expect(chooseInitialWorkspace({ workspaces: [wsA, wsB], savedWorkspaceId: 1 })).toEqual({
         activeWorkspaceId: 1,
         pickerRequired: false,
         clearSavedWorkspace: false,
       });
     });

     it("auto-lands in the only workspace when no saved id exists", () => {
       expect(chooseInitialWorkspace({ workspaces: [personal], savedWorkspaceId: null })).toMatchObject({
         activeWorkspaceId: 3,
         pickerRequired: false,
       });
     });

     it("requires picker and clears invalid saved workspace", () => {
       expect(chooseInitialWorkspace({ workspaces: [wsA, wsB], savedWorkspaceId: 99 })).toEqual({
         activeWorkspaceId: null,
         pickerRequired: true,
         clearSavedWorkspace: true,
       });
       expect(WORKSPACE_STORAGE_KEY).toBe("activeWorkspaceId");
     });

     it("redirects removal from active workspace to personal workspace with product copy", () => {
       expect(getRemovalRedirect({
         activeWorkspaceId: 8,
         removedWorkspaceId: 8,
         removedWorkspaceName: "WS-R",
         workspaces: [personal],
       })).toEqual({
         nextWorkspaceId: 3,
         toast: "You were removed from WS-R.",
       });
     });

     it("plans all scoped refreshes and event reconnects on workspace switch", () => {
       expect(planWorkspaceRefresh(2)).toEqual([
         "close-event-stream",
         "load-board:2",
         "load-metrics:2",
         "load-activity:2",
         "load-presence:2",
         "load-settings:2",
         "open-event-stream:2",
       ]);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/workspaceSelection.test.ts`
   Expected failure: workspace selection helpers do not exist and BoardProvider has no active workspace state.

3. Implement minimal code to satisfy the test:
   File: `client/src/context/BoardContext.tsx`
   Implement: active workspace id, workspace list/invite state, last-active localStorage key, selection helper exports if needed for tests, scoped calls to board/metrics/activity/presence/settings, SSE reconnect to active workspace stream, membership removal handling, and refresh of all context on workspace switch.
   File: `client/src/App.tsx`
   Implement: initial workspace list check after session check and picker requirement state.
   File: `client/src/types.ts`
   Implement: client workspace selection state types if not already present.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workspaceSelection.test.ts`
   Expected: PASS

5. Write failing deep-link test.
   File: `client/src/lib/cardPanel.test.ts`
   Test verifies: Given card id is not found in active workspace, When context panel evaluates the route param after board load, Then it redirects to `/board` silently and no toast is produced.
   Test code:
   ```ts
   import { describe, expect, it } from "vitest";
   import { getMissingCardRedirect } from "./cardPanel";

   describe("workspace-aware card panel redirects", () => {
     it("silently replaces the route when the card is absent from the active workspace", () => {
       expect(getMissingCardRedirect({
         cardId: 42,
         boardLoaded: true,
         cardFound: false,
       })).toEqual({
         to: "/board",
         replace: true,
         toast: null,
       });
     });

     it("does not redirect while the board is still loading", () => {
       expect(getMissingCardRedirect({ cardId: 42, boardLoaded: false, cardFound: false })).toBeNull();
     });
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/cardPanel.test.ts`
   Expected failure: current helper finds missing cards but route redirect behavior is not workspace-aware.

7. Implement minimal code to satisfy the test:
   File: `client/src/components/ContextPanel.tsx`
   Implement: active-workspace-aware missing-card redirect to `/board` with `replace: true` and no toast.
   File: `client/src/context/BoardContext.tsx`
   Implement: exposed switch confirmation hook/state needed by UI tasks, without rendering UI yet.

8. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workspaceSelection.test.ts src/lib/cardPanel.test.ts src/api.test.ts`
   Expected: PASS

9. Commit:
   `git add client/src/App.tsx client/src/context/BoardContext.tsx client/src/components/ContextPanel.tsx client/src/api.ts client/src/types.ts client/src/lib/workspaceSelection.test.ts client/src/lib/cardPanel.test.ts client/src/api.test.ts`
   `git commit -m "feat(workspaces): add active workspace context"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — rules: Post-login workspace selection, Workspace switcher, Removal and real-time, Deep links.
client/src/context/BoardContext.tsx — current state/SSE owner.
client/src/App.tsx — current auth check and router provider.
client/src/components/ContextPanel.tsx — current route-driven card panel behavior.
React Router docs — `Navigate`, `useNavigate`, and `replace` programmatic navigation behavior.

## WHY THIS APPROACH

Complexity: deep
Justification: Client workspace context is the shared interface between API scoping, realtime, UI switcher, and deep-link behavior.

## SANDWICH CONTEXT

[CRITICAL: `BoardProvider` must keep all board/SSE state scoped to exactly one active workspace.]
You are implementing client active workspace state for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: Keep public client routes like `/board` and derive workspace context from `BoardContext`; use path prefix only for API.
Files in scope: `client/src/App.tsx`, `client/src/context/BoardContext.tsx`, `client/src/components/ContextPanel.tsx`, `client/src/api.ts`, `client/src/types.ts`, `client/src/lib/workspaceSelection.test.ts`, `client/src/lib/cardPanel.test.ts`, `client/src/api.test.ts`
Test framework: Vitest colocated in `client/src/**/*.test.ts`
Available after: T4, T5
Architecture rule: navigation must not tear down the app shell unnecessarily; `BoardProvider` remains above router.
[RESTATE: `BoardProvider` must keep all board/SSE state scoped to exactly one active workspace.]

## DELIVERABLE

Given user "alice" is member of WS-A and WS-B and localStorage activeWorkspaceId = WS-A, When alice logs in, Then board loads WS-A data and sidebar shows WS-A as active.
Given user "bob" is member of only WS-P and localStorage has no activeWorkspaceId, When bob logs in, Then bob lands on WS-P without picker.
Given user "carol" was removed from WS-X and localStorage activeWorkspaceId = WS-X, When carol logs in, Then workspace picker is shown and invalid localStorage value is cleared.
Given user switches workspace, When selected, Then board, metrics, activity, presence, settings reload for target workspace, localStorage updates, and SSE reconnects.
Given user "nina" is viewing WS-R and receives `membership.removed`, Then she redirects to personal workspace and sees "You were removed from WS-R."
Given card 42 belongs outside the active workspace, When `/board/card/42` loads, Then redirect to `/board` silently.

All tests PASS. Commit exists with message matching `feat(workspaces): add active workspace context`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - Active workspace state is single-source-of-truth for all scoped API calls.
  - SSE reconnects on workspace switch and closes the old stream.
  - Invalid saved workspace id is cleared from localStorage.
  - Deep-link miss redirects silently.
  - Tests written before implementation.
  - Commit message follows conventional commits format.

Must-not-have:
  - No slug-based URL routing.
  - No multi-tab storage sync events.
  - No per-workspace scroll/card-panel persistence.

Open question risks:
  - Multi-tab workspace sync intentionally remains last-write-wins.

Rollback note:
  - Client context must deploy with scoped server API; otherwise app has no board data source.

## STOP CONDITIONS

Done when: workspace selection and deep-link tests pass, commit created.
Uncertain when: app needs URL workspace routes after all despite design decision.
Escalate when: state scoping requires moving BoardProvider below router and breaking current shell persistence.

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
