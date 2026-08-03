# Tracker Entity — Tracker list page (Phase 3 of 3)

**Date:** 2026-08-03
**Original plan:** /Users/rfxlamia/project/camel/docs/pocket/plans/2026-08-03-tracker-entity/execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T7, T8}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 2 tasks | Prerequisite phases must be complete before starting

T7: Tracker list page [depends: T6]
T8: Tracker detail page, changelog, realtime client [depends: T7]

---

## Pocket Packets

---

### Task 7: Tracker list page [depends: T6]

## OBJECTIVE
/tracker page: status-grouped sections, dense Linear-style rows, search, collapse in-memory, global + button opens create modal.

Files:
- Create: `client/src/pages/TrackerPage.tsx`
- Create: `client/src/components/tracker/TrackerRow.tsx`
- Create: `client/src/components/tracker/TrackerSection.tsx`
- Create: `client/src/components/tracker/TrackerCreateModal.tsx`
- Create: `client/src/lib/trackerUtils.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/layout/sidebar/navItems.ts`
- Modify: `client/src/context/BoardContext.tsx` (add `subscribeTrackerEvents` registry for tracker SSE)
- Test: `client/src/pages/TrackerPage.test.tsx`

Steps:
1. Write failing tests:

```typescript
// @vitest-environment jsdom
// client/src/pages/TrackerPage.test.tsx
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerItem, TrackerVocabulary } from "../types";

const {
  mockListTrackerItems,
  mockCreateTrackerItem,
  mockListTrackerVocabularies,
  mockUseBoard,
  mockNavigate,
  mockLocation,
} = vi.hoisted(() => ({
  mockListTrackerItems: vi.fn(),
  mockCreateTrackerItem: vi.fn(),
  mockListTrackerVocabularies: vi.fn(),
  mockUseBoard: vi.fn(),
  mockNavigate: vi.fn(),
  mockLocation: { pathname: "/tracker", key: "tracker-1" },
}));

vi.mock("../api", () => ({
  api: {
    listTrackerItems: (...a: unknown[]) => mockListTrackerItems(...a),
    createTrackerItem: (...a: unknown[]) => mockCreateTrackerItem(...a),
    listTrackerVocabularies: (...a: unknown[]) =>
      mockListTrackerVocabularies(...a),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../context/BoardContext", () => ({
  useBoard: () => mockUseBoard(),
}));

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

import TrackerPage from "./TrackerPage";
import { KANBAN_NAV } from "../layout/sidebar/navItems";

const statuses: TrackerVocabulary[] = [
  { id: 1, kind: "status", name: "Backlog", position: 1000, colour: "oklch(0.7 0.1 200)" },
  { id: 2, kind: "status", name: "Done", position: 5000, colour: "oklch(0.7 0.1 140)" },
];

function makeItem(overrides: Partial<TrackerItem> & { id: number }): TrackerItem {
  return {
    key: "CA-1",
    title: "Workspace Rename",
    description: null,
    status: statuses[0]!,
    priority: null,
    labels: [{ id: 3, kind: "label", name: "Feature", position: 1000, colour: "oklch(0.7 0.1 260)" }],
    assignees: [{ id: 7, displayName: "Alice", username: "alice" }],
    version: 1,
    createdAt: "2026-07-04T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockListTrackerVocabularies.mockResolvedValue(statuses);
  mockListTrackerItems.mockResolvedValue([
    makeItem({ id: 1, key: "CA-1", title: "Workspace Rename" }),
    makeItem({ id: 2, key: "CA-2", title: "Done task", status: statuses[1]! }),
  ]);
  mockCreateTrackerItem.mockResolvedValue(makeItem({ id: 3, key: "CA-3", title: "New" }));
  mockUseBoard.mockReturnValue({
    activeWorkspaceId: 7,
    subscribeTrackerEvents: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TrackerPage", () => {
  it("renders sections ordered by vocab position with row metadata", async () => {
    render(<TrackerPage />);
    await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());
    expect(screen.getByText("CA-1")).toBeTruthy();
    expect(screen.getByText("Workspace Rename")).toBeTruthy();
    expect(screen.getByText("Feature")).toBeTruthy();
    expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
  });

  it("hides empty sections when search is active", async () => {
    mockListTrackerItems.mockResolvedValueOnce([
      makeItem({ id: 1, key: "CA-1", title: "Workspace Rename" }),
    ]);
    render(<TrackerPage />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "rename" },
    });
    await waitFor(() => expect(screen.queryByText("Done")).toBeNull());
    expect(screen.getByText("Backlog")).toBeTruthy();
  });

  it("resets collapsed sections when re-navigating to /tracker", async () => {
    const { rerender } = render(<TrackerPage />);
    await waitFor(() => screen.getByText("Done"));
    fireEvent.click(screen.getByTestId("toggle-section-Done"));
    expect(screen.queryByText("CA-2")).toBeNull();

    mockLocation.key = "tracker-2";
    rerender(<TrackerPage />);
    await waitFor(() => expect(screen.getByText("CA-2")).toBeTruthy());
  });

  it("opens create modal from global + and submits title-only defaults", async () => {
    render(<TrackerPage />);
    fireEvent.click(screen.getByRole("button", { name: /create tracker item/i }));
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Fix realtime" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(mockCreateTrackerItem).toHaveBeenCalledWith(7, {
        title: "Fix realtime",
      }),
    );
  });

  it("submits picker values on create", async () => {
    render(<TrackerPage />);
    fireEvent.click(screen.getByRole("button", { name: /create tracker item/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Full" } });
    fireEvent.click(screen.getByLabelText(/In Progress/i));
    fireEvent.click(screen.getByLabelText(/High/i));
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(mockCreateTrackerItem).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          title: "Full",
          statusId: 2,
          priorityId: expect.any(Number),
        }),
      ),
    );
  });

  it("shows new vocab section on tracker.vocabulary.created SSE without refresh", async () => {
    let sseHandler: ((e: { type: string; payload?: unknown }) => void) | undefined;
  mockUseBoard.mockReturnValue({
    activeWorkspaceId: 7,
    subscribeTrackerEvents: (cb: (e: { type: string; payload?: unknown }) => void) => {
      sseHandler = cb;
      return () => {};
    },
  });
    render(<TrackerPage />);
    await waitFor(() => screen.getByText("Backlog"));
    sseHandler?.({
      type: "tracker.vocabulary.created",
      payload: {
        id: 99,
        kind: "status",
        name: "Blocked",
        position: 2000,
        colour: "oklch(0.7 0.1 180)",
      },
    });
    await waitFor(() => expect(screen.getByText("Blocked")).toBeTruthy());
  });

  it("includes Tracker nav between Board and Inbox", () => {
    const paths = KANBAN_NAV.map((i) => i.to);
    expect(paths).toEqual(["/board", "/tracker", "/inbox", "/dashboard"]);
  });
});
```

2. Run test — verify FAIL: `npm run test -- client/src/pages/TrackerPage.test.tsx`
3. Implement pages and components; add `subscribeTrackerEvents` to BoardContext (SSE dispatch registry); add // TODO: due date preference on date column.
4. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`
5. Refactor while green (bounded): extract shared row cell helpers if duplicated.
6. Commit: `feat(tracker): add Tracker list page and create modal`

## DELIVERABLE
Given items in multiple statuses, When /tracker loaded, Then grouped oldest-first within section, sections ordered by vocab position, all expanded.
Given custom status "Blocked" added between Todo and In Progress, When list rendered, Then section order reflects vocab position.
Given search active, When section has no matches, Then hidden.
Given user collapses Done then navigates to /board and returns to /tracker, Then all sections expanded again.
Given global + clicked, When member submits title only, Then item created with Backlog status and null priority.
Given create modal with pickers set, When submitted, Then item saved with selected status/priority/labels/assignees.
Given member B on /tracker, When member A adds status via API, Then B sees new section without refresh.
Given sidebar nav, When member views KANBAN_NAV, Then Tracker appears between Board and Inbox at /tracker.

## QUALITY BAR
Must-not-have: Filter UI, URL state, localStorage collapse persistence

## STOP CONDITIONS
Done when: TrackerPage tests pass, nav shows Tracker between Board and Inbox

---

### Task 8: Tracker detail page, changelog, realtime client [depends: T7]

## OBJECTIVE
/tracker/:key detail page with edit form, per-item changelog, stale prefix redirect, 409 UX mirroring cards, SSE live updates.

Files:
- Create: `client/src/pages/TrackerDetailPage.tsx`
- Create: `client/src/components/tracker/TrackerChangelog.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/context/BoardContext.tsx` (handle tracker SSE events)
- Test: `client/src/pages/TrackerDetailPage.test.tsx`

Steps:
1. Write failing tests:

```typescript
// @vitest-environment jsdom
// client/src/pages/TrackerDetailPage.test.tsx
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetTrackerItem,
  mockUpdateTrackerItem,
  mockGetTrackerChangelog,
  mockNavigate,
  mockUseBoard,
  mockShowToast,
} = vi.hoisted(() => ({
  mockGetTrackerItem: vi.fn(),
  mockUpdateTrackerItem: vi.fn(),
  mockGetTrackerChangelog: vi.fn(),
  mockNavigate: vi.fn(),
  mockUseBoard: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    getTrackerItem: (...a: unknown[]) => mockGetTrackerItem(...a),
    updateTrackerItem: (...a: unknown[]) => mockUpdateTrackerItem(...a),
    getTrackerChangelog: (...a: unknown[]) => mockGetTrackerChangelog(...a),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("../context/BoardContext", () => ({
  useBoard: () => mockUseBoard(),
}));

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ key: "CA-42" }),
}));

import { ApiError } from "../api";
import TrackerDetailPage from "./TrackerDetailPage";

const item = {
  id: 42,
  key: "CK-42",
  title: "Workspace Rename",
  description: "details",
  status: { id: 1, kind: "status", name: "Backlog", position: 1000, colour: "oklch(0.7 0.1 200)" },
  priority: null,
  labels: [],
  assignees: [],
  version: 1,
  createdAt: "2026-07-04T00:00:00Z",
};

beforeEach(() => {
  mockGetTrackerItem.mockResolvedValue(item);
  mockGetTrackerChangelog.mockResolvedValue([
    {
      id: 1,
      eventType: "tracker_item_created",
      actor: { id: 1, displayName: "Alice" },
      payload: { title: "Workspace Rename" },
      createdAt: "2026-07-04T00:00:00Z",
    },
    {
      id: 2,
      eventType: "tracker_item_updated",
      actor: { id: 1, displayName: "Alice" },
      payload: { field: "status", from: "Backlog", to: "In Progress" },
      createdAt: "2026-07-05T00:00:00Z",
    },
  ]);
  mockUpdateTrackerItem.mockResolvedValue({ ...item, version: 2 });
  mockUseBoard.mockReturnValue({
    activeWorkspaceId: 7,
    showToast: mockShowToast,
    refreshTrackerList: vi.fn(),
    onTrackerEvent: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TrackerDetailPage", () => {
  it("loads item by key and renders changelog", async () => {
    render(<TrackerDetailPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Workspace Rename")).toBeTruthy());
    expect(screen.getByText(/tracker_item_created/i)).toBeTruthy();
    expect(screen.getByText(/In Progress/i)).toBeTruthy();
    expect(mockGetTrackerItem).toHaveBeenCalledWith(7, "CA-42");
  });

  it("redirects to canonical key when API returns stale prefix", async () => {
    mockGetTrackerItem.mockResolvedValueOnce({
      ...item,
      key: "CK-42",
      canonicalKey: "CK-42",
      redirectFrom: "CA-42",
    });
    render(<TrackerDetailPage />);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/tracker/CK-42", { replace: true }),
    );
  });

  it("shows conflict toast on 409 save mirroring cards", async () => {
    mockUpdateTrackerItem.mockRejectedValueOnce(
      new ApiError("conflict", 409, "version_conflict"),
    );
    render(<TrackerDetailPage />);
    await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
    fireEvent.change(screen.getByDisplayValue("Workspace Rename"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        "Someone else updated this tracker item first — refreshed.",
        "warning",
      ),
    );
  });

  it("applies tracker.updated SSE to live detail fields", async () => {
    let sseHandler: ((e: { type: string; payload?: unknown }) => void) | undefined;
    mockUseBoard.mockReturnValue({
      activeWorkspaceId: 7,
      showToast: mockShowToast,
      refreshTrackerList: vi.fn(),
      onTrackerEvent: (cb: typeof sseHandler) => {
        sseHandler = cb;
      },
    });
    render(<TrackerDetailPage />);
    await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
    sseHandler?.({
      type: "tracker.updated",
      payload: { key: "CK-42", title: "Live title", version: 3 },
    });
    await waitFor(() => expect(screen.getByDisplayValue("Live title")).toBeTruthy());
  });

  it("removes item from list context on tracker.deleted SSE", async () => {
    const refreshTrackerList = vi.fn();
    let sseHandler: ((e: { type: string; payload?: unknown }) => void) | undefined;
    mockUseBoard.mockReturnValue({
      activeWorkspaceId: 7,
      showToast: mockShowToast,
      refreshTrackerList,
      onTrackerEvent: (cb: typeof sseHandler) => {
        sseHandler = cb;
      },
    });
    render(<TrackerDetailPage />);
    await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
    sseHandler?.({ type: "tracker.deleted", payload: { key: "CK-42" } });
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/tracker", { replace: true }),
    );
    expect(refreshTrackerList).toHaveBeenCalled();
  });
});
```

2. Run test — verify FAIL: `npm run test -- client/src/pages/TrackerDetailPage.test.tsx`
3. Implement detail page; wire BoardContext to dispatch tracker SSE events to `subscribeTrackerEvents` subscribers.
4. Run test — verify PASS: `npm run test -- client/src/pages/TrackerDetailPage.test.tsx`
5. Refactor while green (bounded): none expected — skip if nothing to extract.
6. Commit: `feat(tracker): add detail page, changelog, and realtime updates`

## DELIVERABLE
Given item with history, When detail opened, Then changelog visible.
Given stale prefix URL, When navigated, Then redirect to canonical.
Given 409 on save, Then conflict UX mirrors cards.
Given member B on /tracker, When member A changes item status, Then B's list updates without refresh.
Given member B's list shows CA-42, When member A soft-deletes CA-42, Then row disappears from B's list without refresh.

## STOP CONDITIONS
Done when: detail tests pass, full npm run test green

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
