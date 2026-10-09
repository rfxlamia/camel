# EXECUTION PLAN — List & Calendar Views for Camel Board

**Date:** 2026-08-03
**Spec:** docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md
**Status:** validated
**Total tasks:** 7

### Test-Architect Summary
Tasks enriched: 7
Integration test tasks added: 0 (Calendar drag + tray covered by component tests with mocked `saveCard`; no cross-service integration needed — client-only feature reusing existing API)
TDD order corrections made: 7 (T1: missing `vi` import; T2: incomplete Step 1 — added workspace-switch + `setBoardViewMode` persistence tests; T3: added Board/Calendar routing tests; T4: added `columnId`/`createdAt` fixtures + timer cleanup; T5–T7: replaced comment stubs with runnable tests)
Test framework used: Vitest + @testing-library/react (jsdom, no jest-dom — match `ColumnView.test.tsx` / `BoardPage.test.tsx` patterns)
Test case counts: T1=12, T2=5, T3=6, T4=7, T5=8, T6=5, T7=8 (total 51 component/unit tests)
Coverage areas: localStorage prefs (read + write failures), calendar grid math (Sunday week start), shared date/initials utils, view switcher, List grouping/position order/overdue, Calendar display/nav/modal/overflow, drag reschedule + 409 conflict inline text, Unscheduled tray bidirectional drag
Implementation test hooks (TDD contract): date cells `data-testid="date-cell-YYYY-MM-DD"`, overdue `data-testid="overdue-indicator"`, List overdue `data-testid="overdue-due-date"`, drag ids `calendar-card-{id}` / `date-{iso}` / `unscheduled-tray` / `tray-card-{id}`

---

## Execution Overview

### Recommended Order
```
T1 → T2 → T3 → T4, T5 (parallel) → T6 → T7
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T4, T5 | T3 completes |

### Constraints Reminder
**Architecture:** Client-only; reuse `saveCard`/`SaveCardResult` for all writes; always send `version` on Calendar/tray PATCH; List/Calendar never write `position`/`column_id`; `doneAt !== null` for Done checks (never column name); no `App.tsx` route changes; no server/schema/realtime changes
**Out-of-scope:** Reorderable List, sub-project hierarchy, docs/pages, new server endpoints, week/day calendar, new top-level routes
**Assumptions at risk:** Tray drop-back is no-op; grid stays on current month after spillover drop; inline conflict copy finalized at implementation
**Sequencing:** Dependency order shown is recommended only — pocket enforces actual blocking rules.

### File Structure Map

```
Rule: View switcher persistence
  Create: client/src/lib/boardViewPrefs.ts        (created by: T1)
  Create: client/src/components/ViewSwitcher.tsx  (created by: T3)
  Modify: client/src/context/BoardContext.tsx
  Modify: client/src/pages/BoardPage.tsx
  Test:   client/src/lib/boardViewPrefs.test.ts
  Test:   client/src/context/BoardContext.viewMode.test.tsx
  Test:   client/src/components/ViewSwitcher.test.tsx
  Test:   client/src/pages/BoardPage.viewMode.test.tsx

Rule: Shared date/card helpers + calendar grid
  Create: client/src/lib/boardViewUtils.ts        (created by: T1)
  Create: client/src/lib/calendarGrid.ts          (created by: T1)
  Modify: client/package.json                     (add date-fns)
  Modify: client/src/components/CardView.tsx      (import shared utils — T1)
  Test:   client/src/lib/boardViewUtils.test.ts
  Test:   client/src/lib/calendarGrid.test.ts

Rule: List view grouping and read-only display
  Create: client/src/components/ListView.tsx      (created by: T4)
  Modify: client/src/pages/BoardPage.tsx
  Test:   client/src/components/ListView.test.tsx

Rule: Calendar display and navigation
  Create: client/src/components/CalendarView.tsx  (created by: T5)
  Create: client/src/components/CalendarDayModal.tsx (created by: T5)
  Modify: client/src/pages/BoardPage.tsx
  Test:   client/src/components/CalendarView.test.tsx

Rule: Calendar drag-to-reschedule + version conflict
  Create: client/src/components/CalendarConflictNotice.tsx (created by: T6)
  Modify: client/src/components/CalendarView.tsx
  Test:   client/src/components/CalendarView.drag.test.tsx

Rule: Unscheduled tray (bidirectional)
  Create: client/src/components/UnscheduledTray.tsx (created by: T7)
  Modify: client/src/components/CalendarView.tsx
  Test:   client/src/components/UnscheduledTray.test.tsx
```

---

## Pocket Packets

---

### Task 1: Add date-fns and shared board-view helpers [prereq]

## OBJECTIVE
Install `date-fns` and create domain-scoped helper modules for view-mode localStorage, card done/overdue checks, and calendar month-grid generation — reused by List, Calendar, and BoardContext.

Files:
- Create: `client/src/lib/boardViewPrefs.ts`
- Create: `client/src/lib/boardViewUtils.ts`
- Create: `client/src/lib/calendarGrid.ts`
- Modify: `client/package.json`
- Modify: `client/src/components/CardView.tsx` (import shared date/initials helpers)
- Test: `client/src/lib/boardViewPrefs.test.ts`
- Test: `client/src/lib/boardViewUtils.test.ts`
- Test: `client/src/lib/calendarGrid.test.ts`

Steps:
1. Write failing tests for board view prefs, card utils, and calendar grid:
   File: `client/src/lib/boardViewPrefs.test.ts`
   ```typescript
   import { afterEach, describe, expect, it, vi } from "vitest";
   import {
     readBoardViewMode,
     writeBoardViewMode,
   } from "./boardViewPrefs";

   afterEach(() => localStorage.clear());

   describe("boardViewPrefs", () => {
     it("returns board when no preference stored", () => {
       expect(readBoardViewMode(7)).toBe("board");
     });

     it("persists and reads per-workspace preference", () => {
       writeBoardViewMode(7, "list");
       writeBoardViewMode(9, "calendar");
       expect(readBoardViewMode(7)).toBe("list");
       expect(readBoardViewMode(9)).toBe("calendar");
     });

     it("falls back to board when localStorage getItem throws", () => {
       const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
         throw new Error("blocked");
       });
       expect(readBoardViewMode(1)).toBe("board");
       get.mockRestore();
     });

     it("silently ignores writeBoardViewMode when localStorage setItem throws", () => {
       const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
         throw new Error("blocked");
       });
       expect(() => writeBoardViewMode(7, "list")).not.toThrow();
       set.mockRestore();
     });
   });
   ```
   File: `client/src/lib/boardViewUtils.test.ts`
   ```typescript
   import { describe, expect, it, vi, afterEach } from "vitest";
   import {
     assigneeInitials,
     formatDueDate,
     isCardDone,
     isDueOverdue,
     todayISODate,
   } from "./boardViewUtils";
   import type { Card } from "../types";

   function card(partial: Partial<Card> = {}): Card {
     return {
       id: 1, columnId: 1, title: "T", description: "", position: 0, version: 1,
       createdAt: "2026-08-01T00:00:00.000Z",
       startedAt: null, doneAt: null, dueDate: null, assignees: [],
       ...partial,
     };
   }

   describe("boardViewUtils", () => {
     afterEach(() => vi.useRealTimers());

     it("isCardDone uses doneAt only", () => {
       expect(isCardDone(card({ doneAt: "2026-08-01T00:00:00Z" }))).toBe(true);
       expect(isCardDone(card({ doneAt: null }))).toBe(false);
     });

     it("isDueOverdue is false when done even if past due", () => {
       vi.setSystemTime(new Date("2026-08-03T12:00:00"));
       expect(isDueOverdue(card({ dueDate: "2026-08-01", doneAt: "2026-08-02T00:00:00Z" }))).toBe(false);
     });

     it("isDueOverdue is true when not done and past due", () => {
       vi.setSystemTime(new Date("2026-08-03T12:00:00"));
       expect(isDueOverdue(card({ dueDate: "2026-08-01", doneAt: null }))).toBe(true);
     });

     it("todayISODate returns local YYYY-MM-DD", () => {
       vi.setSystemTime(new Date("2026-08-03T12:00:00"));
       expect(todayISODate()).toBe("2026-08-03");
     });

     it("formatDueDate renders month and day without timezone shift", () => {
       expect(formatDueDate("2026-06-21")).toBe("Jun 21");
     });

     it("assigneeInitials derives avatar initials", () => {
       expect(assigneeInitials("Jane Doe")).toBe("JD");
       expect(assigneeInitials("cher")).toBe("CH");
     });
   });
   ```
   File: `client/src/lib/calendarGrid.test.ts`
   ```typescript
   import { describe, expect, it } from "vitest";
   import { buildMonthGrid } from "./calendarGrid";

   describe("buildMonthGrid", () => {
     it("returns 42 cells for August 2026 with Sunday-start weeks", () => {
       const cells = buildMonthGrid(new Date(2026, 7, 1)); // Aug 1 2026 is Saturday
       expect(cells).toHaveLength(42);
       expect(cells[0]!.iso).toBe("2026-07-26"); // prior Sunday pads the first row
       expect(cells.find((c) => c.iso === "2026-08-15")).toBeTruthy();
     });

     it("marks spillover cells outside the viewed month", () => {
       const cells = buildMonthGrid(new Date(2026, 7, 1));
       const spill = cells.find((c) => c.iso === "2026-09-01");
       expect(spill?.inMonth).toBe(false);
     });
   });
   ```
   Test verifies: Given no stored preference, When read, Then `"board"`; Given overdue not-done card, When checked, Then overdue true; Given August 2026, When grid built, Then 42 cells with spillover flagged.

2. Run test — verify FAIL:
   `npm run test -- client/src/lib/boardViewPrefs.test.ts client/src/lib/boardViewUtils.test.ts client/src/lib/calendarGrid.test.ts`
   Expected failure: modules not found

3. Implement minimal code:
   - `npm install date-fns` in `client/`
   - `boardViewPrefs.ts`: export `BoardViewMode = "board"|"list"|"calendar"`, `BOARD_VIEW_STORAGE_KEY`, `readBoardViewMode(workspaceId)`, `writeBoardViewMode(workspaceId, mode)` — JSON map keyed by workspace id string, try/catch on both `getItem` and `setItem`
   - `boardViewUtils.ts`: export `isCardDone(card) => card.doneAt !== null`, `isDueOverdue(card)` using ISO date compare (extract logic from `CardView.tsx`), `todayISODate()`, `formatDueDate(iso)`, `assigneeInitials(name)` (moved from `CardView.tsx`)
   - `calendarGrid.ts`: use `date-fns` (`startOfMonth`, `endOfMonth`, `startOfWeek`/`endOfWeek` with `{ weekStartsOn: 0 }`, `eachDayOfInterval`, `format` with `yyyy-MM-dd`, `isSameMonth`) to return `{ iso: string; inMonth: boolean; date: Date }[]` — **always** Sunday-start weeks regardless of locale

4. Run test — verify PASS:
   `npm run test -- client/src/lib/boardViewPrefs.test.ts client/src/lib/boardViewUtils.test.ts client/src/lib/calendarGrid.test.ts`
   Expected: PASS

5. Refactor while green (required):
   - Update `CardView.tsx`: remove local `todayISO`, `formatDue`, `initials`; import `todayISODate`, `formatDueDate`, `assigneeInitials` from `boardViewUtils` — single source of truth for overdue styling and avatar initials
   - Re-run full client test suite (`npm run test -- client/src/components/CardView` if a test file exists, else smoke via `npm run test -- client/src/lib/boardViewUtils.test.ts`) — must stay PASS

6. Commit:
   `git add client/package.json client/package-lock.json client/src/lib/boardViewPrefs.ts client/src/lib/boardViewUtils.ts client/src/lib/calendarGrid.ts client/src/lib/boardViewPrefs.test.ts client/src/lib/boardViewUtils.test.ts client/src/lib/calendarGrid.test.ts client/src/components/CardView.tsx`
   `git commit -m "feat(board-views): add date-fns and shared view helper modules"`

## REFERENCES LOADED
docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md — rules: View switcher persistence, Calendar display (grid math), List overdue via doneAt
client/src/components/CardView.tsx — existing `todayISO`, `formatDue`, overdue pattern to mirror in `boardViewUtils`
client/src/lib/workspaceSelection.ts — localStorage read/write try-catch precedent

## WHY THIS APPROACH
Justification: Shared helper `[prereq]` prevents List and Calendar from duplicating overdue/date/grid logic (Shared Helper Pattern — 3 consumers)
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: List/Calendar must use doneAt !== null for Done checks — never column name matching]
You are implementing shared helpers for List & Calendar Views for Camel Board.
Spec: docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md
Design decision: Option A — Extend BoardContext + date-fns
Files in scope: client/package.json, client/src/lib/boardViewPrefs.ts, boardViewUtils.ts, calendarGrid.ts, and their tests
Test framework: Vitest, no jest-dom
Available after: none (prereq)
Architecture rule: Client bundler imports (no .js extensions); date-fns tree-shakeable imports only
[RESTATE: Done status = card.doneAt !== null only]

## DELIVERABLE
Given no stored view preference for workspace 7, When `readBoardViewMode(7)` called, Then returns `"board"`
Given localStorage blocked, When `readBoardViewMode` called, Then returns `"board"` without throwing
Given card with doneAt=null and due_date yesterday, When `isDueOverdue(card)`, Then true
Given card with doneAt set and due_date yesterday, When `isDueOverdue(card)`, Then false
Given August 2026 month, When `buildMonthGrid`, Then 42 cells with Sunday-start padding and adjacent-month spillover cells marked `inMonth: false`
Given `assigneeInitials("Jane Doe")`, When called, Then `"JD"`

All tests PASS. Commit exists.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - date-fns added to client/package.json
  - Per-workspace localStorage key pattern (not global single value)
  - `calendarGrid` pins `{ weekStartsOn: 0 }` (Sunday-start weeks)
  - `CardView.tsx` imports shared utils (no duplicate overdue/initials logic)
  - Tests written BEFORE implementation (TDD)
  - Commit message follows conventional commits

Must-not-have:
  - New server endpoints or schema changes
  - Generic `utils.ts` catch-all filename
  - Column-name-based Done detection

Open question risks:
  - Tray drop-back no-op assumption → N/A for this task

Rollback note:
  - Revert client deploy; remove date-fns if rolling back entire feature

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: date-fns API differs from docs
Escalate when: task touches server/ or App.tsx

---

### Task 2: BoardContext view-mode state and persistence [depends: T1]

## OBJECTIVE
Add `boardViewMode` state to `BoardContext`, persisted per workspace via `boardViewPrefs`, re-resolved immediately on in-app workspace switch.

Files:
- Modify: `client/src/context/BoardContext.tsx`
- Test: `client/src/context/BoardContext.viewMode.test.tsx`

Steps:
1. Write failing test for view-mode state in BoardContext:
   File: `client/src/context/BoardContext.viewMode.test.tsx`
   ```typescript
   import {
     act,
     cleanup,
     fireEvent,
     render,
     screen,
     waitFor,
   } from "@testing-library/react";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
   import { readBoardViewMode, writeBoardViewMode } from "../lib/boardViewPrefs";
   import type { User } from "../types";

   const mockGetBoard = vi.fn();
   const mockGetWorkspaces = vi.fn();
   const mockGetMetrics = vi.fn();
   const mockGetActivity = vi.fn();
   const mockGetSettings = vi.fn();
   const mockHeartbeat = vi.fn();
   const mockGetPresence = vi.fn();

   vi.mock("../api", () => ({
     api: {
       getBoard: (...a: unknown[]) => mockGetBoard(...a),
       getWorkspaces: (...a: unknown[]) => mockGetWorkspaces(...a),
       getMetrics: (...a: unknown[]) => mockGetMetrics(...a),
       getActivity: (...a: unknown[]) => mockGetActivity(...a),
       getSettings: (...a: unknown[]) => mockGetSettings(...a),
       heartbeat: (...a: unknown[]) => mockHeartbeat(...a),
       getPresence: (...a: unknown[]) => mockGetPresence(...a),
     },
     ApiError: class ApiError extends Error {
       status: number;
       constructor(message: string, status = 0) {
         super(message);
         this.status = status;
       }
     },
   }));

   vi.mock("../lib/workspaceSelection", () => ({
     chooseInitialWorkspace: ({
       workspaces,
       savedWorkspaceId,
     }: {
       workspaces: { id: number }[];
       savedWorkspaceId: number | null;
     }) => {
       if (savedWorkspaceId !== null) {
         const saved = workspaces.find((w) => w.id === savedWorkspaceId);
         if (saved) {
           return {
             activeWorkspaceId: saved.id,
             pickerRequired: false,
             clearSavedWorkspace: false,
           };
         }
       }
       return {
         activeWorkspaceId: workspaces[0]?.id ?? null,
         pickerRequired: false,
         clearSavedWorkspace: false,
       };
     },
     readSavedWorkspaceId: () => 7,
     persistWorkspaceId: vi.fn(),
     clearSavedWorkspaceId: vi.fn(),
     planWorkspaceRefresh: () => ({}),
     getRemovalRedirect: vi.fn(),
   }));

   class MockEventSource {
     static instances: MockEventSource[] = [];
     url: string;
     close = vi.fn();
     constructor(url: string) {
       this.url = url;
       MockEventSource.instances.push(this);
     }
   }
   vi.stubGlobal("EventSource", MockEventSource);

   const testUser: User = {
     id: 1,
     username: "alice",
     displayName: "Alice",
     emailVerified: true,
     needsUsername: false,
   };

   function setupApiMocks() {
     mockGetWorkspaces.mockResolvedValue({
       workspaces: [
         { id: 7, name: "Workspace A", role: "member", isPersonal: false, memberCount: 2 },
         { id: 9, name: "Workspace B", role: "member", isPersonal: false, memberCount: 3 },
       ],
       invites: [],
     });
     mockGetBoard.mockResolvedValue({ columns: [] });
     mockGetMetrics.mockResolvedValue(null);
     mockGetActivity.mockResolvedValue([]);
     mockGetSettings.mockResolvedValue({ settings: {} });
     mockHeartbeat.mockResolvedValue({ ok: true });
     mockGetPresence.mockResolvedValue({ users: [] });
   }

   import { BoardProvider, useBoard } from "./BoardContext";

   function ViewModeProbe() {
     const { boardViewMode, switchWorkspace, setBoardViewMode } = useBoard();
     return (
       <>
         <span data-testid="view-mode">{boardViewMode}</span>
         <button type="button" data-testid="switch-to-9" onClick={() => switchWorkspace(9)}>
           Switch to B
         </button>
         <button type="button" data-testid="set-calendar" onClick={() => setBoardViewMode("calendar")}>
           Set calendar
         </button>
       </>
     );
   }

   async function renderBoard() {
     await act(async () => {
       render(
         <BoardProvider user={testUser} onSignedOut={vi.fn()}>
           <ViewModeProbe />
         </BoardProvider>,
       );
     });
     await waitFor(() => expect(screen.getByTestId("view-mode")).toBeTruthy());
   }

   describe("BoardContext view mode", () => {
     beforeEach(() => {
       localStorage.clear();
       MockEventSource.instances = [];
       setupApiMocks();
     });

     afterEach(() => {
       cleanup();
       localStorage.clear();
       vi.clearAllMocks();
     });

     it("defaults to board when no preference stored", async () => {
       await renderBoard();
       expect(screen.getByTestId("view-mode").textContent).toBe("board");
     });

     it("restores stored view mode for active workspace", async () => {
       writeBoardViewMode(7, "list");
       await renderBoard();
       expect(screen.getByTestId("view-mode").textContent).toBe("list");
     });

     it("re-resolves view mode immediately on workspace switch", async () => {
       writeBoardViewMode(7, "list");
       writeBoardViewMode(9, "calendar");
       await renderBoard();
       expect(screen.getByTestId("view-mode").textContent).toBe("list");
       await act(async () => {
         fireEvent.click(screen.getByTestId("switch-to-9"));
       });
       await waitFor(() =>
         expect(screen.getByTestId("view-mode").textContent).toBe("calendar"),
       );
     });

     it("persists view mode via setBoardViewMode per workspace", async () => {
       await renderBoard();
       await act(async () => {
         fireEvent.click(screen.getByTestId("set-calendar"));
       });
       expect(screen.getByTestId("view-mode").textContent).toBe("calendar");
       expect(readBoardViewMode(7)).toBe("calendar");
       expect(readBoardViewMode(9)).toBe("board");
     });

     it("falls back to board when localStorage read fails on workspace switch", async () => {
       writeBoardViewMode(9, "calendar");
       const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
         throw new Error("blocked");
       });
       await renderBoard();
       await act(async () => {
         fireEvent.click(screen.getByTestId("switch-to-9"));
       });
       await waitFor(() =>
         expect(screen.getByTestId("view-mode").textContent).toBe("board"),
       );
       getItem.mockRestore();
     });
   });
   ```
   Test verifies: Given stored List for workspace A, When opened, Then List mode active; Given workspace switch A→B, When switched, Then B's stored mode applies; Given `setBoardViewMode("calendar")`, When called, Then localStorage updated for active workspace only.

2. Run test — verify FAIL:
   `npm run test -- client/src/context/BoardContext.viewMode.test.tsx`
   Expected failure: `boardViewMode` not on context

3. Implement minimal code in `BoardContext.tsx`:
   - Import `readBoardViewMode`, `writeBoardViewMode`, `BoardViewMode` from `../lib/boardViewPrefs`
   - Add `boardViewMode` state initialized from `readBoardViewMode(activeWorkspaceId)` 
   - `useEffect` on `activeWorkspaceId` change: set `boardViewMode(readBoardViewMode(id))`
   - Add `setBoardViewMode(mode)` callback that updates state + `writeBoardViewMode`
   - Export on `BoardContextValue`

4. Run test — verify PASS:
   `npm run test -- client/src/context/BoardContext.viewMode.test.tsx`
   Expected: PASS

5. Refactor while green: extract view-mode effect into small inline block only if >50 lines — otherwise say "nothing to refactor"
   Re-run test — must stay PASS

6. Commit:
   `git add client/src/context/BoardContext.tsx client/src/context/BoardContext.viewMode.test.tsx`
   `git commit -m "feat(board-views): add view-mode state to BoardContext"`

## REFERENCES LOADED
docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md — rule: View switcher persistence (all GWT scenarios)
client/src/context/BoardContext.tsx — existing workspace switch via `switchWorkspace` / `activeWorkspaceId` effect pattern
client/src/lib/boardViewPrefs.ts — T1 output

## WHY THIS APPROACH
Justification: Design decision places view-mode in BoardContext; must complete before UI switcher
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Do not touch server/, App.tsx routes, or realtime event contract]
You are implementing BoardContext view-mode for List & Calendar Views.
Spec: docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md
Design decision: Option A — view-mode state lives in BoardContext
Files in scope: client/src/context/BoardContext.tsx, BoardContext.viewMode.test.tsx
Available after: T1 (boardViewPrefs)
Architecture rule: Reuse boardViewPrefs for localStorage — no parallel persistence path
[RESTATE: No server/App.tsx/realtime changes]

## DELIVERABLE
Given stored List preference for Workspace A, When BoardProvider mounts with A active, Then `boardViewMode === "list"`
Given no stored preference, When workspace opens, Then `boardViewMode === "board"`
Given List stored for A and Calendar stored for B, When user switches A→B in-app, Then `boardViewMode` immediately becomes `"calendar"`
Given localStorage blocked, When views switch or reload, Then falls back to `"board"` without error

All tests PASS. Commit exists.

Format: DONE

## QUALITY BAR
Must-have:
  - View re-resolves on `activeWorkspaceId` change (not only on page load)
  - TDD order enforced
  - Conventional commit

Must-not-have:
  - URL-based view routing
  - Modifications outside BoardContext + its test

Open question risks:
  - localStorage unavailable → handled by boardViewPrefs fallback

Rollback note:
  - Revert BoardContext changes only

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, tests green, commit created
Escalate when: BoardContext grows past maintainability without extraction (note DONE_WITH_CONCERNS, do not expand scope)

---

### Task 3: ViewSwitcher and BoardPage view routing [depends: T2]

## OBJECTIVE
Create the Board/List/Calendar toggle UI and wire `BoardPage` to render the correct view mode — Board keeps existing DndContext; List/Calendar render outside board-column DnD.

Files:
- Create: `client/src/components/ViewSwitcher.tsx`
- Modify: `client/src/pages/BoardPage.tsx`
- Modify: `client/src/pages/BoardPage.test.tsx` (extend existing `useBoard` mock)
- Test: `client/src/components/ViewSwitcher.test.tsx`
- Test: `client/src/pages/BoardPage.viewMode.test.tsx`

Steps:
1. Write failing tests:
   File: `client/src/components/ViewSwitcher.test.tsx`
   ```typescript
   import { cleanup, fireEvent, render, screen } from "@testing-library/react";
   import { afterEach, describe, expect, it, vi } from "vitest";
   import ViewSwitcher from "./ViewSwitcher";

   describe("ViewSwitcher", () => {
     afterEach(cleanup);
     it("renders Board, List, Calendar options with active state", () => {
       const onChange = vi.fn();
       render(<ViewSwitcher value="board" onChange={onChange} />);
       expect(screen.getByRole("tab", { name: /board/i }).getAttribute("aria-selected")).toBe("true");
       fireEvent.click(screen.getByRole("tab", { name: /list/i }));
       expect(onChange).toHaveBeenCalledWith("list");
     });

     it("calls onChange with calendar when Calendar tab clicked", () => {
       const onChange = vi.fn();
       render(<ViewSwitcher value="board" onChange={onChange} />);
       fireEvent.click(screen.getByRole("tab", { name: /calendar/i }));
       expect(onChange).toHaveBeenCalledWith("calendar");
     });
   });
   ```
   File: `client/src/pages/BoardPage.viewMode.test.tsx`
   ```typescript
   import { cleanup, render, screen } from "@testing-library/react";
   import { afterEach, describe, expect, it, vi } from "vitest";

   const { mockUseBoard } = vi.hoisted(() => ({
     mockUseBoard: vi.fn(),
   }));

   vi.mock("react-router", () => ({ useNavigate: () => vi.fn(), Outlet: () => null }));
   vi.mock("../api", () => ({ ApiError: class extends Error {}, api: {} }));
   vi.mock("../components/LoadingCamel", () => ({ default: () => null }));
   vi.mock("../components/SuccessAnimation", () => ({ default: () => null }));
   vi.mock("../components/ListView", () => ({ default: () => <div data-testid="list-view" /> }));
   vi.mock("../components/CalendarView", () => ({ default: () => <div data-testid="calendar-view" /> }));
   vi.mock("../context/BoardContext", () => ({
     useBoard: () => mockUseBoard(),
   }));

   import BoardPage from "./BoardPage";

   describe("BoardPage view mode routing", () => {
     afterEach(cleanup);

     it("renders ListView when boardViewMode is list", () => {
       mockUseBoard.mockReturnValue({
         columns: [{ id: 1, title: "Todo", position: 0, wipLimit: null, policy: "",
           isDone: false, isSignable: false, signableAssigneeId: null, color: null, cards: [] }],
         setColumns: vi.fn(), loadError: false, refresh: vi.fn(), cancelScheduledRefresh: vi.fn(),
         showToast: vi.fn(), deleteCard: vi.fn(), activeWorkspaceId: 7,
         boardViewMode: "list", setBoardViewMode: vi.fn(),
       });
       render(<BoardPage />);
       expect(screen.getByTestId("list-view")).toBeTruthy();
     });

     it("renders kanban columns when boardViewMode is board", () => {
       mockUseBoard.mockReturnValue({
         columns: [{ id: 1, title: "Todo", position: 0, wipLimit: null, policy: "",
           isDone: false, isSignable: false, signableAssigneeId: null, color: null, cards: [] }],
         setColumns: vi.fn(), loadError: false, refresh: vi.fn(), cancelScheduledRefresh: vi.fn(),
         showToast: vi.fn(), deleteCard: vi.fn(), activeWorkspaceId: 7,
         boardViewMode: "board", setBoardViewMode: vi.fn(),
       });
       render(<BoardPage />);
       expect(screen.getByText("Todo")).toBeTruthy();
       expect(screen.queryByTestId("list-view")).toBeNull();
     });

     it("renders CalendarView when boardViewMode is calendar", () => {
       mockUseBoard.mockReturnValue({
         columns: [], setColumns: vi.fn(), loadError: false, refresh: vi.fn(),
         cancelScheduledRefresh: vi.fn(), showToast: vi.fn(), deleteCard: vi.fn(),
         activeWorkspaceId: 7, boardViewMode: "calendar", setBoardViewMode: vi.fn(),
       });
       render(<BoardPage />);
       expect(screen.getByTestId("calendar-view")).toBeTruthy();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- client/src/components/ViewSwitcher.test.tsx client/src/pages/BoardPage.viewMode.test.tsx client/src/pages/BoardPage.test.tsx`

3. Implement:
   - `ViewSwitcher.tsx`: tablist with Board/List/Calendar, uses `BoardViewMode` type, accessible `role="tablist"`/`role="tab"`
   - `BoardPage.tsx` layout:
     - Keep existing `BoardToolbar` (stat chips) unchanged — it is **not** the view switcher
     - Add `ViewSwitcher` in a new **canvas header row** inside `board-canvas`, above the active view surface (matches mockup: switcher sits above List/Calendar panel, not in stat toolbar)
     - Read `boardViewMode`/`setBoardViewMode` from `useBoard()`; branch on mode:
       - `"board"` → existing kanban columns wrapped in `DndContext` (only mount `DndContext` in board mode)
       - `"list"` → `<ListView ... />` outside `DndContext` (placeholder `data-testid="list-view"` until T4)
       - `"calendar"` → placeholder `data-testid="calendar-view"` until T5
     - **Critical:** `DndContext` must not mount when `boardViewMode !== "board"` — extract kanban body into a conditional branch so List/Calendar never inherit board drag sensors
   - `BoardPage.test.tsx`: add `boardViewMode: "board"` and `setBoardViewMode: vi.fn()` to the existing `beforeEach` `mockUseBoard.mockReturnValue(...)` so pre-existing template-picker tests keep passing
   - Align visual density with mockups per creative-brief

4. Run test — verify PASS:
   `npm run test -- client/src/components/ViewSwitcher.test.tsx client/src/pages/BoardPage.viewMode.test.tsx client/src/pages/BoardPage.test.tsx`

5. Refactor while green — nothing expected

6. Commit:
   `git add client/src/components/ViewSwitcher.tsx client/src/components/ViewSwitcher.test.tsx client/src/pages/BoardPage.tsx client/src/pages/BoardPage.viewMode.test.tsx client/src/pages/BoardPage.test.tsx`
   `git commit -m "feat(board-views): add view switcher and BoardPage routing"`

## REFERENCES LOADED
docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md — rule: View switcher persistence
docs/pocket/spec/2026-08-01-workspace-pivot-scope/mockups/list-calendar-views-mockup.html — interaction reference
client/src/pages/BoardPage.tsx — existing toolbar + DndContext structure

## WHY THIS APPROACH
Justification: View routing is the integration hinge; List and Calendar tasks depend on switcher being wired
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Do not add routes in App.tsx — List/Calendar are internal view-modes of /board]
You are implementing ViewSwitcher + BoardPage routing for List & Calendar Views.
Spec: docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md
Design decision: Option A
Files in scope: ViewSwitcher.tsx, BoardPage.tsx, their tests
Available after: T2
Architecture rule: No App.tsx changes; view persisted via BoardContext only
[RESTATE: No new top-level routes]

## DELIVERABLE
Given Board view active, When user clicks List tab, Then `setBoardViewMode("list")` called and List surface renders
Given List active, When user clicks Board tab, Then kanban columns render with DndContext mounted
Given Calendar or List active, When rendered, Then board kanban `DndContext` is not mounted
Given any view switch, When changed, Then preference persisted via BoardContext (integration with T2)
Given existing BoardPage template-picker tests, When run after T3, Then still pass (mock includes `boardViewMode`)

All tests PASS. Commit exists.

Format: DONE

## QUALITY BAR
Must-have:
  - Accessible tablist pattern
  - ViewSwitcher in canvas header (not `BoardToolbar` stat row)
  - Board kanban `DndContext` mounts only in `board` mode (not List/Calendar)
  - Existing `BoardPage.test.tsx` mock updated with `boardViewMode` / `setBoardViewMode`
  - TDD + conventional commit

Must-not-have:
  - App.tsx route table changes
  - Filter/search toolbar wiring (decorative per spec)

## STOP CONDITIONS
Done when: DELIVERABLE passes, tests green, commit created
Escalate when: DndContext leaks into List view

---

### Task 4: List view (read-only grouped table) [depends: T3] [parallel: T5]

## OBJECTIVE
Implement read-only List view: column-grouped rows in column order, board-position order within groups, due date display with overdue styling via `doneAt`, empty states.

Files:
- Create: `client/src/components/ListView.tsx`
- Modify: `client/src/pages/BoardPage.tsx` (replace placeholder)
- Test: `client/src/components/ListView.test.tsx`

Steps:
1. Write failing test:
   File: `client/src/components/ListView.test.tsx`
   ```typescript
   import { cleanup, render, screen } from "@testing-library/react";
   import { afterEach, describe, expect, it, vi } from "vitest";
   import ListView from "./ListView";
   import type { Column, Card } from "../types";

   const card = (id: number, overrides: Partial<Card> = {}): Card => ({
     id, columnId: 1, title: `Card ${id}`, description: "", position: id, version: 1,
     createdAt: "2026-08-01T00:00:00.000Z",
     startedAt: null, doneAt: null, dueDate: null, assignees: [], ...overrides,
   });

   const columns: Column[] = [
     { id: 1, title: "To Do", position: 0, wipLimit: null, policy: "", isDone: false,
       isSignable: false, signableAssigneeId: null, color: null,
       cards: [card(1, { position: 1 }), card(2, { position: 2 })] },
     { id: 2, title: "Done", position: 1, wipLimit: null, policy: "", isDone: true,
       isSignable: false, signableAssigneeId: null, color: null,
       cards: [card(3, { doneAt: "2026-08-01", dueDate: "2026-07-01" })] },
   ];

   describe("ListView", () => {
     afterEach(() => {
       cleanup();
       vi.useRealTimers();
     });

     it("groups cards under column headers in column order", () => {
       render(<ListView columns={columns} onOpenCard={vi.fn()} />);
       const headers = screen.getAllByRole("heading", { level: 3 });
       expect(headers[0]!.textContent).toMatch(/To Do/);
       expect(headers[1]!.textContent).toMatch(/Done/);
     });

     it("orders cards by board position within each group", () => {
       const shuffled = [{
         ...columns[0]!,
         cards: [card(2, { position: 2, title: "Second" }), card(1, { position: 1, title: "First" })],
       }];
       render(<ListView columns={shuffled} onOpenCard={vi.fn()} />);
       const titles = screen.getAllByRole("button").map((el) => el.textContent);
       expect(titles.indexOf("First")).toBeLessThan(titles.indexOf("Second"));
     });

     it("shows overdue styling via data-testid for overdue not-done card", () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const cols = [{ ...columns[0]!, cards: [card(1, { dueDate: "2026-08-01", doneAt: null })] }];
       render(<ListView columns={cols} onOpenCard={vi.fn()} />);
       expect(screen.getByTestId("overdue-due-date")).toBeTruthy();
     });

     it("does not mark due date overdue when doneAt is set", () => {
       vi.setSystemTime(new Date("2026-08-03"));
       render(<ListView columns={[columns[1]!]} onOpenCard={vi.fn()} />);
       expect(screen.queryByTestId("overdue-due-date")).toBeNull();
     });

     it("shows empty group headers when column has zero cards", () => {
       const empty = [{ ...columns[0]!, cards: [] }, { ...columns[1]!, cards: [] }];
       render(<ListView columns={empty} onOpenCard={vi.fn()} />);
       expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
     });

     it("shows brand empty state when zero columns", () => {
       render(<ListView columns={[]} onOpenCard={vi.fn()} />);
       expect(screen.getByText(/Nothing here yet/i)).toBeTruthy();
     });

     it("rows are not draggable — no dnd-kit sortable attributes", () => {
       render(<ListView columns={columns} onOpenCard={vi.fn()} />);
       expect(document.querySelector("[data-sortable-id]")).toBeNull();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- client/src/components/ListView.test.tsx`

3. Implement `ListView.tsx`:
   - White bordered panel on board-canvas per mockup
   - Collapsible group headers per column (chevron, count)
   - Rows: ID, status icon, title (strikethrough if done), assignee avatars via `assigneeInitials` from `boardViewUtils`, due date via `formatDueDate` / `isDueOverdue`
   - Overdue due dates: apply error styling **and** `data-testid="overdue-due-date"` on the span
   - Sort cards within each group by ascending `position` before render
   - Row click → `onOpenCard(card)` 
   - Zero columns → reuse "Nothing here yet." copy from ColumnView empty state
   - No dnd-kit imports

4. Run test — verify PASS

5. Refactor: extract `ListGroup`/`ListRow` subcomponents only if ListView exceeds ~300 lines

6. Commit:
   `git add client/src/components/ListView.tsx client/src/components/ListView.test.tsx client/src/pages/BoardPage.tsx`
   `git commit -m "feat(board-views): add read-only List view grouped by column"`

## REFERENCES LOADED
docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md — rule: List view grouping and read-only display
docs/pocket/spec/2026-08-01-workspace-pivot-scope/mockups/list-view.png — layout reference
client/src/components/CardView.tsx — assignee avatar + due date styling precedent
client/src/lib/boardViewUtils.ts — overdue helpers

## WHY THIS APPROACH
Justification: List is independent of Calendar display — parallelizable after T3
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: List view must NOT send reorder/PATCH requests — read-only lens]
You are implementing List view for List & Calendar Views feature.
Spec: docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md
Design decision: Option A — presentational component consuming BoardContext columns
Files in scope: ListView.tsx, ListView.test.tsx, BoardPage.tsx (wire only)
Available after: T3
Architecture rule: Never write position/column_id from List; doneAt for Done checks
[RESTATE: List is read-only — no drag, no PATCH]

## DELIVERABLE
Given columns with cards in order, When List renders, Then groups appear in column order with cards sorted by ascending position within each group
Given empty columns, When List renders, Then headers still show
Given zero columns, When List renders, Then "Nothing here yet" shows
Given overdue not-done card, When rendered, Then due date red
Given done card with past due, When rendered, Then due date NOT red
[must-not] Given drag attempt in List, When dragged, Then no reorder request sent

All tests PASS. Commit exists.

Format: DONE

## QUALITY BAR
Must-have:
  - Omit label chips (no label system in Camel)
  - Grip handle visual-only, no dnd-kit
  - TDD + conventional commit

Must-not-have:
  - Reorderable/draggable List (out of scope)
  - Label chips
  - New API calls

## STOP CONDITIONS
Done when: DELIVERABLE passes
Escalate when: List triggers saveCard or moveCard

---

### Task 5: Calendar view display and day-cell navigation [depends: T3]

## OBJECTIVE
Implement Calendar month grid with prev/Today/next navigation, cards on due dates, overdue cell indicators, single-card click → card detail route, multi-card click → modal.

Files:
- Create: `client/src/components/CalendarView.tsx`
- Create: `client/src/components/CalendarDayModal.tsx`
- Modify: `client/src/pages/BoardPage.tsx`
- Test: `client/src/components/CalendarView.test.tsx`

Steps:
1. Write failing test:
   File: `client/src/components/CalendarView.test.tsx`
   ```typescript
   import { cleanup, fireEvent, render, screen } from "@testing-library/react";
   import { MemoryRouter } from "react-router";
   import { afterEach, describe, expect, it, vi } from "vitest";
   import type { Card, Column } from "../types";
   import CalendarView from "./CalendarView";

   const navigate = vi.fn();
   vi.mock("react-router", async () => {
     const actual = await vi.importActual("react-router");
     return { ...actual, useNavigate: () => navigate };
   });

   function makeCard(overrides: Partial<Card> = {}): Card {
     return {
       id: 1,
       columnId: 1,
       title: "Deploy fix",
       description: "",
       position: 1024,
       version: 3,
       createdAt: "2026-08-01T00:00:00.000Z",
       startedAt: null,
       doneAt: null,
       dueDate: "2026-08-15",
       assignees: [],
       ...overrides,
     };
   }

   function todoColumn(cards: Card[]): Column {
     return {
       id: 1,
       title: "Todo",
       position: 0,
       wipLimit: null,
       policy: "",
       isDone: false,
       isSignable: false,
       signableAssigneeId: null,
       color: null,
       cards,
     };
   }

   const cols: Column[] = [
     todoColumn([
         makeCard({ id: 42, title: "Deploy fix", dueDate: "2026-08-15", version: 3 }),
         makeCard({ id: 10, title: "Overdue task", dueDate: "2026-08-01", doneAt: null }),
         makeCard({ id: 20, title: "Solo card", dueDate: "2026-08-20", version: 1 }),
         makeCard({ id: 21, title: "Alpha", dueDate: "2026-08-25", version: 1 }),
         makeCard({ id: 22, title: "Beta", dueDate: "2026-08-25", version: 1 }),
       ]),
   ];

   function renderCalendar(columns: Column[] = cols) {
     return render(
       <MemoryRouter>
         <CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={vi.fn()} />
       </MemoryRouter>,
     );
   }

   describe("CalendarView display", () => {
     afterEach(() => {
       cleanup();
       vi.clearAllMocks();
       vi.useRealTimers();
     });

     it("defaults to current month with prev/next/Today navigation", () => {
       vi.setSystemTime(new Date("2026-08-03"));
       renderCalendar();
       expect(screen.getByText(/August 2026/i)).toBeTruthy();
       fireEvent.click(screen.getByRole("button", { name: /next/i }));
       expect(screen.getByText(/September 2026/i)).toBeTruthy();
       fireEvent.click(screen.getByRole("button", { name: /today/i }));
       expect(screen.getByText(/August 2026/i)).toBeTruthy();
     });

     it("renders card on its due date cell", () => {
       vi.setSystemTime(new Date("2026-08-03"));
       renderCalendar();
       const aug15 = screen.getByTestId("date-cell-2026-08-15");
       expect(aug15.textContent).toMatch(/Deploy fix/);
     });

     it("shows red overdue indicator on date cell for overdue not-done card", () => {
       vi.setSystemTime(new Date("2026-08-03"));
       renderCalendar();
       const aug1 = screen.getByTestId("date-cell-2026-08-01");
       expect(aug1.querySelector('[data-testid="overdue-indicator"]')).toBeTruthy();
     });

     it("opens modal when multiple cards share a date", () => {
       vi.setSystemTime(new Date("2026-08-03"));
       renderCalendar();
       fireEvent.click(screen.getByTestId("date-cell-2026-08-25"));
       expect(screen.getByRole("dialog")).toBeTruthy();
       expect(screen.getByText("Alpha")).toBeTruthy();
       expect(screen.getByText("Beta")).toBeTruthy();
     });

     it("opens modal listing all 6 cards when six share a date", () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const sixOnOneDay = [todoColumn(
         Array.from({ length: 6 }, (_, i) =>
           makeCard({ id: 100 + i, title: `Task ${i + 1}`, dueDate: "2026-08-20", version: 1 }),
         ),
       )];
       renderCalendar(sixOnOneDay);
       fireEvent.click(screen.getByTestId("date-cell-2026-08-20"));
       expect(screen.getByRole("dialog")).toBeTruthy();
       for (let i = 1; i <= 6; i++) {
         expect(screen.getByText(`Task ${i}`)).toBeTruthy();
       }
     });

     it("shows +N more overflow when more than two cards on a date", () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const overflowCols = [todoColumn([
         makeCard({ id: 1, title: "One", dueDate: "2026-08-10" }),
         makeCard({ id: 2, title: "Two", dueDate: "2026-08-10" }),
         makeCard({ id: 3, title: "Three", dueDate: "2026-08-10" }),
       ])];
       renderCalendar(overflowCols);
       const cell = screen.getByTestId("date-cell-2026-08-10");
       expect(cell.textContent).toMatch(/\+1 more/);
     });

     it("navigates to card detail when single card on date", () => {
       vi.setSystemTime(new Date("2026-08-03"));
       renderCalendar();
       fireEvent.click(screen.getByTestId("date-cell-2026-08-20"));
       expect(navigate).toHaveBeenCalledWith("/board/card/20");
     });

     it("does not show overdue indicator when card is done", () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const doneCols: Column[] = [{
         ...cols[0]!,
         cards: [makeCard({ id: 30, title: "Shipped", dueDate: "2026-08-01", doneAt: "2026-08-02T00:00:00Z" })],
       }];
       renderCalendar(doneCols);
       const aug1 = screen.getByTestId("date-cell-2026-08-01");
       expect(aug1.querySelector('[data-testid="overdue-indicator"]')).toBeNull();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- client/src/components/CalendarView.test.tsx`

3. Implement:
   - `CalendarView.tsx`: month state, `buildMonthGrid` from T1, card index by `dueDate`, chip rendering (show first 2 chips + `+N more` when >2), overdue dot via `isDueOverdue`, Today button resets month
   - Expose test hooks: `data-testid="date-cell-{iso}"` on each cell button, `data-testid="overdue-indicator"` on overdue dot, draggable id `calendar-card-{id}`, droppable id `date-{iso}`
   - `CalendarDayModal.tsx`: lists all cards for a date (no truncation), click row → navigate to card
   - Wire in BoardPage replacing calendar placeholder; pass `saveCard` from `useBoard()` (unused for drag until T6)
   - Navigation: single-card date click → `navigate("/board/card/:id")` matching existing `BoardPage` `onOpenCard` pattern

4. Run test — verify PASS

5. Refactor if CalendarView >300 lines — extract `CalendarMonthGrid` component

6. Commit:
   `git add client/src/components/CalendarView.tsx client/src/components/CalendarDayModal.tsx client/src/components/CalendarView.test.tsx client/src/pages/BoardPage.tsx`
   `git commit -m "feat(board-views): add Calendar month grid and day navigation"`

## REFERENCES LOADED
docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md — rules: Calendar display and navigation
client/src/lib/calendarGrid.ts — grid cells with spillover
client/src/pages/BoardPage.tsx — existing `onOpenCard` / navigate to `card/:cardId`

## WHY THIS APPROACH
Justification: Display-only Calendar can ship before drag; parallel with List
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Reuse existing card/:cardId nested route — no new routes]
You are implementing Calendar display for List & Calendar Views.
Spec: docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md
Design decision: Option A
Files in scope: CalendarView.tsx, CalendarDayModal.tsx, tests, BoardPage wire
Available after: T3
Architecture rule: Month view only; doneAt for overdue; no week/day granularity
[RESTATE: No App.tsx route changes]

## DELIVERABLE
Given today in August 2026, When Calendar opens, Then August grid with working prev/next
Given card due 2026-08-15, When rendered, Then appears in Aug 15 cell
Given overdue not-done card, When rendered, Then red indicator on date cell
Given 6 cards on one date, When cell clicked, Then modal lists all 6
Given 1 card on date, When cell clicked, Then navigates to card/:cardId directly

All tests PASS. Commit exists.

Format: DONE

## QUALITY BAR
Must-have:
  - Adjacent-month spillover cells styled muted
  - Today cell primary highlight
  - `+N more` overflow when >2 cards per cell
  - Modal lists all cards (tested with 6-card case)
  - TDD + conventional commit

Must-not-have:
  - Week/day views
  - Drag reschedule (T6)
  - Unscheduled tray (T7)

## STOP CONDITIONS
Done when: DELIVERABLE passes without drag/tray
Escalate when: new routes added to App.tsx

---

### Task 6: Calendar drag-to-reschedule with version conflict UI [depends: T5]

## OBJECTIVE
Add dnd-kit drag-to-reschedule on Calendar chips (including past dates and spillover cells), calling `saveCard` with `dueDate` + `version`; on 409 conflict show inline auto-dismissing text on the card.

Files:
- Create: `client/src/components/CalendarConflictNotice.tsx`
- Modify: `client/src/components/CalendarView.tsx`
- Test: `client/src/components/CalendarView.drag.test.tsx`

Steps:
1. Write failing test:
   File: `client/src/components/CalendarView.drag.test.tsx`
   ```typescript
   import {
     act,
     cleanup,
     render,
     screen,
     waitFor,
   } from "@testing-library/react";
   import type { DragEndEvent } from "@dnd-kit/core";
   import type { ReactNode } from "react";
   import { MemoryRouter } from "react-router";
   import { afterEach, describe, expect, it, vi } from "vitest";
   import type { Card, Column } from "../types";
   import CalendarView from "./CalendarView";

   const { fireDragEnd, captureOnDragEnd } = vi.hoisted(() => {
     let onDragEnd: ((event: DragEndEvent) => void) | undefined;
     return {
       captureOnDragEnd: (handler: (event: DragEndEvent) => void) => {
         onDragEnd = handler;
       },
       fireDragEnd: async (activeId: string, overId: string | null) => {
         await act(async () => {
           onDragEnd?.({
             active: { id: activeId, data: { current: {} }, rect: { current: { initial: null, translated: null } } },
             over: overId
               ? { id: overId, data: { current: {} }, rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 } }
               : null,
             delta: { x: 0, y: 0 },
             collisions: null,
             activatorEvent: null,
           } as DragEndEvent);
         });
       },
     };
   });

   vi.mock("@dnd-kit/core", () => ({
     DndContext: ({
       children,
       onDragEnd,
     }: {
       children: ReactNode;
       onDragEnd: (event: DragEndEvent) => void;
     }) => {
       captureOnDragEnd(onDragEnd);
       return <div data-testid="dnd-context">{children}</div>;
     },
     useDraggable: ({ id }: { id: string }) => ({
       attributes: { "data-draggable-id": id },
       listeners: {},
       setNodeRef: vi.fn(),
       transform: null,
       isDragging: false,
     }),
     useDroppable: ({ id }: { id: string }) => ({
       setNodeRef: vi.fn(),
       isOver: false,
     }),
     DragOverlay: () => null,
   }));
   vi.mock("@dnd-kit/sortable", () => ({
     SortableContext: ({ children }: { children: ReactNode }) => children,
   }));

   vi.mock("react-router", async () => {
     const actual = await vi.importActual("react-router");
     return { ...actual, useNavigate: () => vi.fn() };
   });

   function makeCard(overrides: Partial<Card> = {}): Card {
     return {
       id: 42,
       columnId: 1,
       title: "Deploy fix",
       description: "",
       position: 1024,
       version: 3,
       createdAt: "2026-08-01T00:00:00.000Z",
       startedAt: null,
       doneAt: null,
       dueDate: "2026-08-15",
       assignees: [],
       ...overrides,
     };
   }

   const cols: Column[] = [{
     id: 1,
     title: "Todo",
     position: 0,
     wipLimit: null,
     policy: "",
     isDone: false,
     isSignable: false,
     signableAssigneeId: null,
     color: null,
     cards: [makeCard()],
   }];

   function renderCalendarDrag(saveCard = vi.fn().mockResolvedValue("saved")) {
     return render(
       <MemoryRouter>
         <CalendarView columns={cols} onOpenCard={vi.fn()} saveCard={saveCard} />
       </MemoryRouter>,
     );
   }

   describe("CalendarView drag reschedule", () => {
     afterEach(() => {
       cleanup();
       vi.clearAllMocks();
       vi.useRealTimers();
     });

     it("calls saveCard with dueDate and version on drop to new date", async () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const saveCard = vi.fn().mockResolvedValue("saved");
       renderCalendarDrag(saveCard);
       await fireDragEnd("calendar-card-42", "date-2026-08-20");
       await waitFor(() =>
         expect(saveCard).toHaveBeenCalledWith(42, { dueDate: "2026-08-20", version: 3 }),
       );
     });

     it("allows drop on past date", async () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const saveCard = vi.fn().mockResolvedValue("saved");
       renderCalendarDrag(saveCard);
       await fireDragEnd("calendar-card-42", "date-2026-08-01");
       await waitFor(() =>
         expect(saveCard).toHaveBeenCalledWith(42, { dueDate: "2026-08-01", version: 3 }),
       );
     });

     it("allows drop on spillover September cell in August grid", async () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const saveCard = vi.fn().mockResolvedValue("saved");
       renderCalendarDrag(saveCard);
       await fireDragEnd("calendar-card-42", "date-2026-09-01");
       await waitFor(() =>
         expect(saveCard).toHaveBeenCalledWith(42, { dueDate: "2026-09-01", version: 3 }),
       );
       expect(screen.getByText(/August 2026/i)).toBeTruthy();
     });

     it("shows inline conflict notice for 3s on version conflict", async () => {
       vi.useFakeTimers();
       vi.setSystemTime(new Date("2026-08-03"));
       const saveCard = vi.fn().mockResolvedValue("conflict");
       renderCalendarDrag(saveCard);
       await fireDragEnd("calendar-card-42", "date-2026-08-20");
       await waitFor(() => expect(screen.getByText(/Updated elsewhere/i)).toBeTruthy());
       await act(async () => {
         vi.advanceTimersByTime(3000);
       });
       expect(screen.queryByText(/Updated elsewhere/i)).toBeNull();
     });

     it("does not PATCH when dropped on same date (no-op)", async () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const saveCard = vi.fn();
       renderCalendarDrag(saveCard);
       await fireDragEnd("calendar-card-42", "date-2026-08-15");
       expect(saveCard).not.toHaveBeenCalled();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- client/src/components/CalendarView.drag.test.tsx`

3. Implement:
   - Wrap calendar grid in `DndContext` (Calendar-only — not shared with Board kanban)
   - Draggable chips (`calendar-card-{id}`) + droppable date cells (`date-{iso}`, including spillover)
   - `onDragEnd`: compute target ISO date from drop target id; if unchanged, return; call `saveCard(id, { dueDate, version })` — always include version
   - `CalendarConflictNotice.tsx`: small inline text on chip ("Updated elsewhere"), 3s auto-dismiss; on `"conflict"` result adopt server state (`saveCard` already refreshes board)
   - **Conflict UX (dual feedback):** `saveCard` also emits the existing warning toast on 409 — keep both per spec (inline notice is required; toast is existing BoardContext behavior). Do not add a silent-conflict flag unless product asks to suppress the toast later.
   - Grid stays on current month after spillover drop (no auto-nav)

4. Run test — verify PASS

5. Refactor: extract `useCalendarDrag` hook if drag handler >50 lines

6. Commit:
   `git add client/src/components/CalendarView.tsx client/src/components/CalendarConflictNotice.tsx client/src/components/CalendarView.drag.test.tsx`
   `git commit -m "feat(board-views): add Calendar drag reschedule with conflict notice"`

## REFERENCES LOADED
docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md — rules: Calendar drag-to-reschedule, version conflict
client/src/context/BoardContext.tsx — `saveCard` with version_conflict → `"conflict"`
client/src/components/ContextPanel.tsx — adopt-latest on conflict precedent
client/src/pages/BoardPage.tsx — existing @dnd-kit patterns

## WHY THIS APPROACH
Justification: Drag builds on display grid; conflict UI is Calendar-write specific
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: All Calendar writes must use saveCard with version — never omit version]
You are implementing Calendar drag for List & Calendar Views.
Spec: docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md
Design decision: Option A — reuse saveCard path
Files in scope: CalendarView.tsx, CalendarConflictNotice.tsx, CalendarView.drag.test.tsx
Available after: T5
Architecture rule: Never write position/column_id; only dueDate patches
[RESTATE: saveCard + version on every Calendar write]

## DELIVERABLE
Given card version=3 on Aug 15, When dragged to Aug 20, Then PATCH via saveCard with dueDate=2026-08-20 and version=3
Given past date target, When dropped, Then dueDate set (card becomes overdue)
Given spillover September cell, When dropped, Then dueDate set to September date; grid month unchanged
Given stale version at drop, When server returns 409, Then inline text 3s + server state adopted
[must-not] Given same-date drop, When dropped, Then no PATCH

All tests PASS. Commit exists.

Format: DONE

## QUALITY BAR
Must-have:
  - version always sent
  - Inline notice (not toast-only) per spec
  - TDD + conventional commit

Must-not-have:
  - Direct api.updateCard bypassing saveCard
  - position/column_id in patch

Open question risks:
  - Exact conflict copy → "Updated elsewhere" per creative-brief assumption
  - Toast + inline on 409 → intentional dual feedback; inline satisfies spec, toast is pre-existing `saveCard` behavior

## STOP CONDITIONS
Done when: DELIVERABLE passes
Escalate when: saveCard bypassed or version omitted

---

### Task 7: Unscheduled tray bidirectional drag [depends: T6]

## OBJECTIVE
Add Unscheduled tray below Calendar grid: shows cards with `due_date=null` and `doneAt=null`; bidirectional drag to schedule (tray→date) and unschedule (date→tray) via `saveCard`; Done cards excluded; same conflict handling.

Files:
- Create: `client/src/components/UnscheduledTray.tsx`
- Modify: `client/src/components/CalendarView.tsx`
- Test: `client/src/components/UnscheduledTray.test.tsx`

Steps:
1. Write failing test:
   File: `client/src/components/UnscheduledTray.test.tsx`
   ```typescript
   import {
     act,
     cleanup,
     render,
     screen,
     waitFor,
   } from "@testing-library/react";
   import type { DragEndEvent } from "@dnd-kit/core";
   import type { ReactNode } from "react";
   import { MemoryRouter } from "react-router";
   import { afterEach, describe, expect, it, vi } from "vitest";
   import type { Card, Column } from "../types";
   import CalendarView from "./CalendarView";
   import UnscheduledTray from "./UnscheduledTray";

   const { fireDragEnd, captureOnDragEnd } = vi.hoisted(() => {
     let onDragEnd: ((event: DragEndEvent) => void) | undefined;
     return {
       captureOnDragEnd: (handler: (event: DragEndEvent) => void) => {
         onDragEnd = handler;
       },
       fireDragEnd: async (activeId: string, overId: string | null) => {
         await act(async () => {
           onDragEnd?.({
             active: { id: activeId, data: { current: {} }, rect: { current: { initial: null, translated: null } } },
             over: overId
               ? { id: overId, data: { current: {} }, rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 } }
               : null,
             delta: { x: 0, y: 0 },
             collisions: null,
             activatorEvent: null,
           } as DragEndEvent);
         });
       },
     };
   });

   vi.mock("@dnd-kit/core", () => ({
     DndContext: ({
       children,
       onDragEnd,
     }: {
       children: ReactNode;
       onDragEnd: (event: DragEndEvent) => void;
     }) => {
       captureOnDragEnd(onDragEnd);
       return <div data-testid="dnd-context">{children}</div>;
     },
     useDraggable: ({ id }: { id: string }) => ({
       attributes: { "data-draggable-id": id },
       listeners: {},
       setNodeRef: vi.fn(),
       transform: null,
       isDragging: false,
     }),
     useDroppable: ({ id }: { id: string }) => ({
       setNodeRef: vi.fn(),
       isOver: false,
     }),
     DragOverlay: () => null,
   }));
   vi.mock("@dnd-kit/sortable", () => ({
     SortableContext: ({ children }: { children: ReactNode }) => children,
   }));

   vi.mock("react-router", async () => {
     const actual = await vi.importActual("react-router");
     return { ...actual, useNavigate: () => vi.fn() };
   });

   const makeCard = (overrides: Partial<Card> = {}): Card => ({
     id: 1,
     columnId: 1,
     title: "Untitled",
     description: "",
     position: 0,
     version: 1,
     createdAt: "2026-08-01T00:00:00.000Z",
     startedAt: null,
     doneAt: null,
     dueDate: null,
     assignees: [],
     ...overrides,
   });

   const todoColumn = (cards: Card[]): Column => ({
     id: 1,
     title: "Todo",
     position: 0,
     wipLimit: null,
     policy: "",
     isDone: false,
     isSignable: false,
     signableAssigneeId: null,
     color: null,
     cards,
   });

   describe("UnscheduledTray display", () => {
     afterEach(cleanup);

     it("shows cards with due_date=null and doneAt=null", () => {
       const columns = [todoColumn([makeCard({ id: 1, title: "No date" })])];
       render(
         <UnscheduledTray columns={columns} saveCard={vi.fn()} onConflict={vi.fn()} />,
       );
       expect(screen.getByText("No date")).toBeTruthy();
     });

     it("excludes Done cards with no due date", () => {
       const columns = [todoColumn([makeCard({ doneAt: "2026-08-01T00:00:00Z" })])];
       render(
         <UnscheduledTray columns={columns} saveCard={vi.fn()} onConflict={vi.fn()} />,
       );
       expect(screen.queryByText("Untitled")).toBeNull();
     });

     it("shows empty tray message when no unscheduled cards", () => {
       const columns = [todoColumn([makeCard({ dueDate: "2026-08-15" })])];
       render(
         <UnscheduledTray columns={columns} saveCard={vi.fn()} onConflict={vi.fn()} />,
       );
       expect(screen.getByText(/no unscheduled/i)).toBeTruthy();
     });
   });

   describe("Unscheduled tray drag via CalendarView", () => {
     afterEach(() => {
       cleanup();
       vi.clearAllMocks();
       vi.useRealTimers();
     });

     it("schedules card when dragged from tray to date", async () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const saveCard = vi.fn().mockResolvedValue("saved");
       const columns = [todoColumn([makeCard({ id: 1, title: "No date", version: 1 })])];
       render(
         <MemoryRouter>
           <CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={saveCard} />
         </MemoryRouter>,
       );
       await fireDragEnd("tray-card-1", "date-2026-08-25");
       await waitFor(() =>
         expect(saveCard).toHaveBeenCalledWith(1, { dueDate: "2026-08-25", version: 1 }),
       );
     });

     it("clears due date when dragged from date to tray", async () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const saveCard = vi.fn().mockResolvedValue("saved");
       const columns = [todoColumn([
         makeCard({ id: 2, title: "Scheduled", dueDate: "2026-08-20", version: 5 }),
       ])];
       render(
         <MemoryRouter>
           <CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={saveCard} />
         </MemoryRouter>,
       );
       await fireDragEnd("calendar-card-2", "unscheduled-tray");
       await waitFor(() =>
         expect(saveCard).toHaveBeenCalledWith(2, { dueDate: null, version: 5 }),
       );
     });

     it("Done card dragged to tray clears due date and disappears from tray", async () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const saveCard = vi.fn().mockResolvedValue("saved");
       const doneCard = makeCard({
         id: 99,
         title: "Shipped",
         dueDate: "2026-08-15",
         doneAt: "2026-08-02T00:00:00Z",
         version: 2,
       });
       const columns = [todoColumn([doneCard])];
       const { rerender } = render(
         <MemoryRouter>
           <CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={saveCard} />
         </MemoryRouter>,
       );
       await fireDragEnd("calendar-card-99", "unscheduled-tray");
       expect(saveCard).toHaveBeenCalledWith(99, { dueDate: null, version: 2 });
       rerender(
         <MemoryRouter>
           <CalendarView
             columns={[todoColumn([{ ...doneCard, dueDate: null }])]}
             onOpenCard={vi.fn()}
             saveCard={saveCard}
           />
         </MemoryRouter>,
       );
       expect(screen.queryByText("Shipped")).toBeNull();
     });

     it("honors version conflict with inline notice", async () => {
       vi.useFakeTimers();
       vi.setSystemTime(new Date("2026-08-03"));
       const saveCard = vi.fn().mockResolvedValue("conflict");
       const columns = [todoColumn([makeCard({ id: 1, title: "No date", version: 2 })])];
       render(
         <MemoryRouter>
           <CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={saveCard} />
         </MemoryRouter>,
       );
       await fireDragEnd("tray-card-1", "date-2026-08-25");
       await waitFor(() => expect(screen.getByText(/Updated elsewhere/i)).toBeTruthy());
     });

     it("no-op when tray card dropped back on tray", async () => {
       vi.setSystemTime(new Date("2026-08-03"));
       const saveCard = vi.fn();
       const columns = [todoColumn([makeCard({ id: 1, title: "No date" })])];
       render(
         <MemoryRouter>
           <CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={saveCard} />
         </MemoryRouter>,
       );
       await fireDragEnd("tray-card-1", "unscheduled-tray");
       expect(saveCard).not.toHaveBeenCalled();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- client/src/components/UnscheduledTray.test.tsx`

3. Implement:
   - `UnscheduledTray.tsx`: flatten columns, filter `dueDate===null && !isCardDone(card)`, dashed-border cards, droppable zone id `unscheduled-tray`, draggable ids `tray-card-{id}`
   - Integrate into `CalendarView` DndContext: drag sources from tray + date cells; drop on tray clears dueDate; drop on date sets dueDate
   - Reuse `CalendarConflictNotice` for conflicts
   - Done card with due date dragged to tray: PATCH dueDate=null → excluded from tray per Rule 1

4. Run test — verify PASS

5. Refactor if needed — nothing expected

6. Commit:
   `git add client/src/components/UnscheduledTray.tsx client/src/components/UnscheduledTray.test.tsx client/src/components/CalendarView.tsx`
   `git commit -m "feat(board-views): add Unscheduled tray with bidirectional drag"`

## REFERENCES LOADED
docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md — rule: Unscheduled tray (bidirectional)
docs/pocket/spec/2026-08-01-workspace-pivot-scope/mockups/calendar-view.png — tray layout
client/src/lib/boardViewUtils.ts — isCardDone filter
client/src/components/CalendarConflictNotice.tsx — T6 conflict UI

## WHY THIS APPROACH
Justification: Tray shares DnContext with Calendar drag — must follow T6
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Tray writes use saveCard with version — same path as Calendar drag]
You are implementing Unscheduled tray for List & Calendar Views.
Spec: docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md
Design decision: Option A
Files in scope: UnscheduledTray.tsx, CalendarView.tsx, UnscheduledTray.test.tsx
Available after: T6
Architecture rule: doneAt for Done exclusion; dueDate-only patches
[RESTATE: saveCard + version on every tray write]

## DELIVERABLE
Given due_date=null and doneAt=null, When Calendar renders, Then card in tray not on grid
Given due_date=null and doneAt set, When Calendar renders, Then card excluded from tray
Given tray card version=2, When dragged to Aug 25, Then saveCard with dueDate=2026-08-25, version=2
Given scheduled card version=5, When dragged to tray, Then saveCard with dueDate=null, version=5
Given Done card with due date dragged to tray, When dropped, Then due cleared and absent from tray and grid
Given version conflict on tray drag, Then adopt-latest + inline text 3s
[must-not] Given tray→tray drop, When dropped, Then no PATCH

All tests PASS. Commit exists.

Format: DONE

## QUALITY BAR
Must-have:
  - Bidirectional drag in same DndContext as calendar
  - Done exclusion via doneAt
  - TDD + conventional commit

Must-not-have:
  - New server endpoints
  - Spurious PATCH on no-op tray drop

Open question risks:
  - Tray drop-back no-op → if wrong, report NEEDS_CONTEXT

Rollback note:
  - Revert client deploy

## STOP CONDITIONS
Done when: all acceptance criteria for tray pass
Escalate when: tray uses parallel API path

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | date-fns + shared helpers | prereq | standard | localStorage prefs + Sunday grid + shared utils + CardView dedup |
| T2 | BoardContext view-mode | T1 | standard | per-workspace persistence + switch re-resolve |
| T3 | ViewSwitcher + routing | T2 | standard | canvas-header switcher; DndContext board-only; BoardPage.test mock |
| T4 | List view | T3 | standard | grouped read-only rows, position order, overdue testid |
| T5 | Calendar display | T3 | standard | month grid, 6-card modal, +N overflow |
| T6 | Calendar drag + conflict | T5 | standard | saveCard with version, inline 409 + toast |
| T7 | Unscheduled tray | T6 | standard | bidirectional schedule/unschedule |
