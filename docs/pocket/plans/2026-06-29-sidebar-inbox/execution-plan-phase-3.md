# Sidebar Inbox — Notification Center — InboxPage + Sidebar Wiring (Phase 3 of 3)

**Date:** 2026-06-29
**Original plan:** docs/pocket/plans/2026-06-29-sidebar-inbox/execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T8}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 1 tasks | Prerequisite phases must be complete before starting

T8: InboxPage + Sidebar Wiring [depends: T7]

---

## Pocket Packets

---

### Task 8: InboxPage + Sidebar Wiring [depends: T7]

## OBJECTIVE
Create `client/src/pages/InboxPage.tsx` with full notification list UI. Add Inbox nav item to `KANBAN_NAV` in `navItems.ts`. Add unread badge to `Sidebar.tsx`. Register `/inbox` route in `App.tsx`.

Files:
- Create: `client/src/pages/InboxPage.tsx`
- Create: `client/src/pages/InboxPage.test.tsx`
- Modify: `client/src/layout/sidebar/navItems.ts`
- Modify: `client/src/layout/sidebar/Sidebar.tsx`
- Modify: `client/src/layout/AppLayout.tsx` (mount `NotificationsProvider`)
- Modify: `client/src/App.tsx`

Steps:
1. Write failing tests:
   File: `client/src/pages/InboxPage.test.tsx`

   ```typescript
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { MemoryRouter } from "react-router";

   // vi.mock is hoisted; factory uses vi.fn() so each test can override via vi.mocked()
   // InboxPage consumes the SHARED context (W3), not the raw hook — mock the context.
   vi.mock("../context/NotificationsContext", () => ({
     useNotificationsContext: vi.fn(),
   }));

   import { useNotificationsContext } from "../context/NotificationsContext";
   import InboxPage from "./InboxPage";

   const defaultMock = {
     notifications: [
       { id: 1, type: "card_assigned", title: "Bob assigned 'Fix bug' to you", readAt: null, sourceDeleted: false, createdAt: "2026-06-29T10:00:00Z", cardId: 10 },
       { id: 2, type: "card_assigned", title: "Old notification", readAt: "2026-06-28T10:00:00Z", sourceDeleted: false, createdAt: "2026-06-28T10:00:00Z", cardId: null },
     ],
     unreadCount: 1,
     markAsRead: vi.fn(),
     markAllAsRead: vi.fn(),
     refetch: vi.fn(),
   };

   describe("InboxPage", () => {
     beforeEach(() => {
       vi.mocked(useNotificationsContext).mockReturnValue(defaultMock);
     });

     it("renders unread notification with visual distinction", () => {
       render(<MemoryRouter><InboxPage /></MemoryRouter>);
       expect(screen.getByText("Bob assigned 'Fix bug' to you")).toBeInTheDocument();
     });

     it("renders 'Mark all as read' button", () => {
       render(<MemoryRouter><InboxPage /></MemoryRouter>);
       expect(screen.getByRole("button", { name: /mark all as read/i })).toBeInTheDocument();
     });

     it("shows 'Card no longer exists' for sourceDeleted notifications", () => {
       vi.mocked(useNotificationsContext).mockReturnValue({
         notifications: [
           { id: 3, type: "card_assigned", title: "Deleted card notif", readAt: null, sourceDeleted: true, createdAt: "2026-06-29T10:00:00Z", cardId: 99 },
         ],
         unreadCount: 1,
         markAsRead: vi.fn(),
         markAllAsRead: vi.fn(),
         refetch: vi.fn(),
       });
       render(<MemoryRouter><InboxPage /></MemoryRouter>);
       expect(screen.getByText(/card no longer exists/i)).toBeInTheDocument();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- client/src/pages/InboxPage.test.tsx`
   Expected failure: `Cannot find module './InboxPage'`

3. Implement `client/src/pages/InboxPage.tsx`:
   - Read state via `const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotificationsContext();` (shared instance — W3; do NOT call `useNotifications` directly)
   - List of notifications, newest first
   - Unread: bold title + blue dot indicator (`w-2 h-2 rounded-full bg-blue-500`)
   - Read: normal weight, muted text color (`text-neutral-500`)
   - Click card-related (cardId != null, !sourceDeleted): `navigate("/board?card=" + cardId)` + `markAsRead(id)`
   - sourceDeleted: greyed out, click disabled, show "Card no longer exists" label
   - "Mark all as read" button in header (only when unreadCount > 0)
   - Empty state: centered message "Inbox kamu kosong — semua terkendali!" with `<Inbox>` lucide icon

   Load creative-brief before styling colors/spacing:
   ```
   docs/pocket/rule/creative-brief.md — load before implementing UI colors and typography
   ```

4. Modify `client/src/layout/sidebar/navItems.ts`:
   ```typescript
   import { Inbox, ... } from "lucide-react";

   // Add to NAV_ITEMS array:
   { to: "/inbox", label: "Inbox", icon: Inbox },

   // Add to KANBAN_NAV filter:
   export const KANBAN_NAV = NAV_ITEMS.filter((i) =>
     ["/board", "/dashboard", "/inbox"].includes(i.to),
   );
   ```

4b. **[W3 — required]** Modify `client/src/layout/AppLayout.tsx` — wrap the sidebar + routed content
    in `<NotificationsProvider>` so both the badge and InboxPage read one shared instance:
    ```tsx
    import { NotificationsProvider } from "../context/NotificationsContext";
    // wrap the existing layout body:
    // <NotificationsProvider> <Sidebar/> <main>{children/Outlet}</main> </NotificationsProvider>
    ```
    (Provider must sit inside whatever already supplies `BoardContext`, since it calls `useBoard()`.)

5. Modify `client/src/layout/sidebar/Sidebar.tsx`:
   - Import `useNotificationsContext` from `../../context/NotificationsContext`
   - `const { unreadCount } = useNotificationsContext();` (no direct `useNotifications`, no per-sidebar workspaceId wiring — the provider owns it)
   - In nav link rendering, if item.to === "/inbox" and unreadCount > 0, render red badge:
     ```tsx
     <span className="relative">
       {item.icon && <item.icon size={20} />}
       {item.to === "/inbox" && unreadCount > 0 && (
         <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
           {unreadCount > 9 ? "9+" : unreadCount}
         </span>
       )}
     </span>
     ```

6. Modify `client/src/App.tsx` — add `/inbox` route (lazy):
   ```typescript
   {
     path: "inbox",
     lazy: async () => ({
       Component: (await import("./pages/InboxPage")).default,
     }),
   },
   ```

7. Run tests:
   `npm run test --workspace=client`
   Expected: PASS

8. Commit:
   `git add client/src/pages/InboxPage.tsx client/src/pages/InboxPage.test.tsx client/src/layout/sidebar/navItems.ts client/src/layout/sidebar/Sidebar.tsx client/src/layout/AppLayout.tsx client/src/App.tsx`
   `git commit -m "feat(notifications): add InboxPage and sidebar Inbox nav with shared notifications context"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — Client Implementation section (InboxPage, Badge Count, SSE Client Hook), Rule: Inbox Interaction GWT
docs/pocket/rule/creative-brief.md — MUST LOAD before styling any UI component
client/src/layout/sidebar/navItems.ts — KANBAN_NAV filter pattern
client/src/layout/sidebar/Sidebar.tsx — activeNav rendering, NavLink structure, badge slot location
client/src/App.tsx — lazy() import pattern for pages

## WHY THIS APPROACH
Complexity: standard
Justification: 5 files across two layers (page + routing wiring). InboxPage has several distinct UI states (unread/read/deleted/empty) that each need testing. Badge in Sidebar requires hook access at sidebar level.

## SANDWICH CONTEXT
[CRITICAL: Load docs/pocket/rule/creative-brief.md before making ANY color, typography, or spacing decision in InboxPage.tsx]
You are implementing InboxPage UI + sidebar wiring for Sidebar Inbox — Notification Center.
Spec: docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md
Design decision: InboxPage as standalone page under /inbox route; unread badge on sidebar Inbox nav item
Files in scope: `client/src/pages/InboxPage.tsx`, `client/src/pages/InboxPage.test.tsx`, `client/src/layout/sidebar/navItems.ts`, `client/src/layout/sidebar/Sidebar.tsx`, `client/src/layout/AppLayout.tsx`, `client/src/App.tsx`
Available after: T7 (useNotifications hook exists and is tested)
Architecture rule: Client uses bundler resolution — no .ts extensions. InboxPage uses lazy() import in App.tsx (same pattern as DashboardPage). Must load creative-brief.md before any UI styling.
[RESTATE: Load docs/pocket/rule/creative-brief.md — no color/spacing/typography decision without consulting it]

## DELIVERABLE
Given Alice has 3 unread + 2 read notifications, When opens /inbox, Then unread notifications shown with bold title + blue dot, read notifications shown with muted text, badge on sidebar shows "3"
Given notification has cardId (not sourceDeleted), When clicked, Then navigate to /board?card={cardId} and markAsRead(id) called
Given notification with sourceDeleted=true, When rendered, Then shows "Card no longer exists", item is non-clickable (opacity-50 cursor-not-allowed)
Given Alice has 5 unread, When "Mark all as read" button clicked, Then markAllAsRead() called, unreadCount becomes 0, badge disappears
Given notifications list is empty, When renders, Then shows empty state with Inbox icon + "Inbox kamu kosong — semua terkendali!" text
[must-not] Given agent event notifications — these must NOT appear (out of scope, not in notification types)

All tests PASS. Commit exists with message `feat(notifications): add InboxPage and sidebar Inbox nav with unread badge`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Load docs/pocket/rule/creative-brief.md before implementing any UI styling
  - Unread visual distinction: bold + blue dot
  - sourceDeleted: opacity reduced, click disabled, "Card no longer exists" label
  - Empty state with Inbox lucide icon + Indonesian copy
  - Badge on Sidebar shows unreadCount (cap at 9+)
  - Sidebar AND InboxPage read from `useNotificationsContext()` (one shared provider mounted in AppLayout) — neither calls `useNotifications` directly [W3]
  - `/inbox` route uses lazy() import pattern
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Global inbox across workspaces (InboxPage is workspace-scoped)
  - Notification preferences UI
  - Smart grouping or digest mode
  - Badge modifications to AGENT_NAV sidebar items

Open question risks:
  - Resolved by W3: badge + page share one `NotificationsProvider` instance (one SSE connection, one fetch, one state) — no per-render network call, no split unreadCount

## STOP CONDITIONS
Done when: /inbox route renders, badge visible in sidebar, all DELIVERABLE scenarios pass
Escalate when: creative-brief.md not readable — stop and report BLOCKED

---

---

### Integration Test: Card Assignment Pipeline [depends: T3, T4]

## OBJECTIVE
Verify that when `routes/cards.ts` emits `CARD_ASSIGNED` (T4) and `notifications/service.ts` is subscribed via `domainBus` (T3), the DB INSERT fires for the assignee. Also covers `MEMBER_JOINED` → welcome + member_joined inserts to backstop T4's members path.

Files:
- Create: `server/src/routes/cards-notification.integration.test.ts`

Steps:
1. Write integration test using real `domainBus` + real `initNotificationService` + mocked `pool.query`:
   File: `server/src/routes/cards-notification.integration.test.ts`

   ```typescript
   import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

   vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn() } }));

   import { pool } from "../db/pool.js";
   import { domainBus, EVENTS } from "../events.js";
   import { initNotificationService } from "../notifications/service.js";

   const mockQuery = vi.mocked(pool.query);

   describe("Integration: EventBus → NotificationService → DB INSERT", () => {
     let cleanup: (() => void) | undefined;

     beforeEach(() => {
       mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
       cleanup = initNotificationService();
     });

     afterEach(() => {
       cleanup?.();
       vi.clearAllMocks();
     });

     it("card:assigned → INSERT for assignee; no INSERT when actor === assignee", async () => {
       domainBus.emit(EVENTS.CARD_ASSIGNED, {
         type: EVENTS.CARD_ASSIGNED,
         workspaceId: 1,
         actorId: 7,
         payload: { cardId: 10, assigneeId: 3, cardTitle: "Fix login bug", actorDisplayName: "Bob" },
       });

       await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
       const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
       expect(sql).toContain("INSERT INTO notifications");
       expect(params).toContain(3);           // user_id = assigneeId
       expect(params).toContain("card_assigned");
     });

     it("member:joined → welcome INSERT for new member + member_joined for existing members", async () => {
       // dedup SELECT returns empty (no existing welcome)
       mockQuery
         .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
         .mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 } as never);

       domainBus.emit(EVENTS.MEMBER_JOINED, {
         type: EVENTS.MEMBER_JOINED,
         workspaceId: 1,
         actorId: 99,
         payload: {
           newMemberId: 5,
           newMemberDisplayName: "Charlie",
           workspaceName: "Team Alpha",
           existingMemberIds: [1, 2],
         },
       });

       await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
       const allInserts = mockQuery.mock.calls.filter(([sql]: [string]) =>
         sql.includes("INSERT INTO notifications"),
       );
       expect(allInserts.length).toBeGreaterThanOrEqual(1);
       const welcomeCall = allInserts.find(([, params]: [string, unknown[]]) =>
         (params as unknown[]).includes("welcome"),
       );
       expect(welcomeCall).toBeDefined();
     });
   });
   ```

2. Run test — verify FAIL before T3 and T4 implemented:
   `npm run test -- server/src/routes/cards-notification.integration.test.ts`
   Expected failure: `Cannot find module '../notifications/service.js'` (T3 not yet done)

3. After T3 and T4 complete, run test — verify PASS:
   `npm run test -- server/src/routes/cards-notification.integration.test.ts`
   Expected: PASS — real event bus wires T4 emitter to T3 service listener

4. Commit:
   `git add server/src/routes/cards-notification.integration.test.ts`
   `git commit -m "test(notifications): add integration test for event-bus → service → DB pipeline"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — Domain Event Bus section, Routing Rules
server/src/notifications/service.test.ts — unit test patterns; initNotificationService cleanup

## WHY THIS APPROACH
Complexity: lightweight
Justification: Uses real EventEmitter (no mock) — the only way to validate that T4 emitter and T3 listener are actually wired together. mocked pool avoids DB dependency.

## SANDWICH CONTEXT
[CRITICAL: do NOT mock domainBus or events.js — the whole point is to test the real EventEmitter wiring]
You are writing an integration test that bridges T4 (route emitter) and T3 (service subscriber).
Files in scope: `server/src/routes/cards-notification.integration.test.ts` only
Available after: T3 completes + T4 completes

## DELIVERABLE
Given T3 + T4 both implemented, When card:assigned emitted on real domainBus, Then initNotificationService listener fires → pool.query INSERT called for assignee
Given T3 + T4 both implemented, When member:joined emitted, Then welcome notification INSERT called for new member

All tests PASS. Commit message: `test(notifications): add integration test for event-bus → service → DB pipeline`

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Real domainBus (no mock) — validates actual EventEmitter wiring between T4 and T3
  - initNotificationService() cleanup in afterEach (removes all listeners)
  - Covers both CARD_ASSIGNED and MEMBER_JOINED paths

Must-not-have:
  - Mocking domainBus or events.js
  - Real DB connection

## STOP CONDITIONS
Done when: both tests PASS with T3+T4 implemented
Escalate when: test fails after T3+T4 done → likely payload shape mismatch between T4 emitter and T3 handler

---

### Integration Test: Service→SSE Push Wiring [depends: T3, T5]

## OBJECTIVE
Verify that `registerPush(pushNotificationToUser)` wiring (called in `router.ts` at module load after T5) causes the notification service to invoke the registered push function with the correct `userId` when a `card:assigned` notification is successfully inserted.

Files:
- Create: `server/src/notifications/service-sse.integration.test.ts`

Steps:
1. Write integration test:
   File: `server/src/notifications/service-sse.integration.test.ts`

   ```typescript
   import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

   vi.mock("../db/pool.js", () => ({
     pool: {
       query: vi.fn().mockResolvedValue({
         rows: [{ id: 1, user_id: 3, workspace_id: 1, type: "card_assigned", title: "Test" }],
         rowCount: 1,
       }),
     },
   }));

   import { domainBus, EVENTS } from "../events.js";
   import { initNotificationService, registerPush } from "./service.js";

   describe("Integration: registerPush wiring → push function called after notification insert", () => {
     let cleanup: (() => void) | undefined;
     const pushFn = vi.fn();

     beforeEach(() => {
       registerPush(pushFn);
       cleanup = initNotificationService();
     });

     afterEach(() => {
       cleanup?.();
       registerPush(() => {}); // reset to no-op to prevent bleed into other tests
       vi.clearAllMocks();
     });

     it("pushFn called with assignee userId + workspaceId after card:assigned notification inserted", async () => {
       domainBus.emit(EVENTS.CARD_ASSIGNED, {
         type: EVENTS.CARD_ASSIGNED,
         workspaceId: 1,
         actorId: 7,
         payload: { cardId: 10, assigneeId: 3, cardTitle: "Fix bug", actorDisplayName: "Bob" },
       });

       await vi.waitFor(() => expect(pushFn).toHaveBeenCalled());
       const [userId, workspaceId] = pushFn.mock.calls[0] as [number, number, unknown];
       expect(userId).toBe(3);    // assigneeId
       expect(workspaceId).toBe(1);
     });
   });
   ```

2. Run test — verify FAIL before T3 and T5 implemented:
   `npm run test -- server/src/notifications/service-sse.integration.test.ts`
   Expected failure: `Cannot find module './service.js'`

3. After T3 and T5 complete, run test — verify PASS:
   `npm run test -- server/src/notifications/service-sse.integration.test.ts`
   Expected: PASS — registerPush wiring delivers notification to injected push function

4. Commit:
   `git add server/src/notifications/service-sse.integration.test.ts`
   `git commit -m "test(notifications): add integration test for registerPush → SSE push wiring"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — SSE Architecture section
server/src/notifications/service.ts — registerPush() dependency injection pattern

## WHY THIS APPROACH
Complexity: lightweight
Justification: Tests the DI contract between T3 (registerPush) and T5 (router wires pushNotificationToUser). pool mocked to return a notification row so pushFn is triggered.

## SANDWICH CONTEXT
[CRITICAL: do NOT import from sse.ts — test the registerPush injection contract only; sse.ts user-isolation is covered by T5's sse.test.ts]
You are writing an integration test that bridges T3 (service.ts registerPush) and T5 (router.ts wiring).
Files in scope: `server/src/notifications/service-sse.integration.test.ts` only
Available after: T3 completes + T5 completes

## DELIVERABLE
Given T3 + T5 both implemented, When CARD_ASSIGNED fires and pool.query returns a notification row, Then registerPush'd function called with (userId=assigneeId, workspaceId, notificationRow)

All tests PASS. Commit message: `test(notifications): add integration test for registerPush → SSE push wiring`

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - registerPush(pushFn) called BEFORE initNotificationService() in beforeEach
  - registerPush(() => {}) reset in afterEach to prevent push fn bleed
  - pool.query mock returns a notification row (INSERT RETURNING * must yield a row for pushFn to fire)

Must-not-have:
  - Importing from sse.ts (test only the DI contract)
  - Real HTTP/SSE connection

## STOP CONDITIONS
Done when: test PASS with T3+T5 implemented
Escalate when: pushFn not called after T3+T5 done → check if router.ts calls registerPush at module load

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
