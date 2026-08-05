# Tracker Project / Phase / WBS — Tracker home — project cards, search into projects, new realtime (Phase 4 of 4)

**Date:** 2026-08-05
**Original plan:** docs/pocket/plans/2026-08-05-tracker-project-phase-wbs/execution-plan.md
**Prerequisite:** Phase 3 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T14, T15, T18, T17}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

T14: Tracker home — project cards, search into projects, new realtime [depends: T12, T13]
T15: Project WBS page [depends: T12, T13]
T18: Project and phase management UI [depends: T15, T16]
T17: Drag reorder UI [depends: T15, T8, T18]

---

## Pocket Packets

---

### Task 14: Tracker home — project cards, search into projects, new realtime [depends: T12, T13]

## OBJECTIVE

Turn `/tracker` into Tracker home: project cards above the existing status-grouped list of
unassigned items, with search that reaches into projects and handlers for the new events.

Files:
- Modify: `client/src/pages/TrackerPage.tsx`
- Create: `client/src/components/tracker/TrackerProjectCard.tsx`
- Create: `client/src/components/tracker/TrackerProgressBar.tsx`
- Create: `client/src/components/tracker/TrackerProjectCreateModal.tsx`
- Test: `client/src/pages/TrackerPage.test.tsx`

Steps:

1. Write failing tests in `client/src/pages/TrackerPage.test.tsx` for:
   - a workspace with items and no projects renders the status sections exactly as before,
     plus a "New project" affordance
   - clicking "New project" opens a modal; submitting a name calls `createTrackerProject`
     and the new card appears
   - submitting a blank name surfaces the server's 400 inline
   - at 10 projects the "New project" control is disabled and states the reason
   - project cards show name, percentage, task count and an overdue marker when applicable
   - searching a term that matches only an in-project item shows it under "In projects" with
     its `Project › Phase` trail, and the "No items match" state does NOT appear
   - the toolbar count includes in-project matches
   - searching a term with no match anywhere shows the "No items match" state
   - a `tracker.project.created` event refreshes the list
   - a `tracker.project.deleted` event removes the card and shows the released tasks

   ```typescript
   // Appended to client/src/pages/TrackerPage.test.tsx — reuses the
   // `mockListTrackerItems` / `mockUseBoard` / `mockNavigate` mocks and the
   // `makeItem` helper already declared at the top of this file. Extend the
   // existing `vi.hoisted` block and the `vi.mock("../api", …)` factory with
   // two more entries, following the exact shape already there:
   //
   //   mockListTrackerProjects: vi.fn(),
   //   mockCreateTrackerProject: vi.fn(),
   //   …
   //   listTrackerProjects: (...a: unknown[]) => mockListTrackerProjects(...a),
   //   createTrackerProject: (...a: unknown[]) => mockCreateTrackerProject(...a),
   //
   // Also import `ApiError` from "../api" (the mocked class already exported
   // by the top-level mock) and add `category` to the existing `statuses`
   // fixture — `TrackerVocabulary.category` is required from T11 onward:
   // Backlog → "backlog", In Progress → "started", Done → "completed".
   import { ApiError } from "../api";
   import type { TrackerPhase, TrackerProject } from "../types";

   const persiapan: TrackerPhase = {
     id: 9,
     projectId: 1,
     name: "Persiapan",
     subtitle: "",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   const releaseProject: TrackerProject = {
     id: 1,
     name: "Rilis v2",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     phases: [persiapan],
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   function inProjectItem(
     overrides: Partial<TrackerItem> & { id: number },
   ): TrackerItem {
     return makeItem({
       projectId: 1,
       phaseId: 9,
       startDate: null,
       endDate: null,
       completedAt: null,
       position: 1024,
       ...overrides,
     });
   }

   beforeEach(() => {
     // Keeps every pre-existing test in this file seeing a project-less
     // workspace unless it opts into a project fixture below.
     mockListTrackerProjects.mockResolvedValue([]);
   });

   describe("TrackerPage projects", () => {
     it("renders unassigned items unchanged, plus a New project affordance, when no projects exist", async () => {
       render(<TrackerPage />);
       await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());
       expect(screen.getByText("CA-1")).toBeTruthy();
       expect(screen.getByRole("button", { name: /new project/i })).toBeTruthy();
       expect(screen.queryByText("In projects")).toBeNull();
     });

     it("opens the project modal, creates a project and shows the card without a manual refresh", async () => {
       mockListTrackerProjects
         .mockResolvedValueOnce([])
         .mockResolvedValueOnce([releaseProject]);
       mockCreateTrackerProject.mockResolvedValue(releaseProject);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Backlog"));
       fireEvent.click(screen.getByRole("button", { name: /new project/i }));
       const modal = within(screen.getByRole("dialog"));
       fireEvent.change(modal.getByLabelText(/project name/i), {
         target: { value: "Rilis v2" },
       });
       fireEvent.click(modal.getByRole("button", { name: /create project/i }));
       await waitFor(() =>
         expect(mockCreateTrackerProject).toHaveBeenCalledWith(7, {
           name: "Rilis v2",
         }),
       );
       await waitFor(() => expect(screen.getByText("Rilis v2")).toBeTruthy());
     });

     it("surfaces the server's 400 inline for a blank project name", async () => {
       mockCreateTrackerProject.mockRejectedValueOnce(
         new ApiError("Name is required", 400),
       );
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Backlog"));
       fireEvent.click(screen.getByRole("button", { name: /new project/i }));
       const modal = within(screen.getByRole("dialog"));
       fireEvent.click(modal.getByRole("button", { name: /create project/i }));
       expect(await modal.findByText("Name is required")).toBeTruthy();
       expect(screen.getByRole("dialog")).toBeTruthy();
     });

     it("disables New project with a visible reason at the 10-project cap", async () => {
       mockListTrackerProjects.mockResolvedValueOnce(
         Array.from({ length: 10 }, (_, i) => ({
           ...releaseProject,
           id: i + 1,
           name: `Project ${i + 1}`,
         })),
       );
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Project 1"));
       const button = screen.getByRole("button", { name: /new project/i });
       expect(button).toBeDisabled();
       expect(screen.getByText(/10/)).toBeTruthy();
     });

     it("shows name, percentage, task count and an overdue marker on a project card", async () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       mockListTrackerItems.mockResolvedValueOnce([
         inProjectItem({ id: 10, key: "CA-10", status: statuses[2]! }),
         inProjectItem({
           id: 11,
           key: "CA-11",
           status: statuses[1]!,
           endDate: "2026-09-20",
         }),
       ]);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       expect(screen.getByText("50%")).toBeTruthy();
       expect(screen.getByText(/2 tasks/i)).toBeTruthy();
       expect(screen.getByLabelText(/overdue/i)).toBeTruthy();
       vi.useRealTimers();
     });

     it('shows an in-project-only match under "In projects" with its trail, and never fires the empty state', async () => {
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       mockListTrackerItems.mockResolvedValueOnce([
         inProjectItem({ id: 10, key: "CA-10", title: "Ship realtime sync" }),
       ]);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.change(screen.getByPlaceholderText(/search/i), {
         target: { value: "realtime" },
       });
       await waitFor(() => expect(screen.getByText("In projects")).toBeTruthy());
       expect(screen.getByText("CA-10")).toBeTruthy();
       expect(screen.getByText("Rilis v2 › Persiapan")).toBeTruthy();
       expect(screen.queryByText(/no items match/i)).toBeNull();
     });

     it("counts the in-project match in the toolbar total", async () => {
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       mockListTrackerItems.mockResolvedValueOnce([
         inProjectItem({ id: 10, key: "CA-10", title: "Ship realtime sync" }),
       ]);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.change(screen.getByPlaceholderText(/search/i), {
         target: { value: "realtime" },
       });
       await waitFor(() => expect(screen.getByText("1 item")).toBeTruthy());
     });

     it("still shows the empty state when neither a project name nor any item matches", async () => {
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.change(screen.getByPlaceholderText(/search/i), {
         target: { value: "nonexistent-zzz" },
       });
       await waitFor(() =>
         expect(screen.getByText(/no items match/i)).toBeTruthy(),
       );
     });

     it("reloads and shows the card on tracker.project.created without a manual refresh", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         registerRefreshTrackerList: vi.fn(),
         refreshTrackerList: vi.fn(),
         showToast: mockShowToast,
       });
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Backlog"));
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       sseHandler?.({ type: "tracker.project.created" });
       await waitFor(() => expect(screen.getByText("Rilis v2")).toBeTruthy());
     });

     it("removes the card and surfaces the released tasks on tracker.project.deleted", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         registerRefreshTrackerList: vi.fn(),
         refreshTrackerList: vi.fn(),
         showToast: mockShowToast,
       });
       mockListTrackerProjects.mockResolvedValueOnce([releaseProject]);
       mockListTrackerItems.mockResolvedValueOnce([
         inProjectItem({ id: 10, key: "CA-10", title: "Ship realtime sync" }),
       ]);
       render(<TrackerPage />);
       await waitFor(() => screen.getByText("Rilis v2"));

       mockListTrackerProjects.mockResolvedValueOnce([]);
       mockListTrackerItems.mockResolvedValueOnce([
         makeItem({
           id: 10,
           key: "CA-10",
           title: "Ship realtime sync",
           projectId: null,
           phaseId: null,
         }),
       ]);
       sseHandler?.({ type: "tracker.project.deleted" });
       await waitFor(() => expect(screen.queryByText("Rilis v2")).toBeNull());
       await waitFor(() => expect(screen.getByText("CA-10")).toBeTruthy());
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/TrackerPage.test.tsx`
   Expected failure: no project card rendered; empty state fires on an in-project-only match

3. Implement:
   - `TrackerProgressBar.tsx`: renders the three rollup branches. Fill uses primary-600
     `oklch(55.0% 0.076 250)` on a neutral-200 `oklch(92.0% 0.005 250)` track, per the
     creative brief — not success-green
   - `TrackerProjectCard.tsx`: name, progress bar, task count, derived date range, overdue
     marker using the Error role (`oklch(55% 0.100 25)` solid, `oklch(35% 0.085 25)` text on
     `oklch(95% 0.025 25)`); links to `/tracker/p/{id}`
   - `TrackerPage.tsx`:
     - fetch projects alongside statuses, priorities and items in the existing `Promise.all`
     - split items into unassigned (`projectId === null`) and in-project
     - status sections render unassigned items only, unchanged from today
     - fix the empty-state condition at :126 so it accounts for project-name matches and
       in-project item matches — this is the line that would otherwise kill the feature
     - render an "In projects" section during search, joining project and phase names by id
     - add the six new event types to the SSE handler, each calling `loadData()`. Do NOT
       merge from `event.payload` — the nearest precedent
       (`tracker-vocabularies.ts:141-144` + `TrackerPage.tsx:71-85`) is a payload handler
       that never fires
     - make the projects area collapsible
   - `TrackerProjectCreateModal.tsx`: a single-field modal following the composition of the
     existing `TrackerCreateModal`, calling `api.createTrackerProject` and surfacing the
     server's 400 or 409 inline in the brief's neutral-friendly register. The "New project"
     control is disabled with a visible reason once 10 non-deleted projects exist, mirroring
     the workspace-cap treatment in `client/src/lib/workspaceSwitcher.ts`

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/TrackerPage.test.tsx`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - `TrackerPage.tsx` is already 295 lines; if this work pushes it past ~300, extract the
     search-partitioning logic into `client/src/lib/trackerRollup.ts` or a sibling module
     rather than growing the component
   - Re-run: `npm run test --workspace=client -- src/pages/TrackerPage.test.tsx` — must stay PASS

6. Commit:
   `git add client/src/pages/TrackerPage.tsx client/src/components/tracker/TrackerProjectCard.tsx client/src/components/tracker/TrackerProgressBar.tsx client/src/components/tracker/TrackerProjectCreateModal.tsx client/src/pages/TrackerPage.test.tsx`
   `git commit -m "feat(tracker): add project cards and cross-project search to tracker home"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Home and project page, Realtime; the Implementation Notes on `:126` and on reloading
rather than merging
client/src/pages/TrackerPage.tsx:40-55,68-107,109-126,255-281 — the load, SSE handler,
filter and render paths this task changes
docs/pocket/rule/creative-brief.md:30,52,66 — primary-600, neutral-200 and the Error role
client/src/lib/trackerRollup.ts — the derivation helper from T12, imported not reimplemented

## WHY THIS APPROACH

Justification: four files including two new components, plus a subtle empty-state condition
whose failure mode is a silently missing feature rather than an error.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: the empty-state condition at `TrackerPage.tsx:126` currently short-circuits the entire render — it MUST account for project-name and in-project matches, or the "In projects" section can never appear.]
You are implementing Tracker home for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — rollup comes from `trackerRollup.ts` over the fetched item list; never fetch an aggregate.
Files in scope: `client/src/pages/TrackerPage.tsx`, `TrackerProjectCard.tsx`, `TrackerProgressBar.tsx`, `TrackerProjectCreateModal.tsx`, `TrackerPage.test.tsx` — no other files.
Test framework: Vitest with jsdom; run client tests with `npm run test --workspace=client`, not raw vitest from the repo root.
Available after: T12 (derivation), T13 (glyphs)
Architecture rule: existing behaviour for unassigned items must not regress — the status-grouped list stays on this route and keeps its reset-on-navigation collapse rule. New SSE handlers call `loadData()`; they do not merge from payloads.
[RESTATE: the empty-state condition at `TrackerPage.tsx:126` currently short-circuits the entire render — it MUST account for project-name and in-project matches, or the "In projects" section can never appear.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a workspace with 31 items and no projects, When `/tracker` opens, Then the items render grouped by status exactly as before, with only a "New project" affordance added
Given the only match for "realtime" is an item inside a project, When searched, Then it appears under "In projects" with its trail, the empty state does not appear, and the toolbar count includes it
Given no project name and no item matches, When searched, Then the "No items match" state appears
Given members A and B on `/tracker`, When A creates a project, Then B sees the card without refreshing
Given members A and B on `/tracker`, When A deletes a project holding 18 tasks, Then B's card disappears and the 18 released tasks appear in B's unassigned sections
Given a project card, When it renders, Then its percentage comes from `trackerRollup` and its bar uses primary-600 on neutral-200
Given a member clicks "New project" and submits "Rilis v2", When it succeeds, Then the card appears without a manual refresh
Given workspace W already has 10 non-deleted projects, When the home renders, Then the "New project" control is disabled with the reason visible
[must-not] Given a blank project name, When submitted, Then the server's 400 is surfaced inline rather than swallowed
[must-not] Given this change, When `/tracker` renders, Then no unassigned item is relocated to another route

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Empty-state condition accounts for all three match sources
  - New SSE handlers reload via `loadData()`
  - Rollup imported from `trackerRollup.ts`, never reimplemented
  - Brief-compliant colours: primary-600 fill, neutral-200 track, Error role for overdue
  - Tests written BEFORE implementation

Must-not-have:
  - Unassigned items moved off `/tracker`
  - Merging state from `event.payload` in the new handlers
  - Any Roadmap or timeline rendering
  - Success-green progress fill
  - Modifications to files outside the listed scope

Open question risks:
  - The projects area is collapsible but expanded by default; if many projects crowd the
    list in practice, the next step is collapsing by default — not relocating the list

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - A local reimplementation of rollup → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: joining project and phase names by id proves ambiguous for a soft-deleted parent
Escalate when: preserving today's unassigned behaviour conflicts with a required new behaviour

---

### Task 15: Project WBS page [depends: T12, T13]

## OBJECTIVE

Add `/tracker/p/:id`: phases with rollup, date range and overdue, a "No phase" section, a
CTA empty state, persisted collapse, and a 404 state for unknown or cross-workspace ids.

Files:
- Create: `client/src/pages/TrackerProjectPage.tsx`
- Create: `client/src/components/tracker/TrackerPhaseSection.tsx`
- Test: `client/src/pages/TrackerProjectPage.test.tsx`
- Modify: `client/src/App.tsx`

Steps:

1. Write failing tests in `client/src/pages/TrackerProjectPage.test.tsx` for:
   - phases render with rollup percentage and derived date range
   - a "No phase" section appears when phase-less tasks exist and is absent otherwise
   - a project with zero phases and zero tasks shows a CTA empty state
   - an unknown project id renders the 404 state
   - a project belonging to another workspace renders the 404 state
   - collapsing a phase persists across navigation via `sessionStorage`
   - collapse survives an SSE-triggered `loadData()` reload
   - a `tracker.project.deleted` event for the open project shows the 404 state
   - a `tracker.updated` event for an item in this project refreshes the phase and project
     percentages
   - a `tracker.created` event for an item in this project makes the new row appear
   - a `tracker.deleted` event removes the row and updates the percentages
   - a `tracker.phase.deleted` event moves that phase's tasks into "No phase"

   ```typescript
   // client/src/pages/TrackerProjectPage.test.tsx
   // Mirrors the mock shape of TrackerPage.test.tsx and TrackerDetailPage.test.tsx:
   // `vi.hoisted` for every mock fn, `vi.mock("../api", …)` re-exporting `ApiError`,
   // a mocked `useBoard`, and `react-router`'s `useNavigate` / `useParams`.
   import {
     cleanup,
     fireEvent,
     render,
     screen,
     waitFor,
   } from "@testing-library/react";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
   import type { TrackerItem, TrackerPhase, TrackerProject } from "../types";

   const {
     mockListTrackerProjects,
     mockListTrackerItems,
     mockNavigate,
     mockUseParams,
     mockUseBoard,
     mockShowToast,
   } = vi.hoisted(() => ({
     mockListTrackerProjects: vi.fn(),
     mockListTrackerItems: vi.fn(),
     mockNavigate: vi.fn(),
     mockUseParams: vi.fn(),
     mockUseBoard: vi.fn(),
     mockShowToast: vi.fn(),
   }));

   vi.mock("../api", () => ({
     api: {
       listTrackerProjects: (...a: unknown[]) => mockListTrackerProjects(...a),
       listTrackerItems: (...a: unknown[]) => mockListTrackerItems(...a),
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
     useParams: () => mockUseParams(),
   }));

   import TrackerProjectPage from "./TrackerProjectPage";

   const persiapan: TrackerPhase = {
     id: 9,
     projectId: 1,
     name: "Persiapan",
     subtitle: "",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   const pengembangan: TrackerPhase = {
     id: 10,
     projectId: 1,
     name: "Pengembangan",
     subtitle: "",
     startDate: null,
     endDate: null,
     position: 2048,
     version: 1,
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   const project: TrackerProject = {
     id: 1,
     name: "Rilis v2",
     startDate: null,
     endDate: null,
     position: 1024,
     version: 1,
     phases: [persiapan, pengembangan],
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   const backlog = {
     id: 1,
     kind: "status" as const,
     name: "Backlog",
     position: 1000,
     colour: "oklch(0.7 0.1 200)",
     category: "backlog" as const,
   };
   const inProgress = {
     id: 2,
     kind: "status" as const,
     name: "In Progress",
     position: 2000,
     colour: "oklch(0.7 0.1 90)",
     category: "started" as const,
   };
   const done = {
     id: 3,
     kind: "status" as const,
     name: "Done",
     position: 3000,
     colour: "oklch(0.7 0.1 140)",
     category: "completed" as const,
   };

   function projectItem(
     overrides: Partial<TrackerItem> & { id: number },
   ): TrackerItem {
     return {
       key: `CA-${overrides.id}`,
       title: "Task",
       description: "",
       status: backlog,
       priority: null,
       labels: [],
       assignees: [],
       version: 1,
       createdAt: "2026-08-01T00:00:00Z",
       updatedAt: "2026-08-01T00:00:00Z",
       projectId: 1,
       phaseId: 9,
       startDate: null,
       endDate: null,
       completedAt: null,
       position: 1024,
       ...overrides,
     };
   }

   beforeEach(() => {
     mockUseParams.mockReturnValue({ projectId: "1" });
     mockListTrackerProjects.mockResolvedValue([project]);
     mockListTrackerItems.mockResolvedValue([
       projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
       projectItem({ id: 2, key: "CA-2", phaseId: 9, status: inProgress }),
     ]);
     mockUseBoard.mockReturnValue({
       activeWorkspaceId: 7,
       subscribeTrackerEvents: vi.fn(() => () => {}),
       showToast: mockShowToast,
     });
   });

   afterEach(() => {
     cleanup();
     vi.clearAllMocks();
     window.sessionStorage.clear();
   });

   describe("TrackerProjectPage", () => {
     it("renders phases with a rollup percentage and a derived date range", async () => {
       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({
           id: 1,
           key: "CA-1",
           phaseId: 9,
           status: done,
           startDate: "2026-09-05",
           endDate: "2026-09-15",
         }),
         projectItem({
           id: 2,
           key: "CA-2",
           phaseId: 9,
           status: inProgress,
           startDate: "2026-09-10",
           endDate: "2026-09-25",
         }),
       ]);
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       expect(screen.getByText("50%")).toBeTruthy();
       expect(screen.getByText(/Sep 5.*Sep 25/)).toBeTruthy();
     });

     it('shows a "No phase" section when phase-less tasks exist for this project', async () => {
       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: null }),
       ]);
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("No phase"));
       expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
     });

     it('omits the "No phase" section when every task has a phase', async () => {
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       expect(screen.queryByText("No phase")).toBeNull();
     });

     it("shows a CTA empty state for a project with zero phases and zero tasks", async () => {
       mockListTrackerProjects.mockResolvedValueOnce([
         { ...project, id: 5, name: "Rilis v3", phases: [] },
       ]);
       mockListTrackerItems.mockResolvedValueOnce([]);
       mockUseParams.mockReturnValue({ projectId: "5" });
       render(<TrackerProjectPage />);
       expect(
         await screen.findByRole("button", { name: /create.*phase/i }),
       ).toBeTruthy();
     });

     it("renders the 404 state for an unknown project id", async () => {
       mockUseParams.mockReturnValue({ projectId: "999" });
       render(<TrackerProjectPage />);
       expect(await screen.findByText(/not found/i)).toBeTruthy();
       expect(screen.queryByText("Persiapan")).toBeNull();
     });

     it("renders the 404 state for a project id belonging to another workspace", async () => {
       // The list is workspace-scoped server-side, so a foreign id is simply
       // absent from it — the same code path as an unknown id.
       mockUseParams.mockReturnValue({ projectId: "42" });
       render(<TrackerProjectPage />);
       expect(await screen.findByText(/not found/i)).toBeTruthy();
     });

     it("persists a collapsed phase across a fresh mount within the same session", async () => {
       const { unmount } = render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       fireEvent.click(screen.getByTestId("toggle-phase-Persiapan"));
       expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();
       unmount();

       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();
     });

     it("keeps a collapsed phase collapsed through an SSE-triggered reload", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       fireEvent.click(screen.getByTestId("toggle-phase-Persiapan"));
       expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();

       sseHandler?.({ type: "tracker.updated" });
       await waitFor(() => expect(mockListTrackerItems).toHaveBeenCalledTimes(2));
       expect(screen.queryByTestId("tracker-row-CA-1")).toBeNull();
     });

     it("shows the 404 state when tracker.project.deleted fires for the open project", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));

       mockListTrackerProjects.mockResolvedValueOnce([]);
       sseHandler?.({ type: "tracker.project.deleted" });
       await waitFor(() => expect(screen.getByText(/not found/i)).toBeTruthy());
     });

     it("reloads on every project/phase event plus the three item events (eight of the nine)", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));

       const eventTypes = [
         "tracker.project.created",
         "tracker.project.updated",
         "tracker.phase.created",
         "tracker.phase.updated",
         "tracker.phase.deleted",
         "tracker.created",
         "tracker.updated",
         "tracker.deleted",
       ];
       for (const type of eventTypes) {
         mockListTrackerItems.mockClear();
         sseHandler?.({ type });
         await waitFor(() => expect(mockListTrackerItems).toHaveBeenCalled());
       }
       // The ninth, tracker.project.deleted, is covered separately above since
       // it resolves to the 404 state rather than a fresh render of this page.
     });

     it("refreshes the phase and project percentages after a tracker.updated event", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("50%"));

       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
         projectItem({ id: 2, key: "CA-2", phaseId: 9, status: done }),
       ]);
       sseHandler?.({ type: "tracker.updated" });
       await waitFor(() => expect(screen.getByText("100%")).toBeTruthy());
     });

     it("shows a new row from a tracker.created event without a manual refresh", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));

       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
         projectItem({ id: 2, key: "CA-2", phaseId: 9, status: inProgress }),
         projectItem({ id: 3, key: "CA-3", phaseId: 9, title: "New task" }),
       ]);
       sseHandler?.({ type: "tracker.created" });
       await waitFor(() => expect(screen.getByTestId("tracker-row-CA-3")).toBeTruthy());
     });

     it("removes the row and updates the percentages on a tracker.deleted event", async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("50%"));

       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
       ]);
       sseHandler?.({ type: "tracker.deleted" });
       await waitFor(() => expect(screen.queryByTestId("tracker-row-CA-2")).toBeNull());
       expect(screen.getByText("100%")).toBeTruthy();
     });

     it('moves a deleted phase\'s tasks into "No phase" on tracker.phase.deleted', async () => {
       let sseHandler: ((e: { type: string }) => void) | undefined;
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 7,
         subscribeTrackerEvents: (cb: (e: { type: string }) => void) => {
           sseHandler = cb;
           return () => {};
         },
         showToast: mockShowToast,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));

       mockListTrackerProjects.mockResolvedValueOnce([
         { ...project, phases: [pengembangan] },
       ]);
       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: null, status: done }),
         projectItem({ id: 2, key: "CA-2", phaseId: null, status: inProgress }),
       ]);
       sseHandler?.({ type: "tracker.phase.deleted" });
       await waitFor(() => expect(screen.queryByText("Persiapan")).toBeNull());
       expect(screen.getByText("No phase")).toBeTruthy();
       expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
     });

     it("carries the overdue marker on a near-complete phase with one live task past its end date", async () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: 9, status: done }),
         projectItem({ id: 2, key: "CA-2", phaseId: 9, status: done }),
         projectItem({
           id: 3,
           key: "CA-3",
           phaseId: 9,
           status: inProgress,
           endDate: "2026-09-20",
         }),
       ]);
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       expect(screen.getByLabelText(/overdue/i)).toBeTruthy();
       vi.useRealTimers();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Expected failure: `Cannot find module './TrackerProjectPage'`

3. Implement:
   - `TrackerPhaseSection.tsx`: header with name, subtitle, `TrackerProgressBar`, date range
     and overdue marker; rows beneath, reusing `TrackerRow`
   - `TrackerProjectPage.tsx`: reads the project id from the route, fetches projects and
     items, filters items to this project, groups by `phaseId` with a "No phase" bucket,
     derives everything from `trackerRollup.ts`, persists collapse per project in
     `sessionStorage`, and subscribes to **nine** event types calling `loadData()`: the six
     new project/phase types PLUS the three existing item types
     `tracker.created` / `tracker.updated` / `tracker.deleted` (`realtime.ts:59-61`).
     Without the item types a teammate completing a task leaves this page's rollup stale,
     which the Realtime criterion forbids
   - Register the route in `client/src/App.tsx` as `tracker/p/:projectId`, placed so it can
     never fall through to `tracker/:key` (:72-77) whose handler would treat "p" as a key

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - If phase grouping duplicates the bucket logic already in `trackerRollup.ts`, import it
     rather than repeating it
   - If `TrackerProjectPage.tsx` passes ~300 lines, extract the sessionStorage collapse
     handling into a small named hook module
   - Re-run: `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx` — must stay PASS

6. Commit:
   `git add client/src/pages/TrackerProjectPage.tsx client/src/components/tracker/TrackerPhaseSection.tsx client/src/pages/TrackerProjectPage.test.tsx client/src/App.tsx`
   `git commit -m "feat(tracker): add the project work breakdown page"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Home and project page, Rollup, Overdue, Phase lifecycle
client/src/App.tsx:66-77 — the `tracker` and `tracker/:key` routes the new route must not collide with
client/src/components/tracker/TrackerSection.tsx — the section header + flush rows pattern to mirror
client/src/lib/trackerRollup.ts — the derivation helper from T12

## WHY THIS APPROACH

Justification: a new page plus a new component and a routing change, with several distinct
states (empty, 404, collapsed, overdue) that each need their own verification.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: `/tracker/p/:projectId` must never fall through to the `tracker/:key` route — that handler would parse "p" as an item key and 400.]
You are implementing the project WBS page for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — all progress, bounds and overdue come from `trackerRollup.ts` over fetched items.
Files in scope: `client/src/pages/TrackerProjectPage.tsx`, `TrackerPhaseSection.tsx`, the page test, `client/src/App.tsx` — no other files.
Test framework: Vitest with jsdom; run client tests with `npm run test --workspace=client`.
Available after: T12 (derivation), T13 (glyphs)
Architecture rule: this page persists phase collapse in `sessionStorage` per project — `/tracker` keeps its reset-on-navigation rule and must not change. React hooks rules are enforced in `client/src/`; unused imports fail typecheck.
[RESTATE: `/tracker/p/:projectId` must never fall through to the `tracker/:key` route — that handler would parse "p" as an item key and 400.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given project P, When its card is clicked, Then `/tracker/p/P` renders phases with rollups, date ranges, and a "No phase" section when needed
Given project P with zero phases and zero tasks, When opened, Then a CTA empty state invites creating the first phase
Given a member collapsed "Persiapan", When they return to `/tracker/p/P`, Then it is still collapsed
Given a collapsed phase, When an SSE event triggers the full `loadData()` reload, Then the collapse survives
Given a phase whose bar reads 83% (5 of 6) and whose one remaining live task is past its end date, When rendered, Then the phase carries the overdue marker beside the bar (a phase cannot be at 100% and hold a live task — a live task counts in the denominator)
Given member B viewing `/tracker/p/P`, When member A deletes project P, Then B is shown the 404 state rather than a stale page
Given member B on `/tracker/p/P`, When member A marks a task Done, Then B's phase and project percentages update without refreshing
Given member B on `/tracker/p/P`, When member A deletes phase "Persiapan", Then B's view moves those tasks into "No phase" without refreshing
[must-not] Given a nonexistent project id or a project from another workspace, When opened, Then a 404 state renders rather than an error
[must-not] Given this page, When it renders, Then no Gantt or timeline visualisation appears

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Route registered so it cannot collide with the key pattern
  - Collapse persisted per project and reload-safe
  - CTA empty state per the calm-Linear direction
  - Derivation imported from `trackerRollup.ts`
  - Tests written BEFORE implementation

Must-not-have:
  - Any timeline, Gantt or roadmap rendering
  - A change to `/tracker`'s collapse behaviour
  - A local reimplementation of rollup or overdue
  - Modifications to files outside the listed scope

Open question risks:
  - Project date columns exist but are unused; the page shows a derived range only

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Timeline rendering added → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: the 404 state for a deleted-under-you project conflicts with the reload path
Escalate when: the route cannot be registered without disturbing `tracker/:key`

---

### Task 18: Project and phase management UI [depends: T15, T16]

## OBJECTIVE

Make the project page's management affordances real: rename and delete the project, and
create, rename and delete phases — including the delete confirmation that names how many
tasks will be released and the 409 conflict UX.

Without this task the API methods T11 ships are never called by anything, and four
acceptance criteria render as inert UI.

Files:
- Modify: `client/src/pages/TrackerProjectPage.tsx`
- Modify: `client/src/components/tracker/TrackerPhaseSection.tsx`
- Create: `client/src/components/tracker/TrackerPhaseEditor.tsx`
- Test: `client/src/pages/TrackerProjectPage.test.tsx`

Steps:

1. Write failing tests in `client/src/pages/TrackerProjectPage.test.tsx` for:
   - renaming the project calls `updateTrackerProject` with the current version and the
     header shows the new name
   - a stale rename returns 409 and shows the card-mirror conflict UX (warning toast plus a
     refresh), matching the existing handling in `TrackerPage.tsx:180-188`
   - clicking Delete on a project holding 18 tasks shows a confirmation stating
     "18 tasks will be released to the unassigned list"
   - confirming the delete calls `deleteTrackerProject` and navigates back to `/tracker`
   - an empty project's CTA creates the first phase via `createTrackerPhase`
   - adding a phase appends it after the existing last phase
   - renaming a phase calls `updateTrackerPhase`; a stale version shows the same 409 UX
   - deleting a phase confirms, calls `deleteTrackerPhase`, and its tasks appear under
     "No phase" without a manual refresh
   - setting explicit phase dates calls `updateTrackerPhase` and an inverted range surfaces
     the server's 400 inline

   ```typescript
   // Appended to client/src/pages/TrackerProjectPage.test.tsx — reuses the
   // mocked api, `project`/`persiapan`/`pengembangan` fixtures, `projectItem`
   // helper, `ApiError` and `mockUseBoard`/`mockShowToast`/`mockNavigate`
   // already declared in this file (see T15). Extend the top-level
   // `vi.hoisted` block and the `vi.mock("../api", …)` factory with five more
   // entries, matching the shape already there:
   //
   //   mockUpdateTrackerProject, mockDeleteTrackerProject,
   //   mockCreateTrackerPhase, mockUpdateTrackerPhase, mockDeleteTrackerPhase
   //   → updateTrackerProject, deleteTrackerProject, createTrackerPhase,
   //     updateTrackerPhase, deleteTrackerPhase

   describe("TrackerProjectPage project and phase management", () => {
     it("renames the project with the current version and updates the header", async () => {
       mockUpdateTrackerProject.mockResolvedValue({
         ...project,
         name: "Rilis v2.1",
         version: 2,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.click(screen.getByRole("button", { name: /rename project/i }));
       fireEvent.change(screen.getByLabelText(/project name/i), {
         target: { value: "Rilis v2.1" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerProject).toHaveBeenCalledWith(7, 1, {
           name: "Rilis v2.1",
           version: 1,
         }),
       );
       expect(await screen.findByText("Rilis v2.1")).toBeTruthy();
     });

     it("shows the card-mirror conflict UX when a project rename is stale", async () => {
       mockUpdateTrackerProject.mockRejectedValueOnce(
         new ApiError("conflict", 409, "version_conflict"),
       );
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.click(screen.getByRole("button", { name: /rename project/i }));
       fireEvent.change(screen.getByLabelText(/project name/i), {
         target: { value: "Rilis v2.1" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       await waitFor(() =>
         expect(mockShowToast).toHaveBeenCalledWith(
           expect.stringMatching(/someone else updated this project/i),
           "warning",
         ),
       );
       // The conflict path reloads rather than trusting the failed response.
       expect(mockListTrackerProjects).toHaveBeenCalledTimes(2);
     });

     it("states the released task count in the delete confirmation", async () => {
       mockListTrackerItems.mockResolvedValueOnce(
         Array.from({ length: 18 }, (_, i) =>
           projectItem({ id: i + 1, key: `CA-${i + 1}`, phaseId: 9 }),
         ),
       );
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.click(screen.getByRole("button", { name: /project menu/i }));
       fireEvent.click(screen.getByRole("menuitem", { name: /delete project/i }));
       expect(
         await screen.findByText(/18 tasks will be released to the unassigned list/i),
       ).toBeTruthy();
     });

     it("deletes the project on confirmation and returns to /tracker", async () => {
       mockDeleteTrackerProject.mockResolvedValue(undefined);
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Rilis v2"));
       fireEvent.click(screen.getByRole("button", { name: /project menu/i }));
       fireEvent.click(screen.getByRole("menuitem", { name: /delete project/i }));
       await screen.findByText(/will be released to the unassigned list/i);
       fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
       await waitFor(() => expect(mockDeleteTrackerProject).toHaveBeenCalledWith(7, 1));
       expect(mockNavigate).toHaveBeenCalledWith("/tracker");
     });

     it("creates the first phase from the empty project's CTA", async () => {
       mockListTrackerProjects.mockResolvedValueOnce([
         { ...project, id: 5, name: "Rilis v3", phases: [] },
       ]);
       mockListTrackerItems.mockResolvedValueOnce([]);
       mockUseParams.mockReturnValue({ projectId: "5" });
       mockCreateTrackerPhase.mockResolvedValue(persiapan);
       render(<TrackerProjectPage />);
       fireEvent.click(await screen.findByRole("button", { name: /create.*phase/i }));
       fireEvent.change(screen.getByLabelText(/phase name/i), {
         target: { value: "Persiapan" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
       await waitFor(() =>
         expect(mockCreateTrackerPhase).toHaveBeenCalledWith(7, 5, {
           name: "Persiapan",
         }),
       );
     });

     it("appends a new phase after the existing last phase", async () => {
       mockCreateTrackerPhase.mockResolvedValue({
         ...pengembangan,
         id: 11,
         name: "Peluncuran",
         position: 3072,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Pengembangan"));
       fireEvent.click(screen.getByRole("button", { name: /add phase/i }));
       fireEvent.change(screen.getByLabelText(/phase name/i), {
         target: { value: "Peluncuran" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
       await waitFor(() => expect(mockCreateTrackerPhase).toHaveBeenCalled());
       const order = screen
         .getAllByTestId(/^phase-/)
         .map((section) => section.dataset.testid);
       expect(order).toEqual(["phase-Persiapan", "phase-Pengembangan", "phase-Peluncuran"]);
     });

     it("renames a phase and shows the same 409 conflict UX on a stale version", async () => {
       mockUpdateTrackerPhase.mockResolvedValueOnce({
         ...persiapan,
         name: "Persiapan awal",
         version: 2,
       });
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan/i }));
       fireEvent.change(screen.getByLabelText(/phase name/i), {
         target: { value: "Persiapan awal" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerPhase).toHaveBeenCalledWith(7, 1, 9, {
           name: "Persiapan awal",
           version: 1,
         }),
       );
       expect(await screen.findByText("Persiapan awal")).toBeTruthy();

       mockUpdateTrackerPhase.mockRejectedValueOnce(
         new ApiError("conflict", 409, "version_conflict"),
       );
       fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan awal/i }));
       fireEvent.change(screen.getByLabelText(/phase name/i), {
         target: { value: "Persiapan lagi" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       await waitFor(() =>
         expect(mockShowToast).toHaveBeenCalledWith(
           expect.stringMatching(/someone else updated this phase/i),
           "warning",
         ),
       );
     });

     it('deletes a phase on confirmation and moves its tasks into "No phase" without a manual refresh', async () => {
       mockDeleteTrackerPhase.mockResolvedValue(undefined);
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));

       // Queued before the click so the reload the delete triggers picks it up —
       // queuing it after would race the component's own refetch.
       mockListTrackerProjects.mockResolvedValueOnce([
         { ...project, phases: [pengembangan] },
       ]);
       mockListTrackerItems.mockResolvedValueOnce([
         projectItem({ id: 1, key: "CA-1", phaseId: null }),
         projectItem({ id: 2, key: "CA-2", phaseId: null }),
       ]);
       fireEvent.click(screen.getByRole("button", { name: /delete phase persiapan/i }));
       fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
       await waitFor(() => expect(mockDeleteTrackerPhase).toHaveBeenCalledWith(7, 1, 9));
       await waitFor(() => expect(screen.getByText("No phase")).toBeTruthy());
       expect(screen.getByTestId("tracker-row-CA-1")).toBeTruthy();
     });

     it("sets explicit phase dates and surfaces the server's 400 for an inverted range inline", async () => {
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByText("Persiapan"));
       fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan/i }));
       fireEvent.change(screen.getByLabelText(/start date/i), {
         target: { value: "2026-09-01" },
       });
       fireEvent.change(screen.getByLabelText(/end date/i), {
         target: { value: "2026-09-20" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerPhase).toHaveBeenCalledWith(7, 1, 9, {
           name: "Persiapan",
           startDate: "2026-09-01",
           endDate: "2026-09-20",
           version: 1,
         }),
       );

       mockUpdateTrackerPhase.mockRejectedValueOnce(
         new ApiError("End date must be on or after the start date.", 400),
       );
       fireEvent.click(screen.getByRole("button", { name: /rename phase persiapan/i }));
       fireEvent.change(screen.getByLabelText(/start date/i), {
         target: { value: "2026-09-30" },
       });
       fireEvent.change(screen.getByLabelText(/end date/i), {
         target: { value: "2026-09-01" },
       });
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       expect(
         await screen.findByText("End date must be on or after the start date."),
       ).toBeTruthy();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Expected failure: no rename control found; `updateTrackerProject` never called

3. Implement:
   - `TrackerPhaseEditor.tsx`: the create/rename form for a phase — name, subtitle, optional
     start and end dates — reusing the date fields T16 introduces rather than duplicating
     them, and surfacing server validation inline
   - `TrackerPhaseSection.tsx`: add rename and delete affordances to the phase header,
     revealed on hover/focus in the same low-visibility manner the existing section header
     uses for its create control
   - `TrackerProjectPage.tsx`: project header gains rename (inline edit) and delete (menu),
     both carrying `version` and handling 409 by toasting and reloading; the delete
     confirmation counts this project's tasks via the already-fetched item list and states
     the number; on success navigate to `/tracker`
   - All copy follows the creative brief's neutral-friendly register

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - The 409 conflict handling now appears on project rename, phase rename and the item
     paths in `TrackerPage.tsx` — if it is written a third time, extract a named helper
     under `client/src/lib/` and use it in all three
   - If `TrackerProjectPage.tsx` passes ~300 lines, extract the project header into its own
     component file
   - Re-run: `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx` — must stay PASS

6. Commit:
   `git add client/src/pages/TrackerProjectPage.tsx client/src/components/tracker/TrackerPhaseSection.tsx client/src/components/tracker/TrackerPhaseEditor.tsx client/src/pages/TrackerProjectPage.test.tsx`
   `git commit -m "feat(tracker): manage projects and phases from the work breakdown page"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Project lifecycle, Phase lifecycle; the delete confirmation copy is fixed by the spec
client/src/pages/TrackerPage.tsx:173-194 — the existing 409 conflict UX (warning toast then
reload) this task mirrors
client/src/components/tracker/TrackerSection.tsx — the hover-revealed header control pattern
client/src/api.ts — the project and phase methods T11 ships, which this task is the only caller of

## WHY THIS APPROACH

Justification: three files with several mutation flows, each needing optimistic-locking
conflict handling and a destructive confirmation whose copy is specified.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: the project delete confirmation MUST state how many tasks will be released — this is the one irreversible operation in the cycle and the user is entitled to the number before confirming.]
You are implementing project and phase management for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — the task count in the confirmation is derived from the already-fetched item list, not a new endpoint.
Files in scope: `client/src/pages/TrackerProjectPage.tsx`, `TrackerPhaseSection.tsx`, `TrackerPhaseEditor.tsx`, the page test — no other files.
Test framework: Vitest with jsdom; run client tests with `npm run test --workspace=client`.
Available after: T15 (the page these controls live on)
Architecture rule: every mutation sends `version` and handles 409 with the card-mirror UX. No new endpoint may be added — use the API methods from T11.
[RESTATE: the project delete confirmation MUST state how many tasks will be released — this is the one irreversible operation in the cycle and the user is entitled to the number before confirming.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given project P is named "Rilis v2", When renamed to "Rilis v2.1" with the current version, Then the header shows the new name
Given project P holds 18 tasks, When Delete is clicked, Then the confirmation states that 18 tasks will be released to the unassigned list
Given the confirmation is accepted, When the delete succeeds, Then the user lands back on `/tracker` and the released tasks appear there
Given project P has phases "Persiapan" and "Pengembangan", When "Peluncuran" is added, Then it appears after "Pengembangan"
Given phase "Persiapan" with 5 tasks, When renamed then deleted, Then rename succeeds and its tasks appear under "No phase" without a manual refresh
Given a project with zero phases and zero tasks, When the CTA is used, Then the first phase is created
[must-not] Given a stale version on a project or phase rename, When saved, Then a 409 surfaces as the card-mirror conflict UX rather than a silent failure
[must-not] Given an inverted explicit phase range, When saved, Then the server's 400 is surfaced inline

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Delete confirmation states the task count, in the spec's wording
  - `version` sent on every mutation; 409 handled with the existing conflict UX
  - Date fields reused from T16, not duplicated
  - Tests written BEFORE implementation

Must-not-have:
  - A new endpoint or a count query just for the confirmation
  - Deleting a project without confirmation
  - Any Roadmap or timeline rendering
  - Modifications to files outside the listed scope

Open question risks:
  - none

Rollback note:
  - Project deletion is not reversible by deploy revert; the confirmation is the last
    safeguard before an irreversible release.

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Destructive delete without the count in the confirmation → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: the task count for the confirmation is unavailable because items have not loaded
Escalate when: the 409 UX cannot be reused without changing `TrackerPage.tsx`

---

### Task 17: Drag reorder UI [depends: T15, T8, T18]

## OBJECTIVE

Let people drag tasks into order inside a phase, calling the reorder endpoint. This is the
last task and is cuttable — the endpoint and column ship regardless.

Files:
- Modify: `client/src/pages/TrackerProjectPage.tsx`
- Modify: `client/src/components/tracker/TrackerPhaseSection.tsx`
- Test: `client/src/pages/TrackerProjectPage.test.tsx`

Steps:

1. Write failing tests in `client/src/pages/TrackerProjectPage.test.tsx` for:
   - dropping a task at a new index calls `reorderTrackerItem` with that target
   - the list shows the new order optimistically before the request resolves
   - a failed reorder restores the previous order and shows an error toast
   - dragging is scoped within one phase — a drop outside the source phase is rejected

   ```typescript
   // Appended to client/src/pages/TrackerProjectPage.test.tsx — reuses the
   // mocked api, `project`/`persiapan`/`pengembangan` fixtures, `projectItem`
   // helper and `mockUseBoard`/`mockShowToast` already declared in this file
   // (see T15). Extend the top-level `vi.hoisted` block and the
   // `vi.mock("../api", …)` factory with `mockReorderTrackerItem` →
   // `reorderTrackerItem`, matching the shape already there.
   //
   // dnd-kit's keyboard sensor is exercised directly — focus the row's drag
   // handle, Space to pick up, Arrow to move, Space to drop — rather than
   // simulating pointer geometry jsdom does not lay out. This is the
   // documented accessible path through `sortableKeyboardCoordinates` and
   // exercises the same `onDragEnd` callback a pointer drag would.
   function pressReorder(handleName: RegExp, direction: "ArrowDown" | "ArrowUp") {
     const handle = screen.getByRole("button", { name: handleName });
     handle.focus();
     fireEvent.keyDown(handle, { key: " " });
     fireEvent.keyDown(handle, { key: direction });
     fireEvent.keyDown(handle, { key: " " });
   }

   beforeEach(() => {
     // Two tasks in Persiapan (CA-1, CA-2) and two in Pengembangan (CB-1,
     // CB-2), so cross-phase scoping has something to violate if it is broken.
     mockListTrackerItems.mockResolvedValue([
       projectItem({ id: 1, key: "CA-1", phaseId: 9, position: 1024 }),
       projectItem({ id: 2, key: "CA-2", phaseId: 9, position: 2048 }),
       projectItem({ id: 3, key: "CB-1", phaseId: 10, position: 1024 }),
       projectItem({ id: 4, key: "CB-2", phaseId: 10, position: 2048 }),
     ]);
   });

   describe("TrackerProjectPage drag reorder", () => {
     it("calls reorderTrackerItem with the drop target when a task moves within its phase", async () => {
       mockReorderTrackerItem.mockResolvedValue(
         projectItem({ id: 1, key: "CA-1", phaseId: 9, position: 3072 }),
       );
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       pressReorder(/reorder ca-1/i, "ArrowDown");
       await waitFor(() =>
         expect(mockReorderTrackerItem).toHaveBeenCalledWith(
           7,
           "CA-1",
           expect.any(Object),
         ),
       );
     });

     it("shows the new order optimistically before the request resolves", async () => {
       let resolveReorder: (value: TrackerItem) => void = () => {};
       mockReorderTrackerItem.mockImplementation(
         () =>
           new Promise((resolve) => {
             resolveReorder = resolve;
           }),
       );
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       pressReorder(/reorder ca-1/i, "ArrowDown");
       await waitFor(() => expect(mockReorderTrackerItem).toHaveBeenCalled());
       const order = screen
         .getAllByTestId(/^tracker-row-CA-/)
         .map((row) => row.dataset.testid);
       expect(order).toEqual(["tracker-row-CA-2", "tracker-row-CA-1"]);
       resolveReorder(projectItem({ id: 1, key: "CA-1", phaseId: 9 }));
     });

     it("restores the previous order and shows an error toast when the reorder fails", async () => {
       mockReorderTrackerItem.mockRejectedValue(new Error("network down"));
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       pressReorder(/reorder ca-1/i, "ArrowDown");
       await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
       expect(mockShowToast.mock.calls[0]?.[1]).toBe("error");
       const order = screen
         .getAllByTestId(/^tracker-row-CA-/)
         .map((row) => row.dataset.testid);
       expect(order).toEqual(["tracker-row-CA-1", "tracker-row-CA-2"]);
     });

     it("never lets a drag inside one phase touch another phase's order or items", async () => {
       render(<TrackerProjectPage />);
       await waitFor(() => screen.getByTestId("tracker-row-CA-1"));
       const phaseBBefore = screen
         .getAllByTestId(/^tracker-row-CB-/)
         .map((row) => row.dataset.testid);

       pressReorder(/reorder ca-1/i, "ArrowDown");
       await waitFor(() => expect(mockReorderTrackerItem).toHaveBeenCalled());

       expect(mockReorderTrackerItem).toHaveBeenCalledTimes(1);
       expect(mockReorderTrackerItem.mock.calls[0]?.[1]).toBe("CA-1");
       const phaseBAfter = screen
         .getAllByTestId(/^tracker-row-CB-/)
         .map((row) => row.dataset.testid);
       expect(phaseBAfter).toEqual(phaseBBefore);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Expected failure: no drag handlers wired; `reorderTrackerItem` never called

3. Implement using the **legacy dnd-kit preset API** already used by Board
   (`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0):
   - Wrap each phase's rows in `DndContext` with `PointerSensor` and `KeyboardSensor`
     (`sortableKeyboardCoordinates`), `collisionDetection={closestCenter}`
   - `SortableContext` with `verticalListSortingStrategy` over that phase's item ids
   - `onDragEnd` computes old and new index, applies `arrayMove` optimistically, then calls
     `api.reorderTrackerItem`; on failure restore the snapshot and toast, mirroring the
     rollback style already in `TrackerPage.tsx:140-203`
   - Do NOT use the newer `@dnd-kit/react` `useSortable` API — it is not installed

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - If the optimistic-then-rollback pattern now appears in both `TrackerPage.tsx` and here,
     extract it into a named module under `client/src/lib/` and use it in both
   - Re-run: `npm run test --workspace=client -- src/pages/TrackerProjectPage.test.tsx` — must stay PASS

6. Commit:
   `git add client/src/pages/TrackerProjectPage.tsx client/src/components/tracker/TrackerPhaseSection.tsx client/src/pages/TrackerProjectPage.test.tsx`
   `git commit -m "feat(tracker): add drag reordering inside phases"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rule: Ordering, including that this UI is cuttable while the endpoint is not
context7 `/clauderic/dnd-kit` — `SortableContext` + `verticalListSortingStrategy` + `arrayMove`
in `onDragEnd`; the installed version uses this legacy preset API, not `@dnd-kit/react`
client/src/pages/TrackerPage.tsx:133-203 — the existing optimistic-update-with-rollback and
in-flight-request discipline to mirror

## WHY THIS APPROACH

Justification: two files with well-understood library usage and an existing rollback pattern
to follow, but real interaction state to get right.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: use the LEGACY dnd-kit preset API (`@dnd-kit/core` + `@dnd-kit/sortable`) — the `@dnd-kit/react` `useSortable` API in current docs is NOT installed in this repo.]
You are implementing drag reordering for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — the client reorders optimistically and the server owns the fractional position.
Files in scope: `client/src/pages/TrackerProjectPage.tsx`, `TrackerPhaseSection.tsx`, the page test — no other files.
Test framework: Vitest with jsdom; run client tests with `npm run test --workspace=client`.
Available after: T15 (the page), T8 (the endpoint)
Architecture rule: this task is CUTTABLE — if it is dropped, the reorder endpoint and the `position` column must remain shipped and tested. Do not make anything else depend on this task.
[RESTATE: use the LEGACY dnd-kit preset API (`@dnd-kit/core` + `@dnd-kit/sortable`) — the `@dnd-kit/react` `useSortable` API in current docs is NOT installed in this repo.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given tasks A, B, C in a phase, When C is dragged between A and B, Then `reorderTrackerItem` is called with that target position
Given a drag in progress, When the drop lands, Then the new order shows before the request resolves
Given a failed reorder, When the request rejects, Then the previous order is restored and an error toast appears
[must-not] Given a drop outside the source phase, When it lands, Then no cross-phase reorder is submitted
[must-not] Given this task is cut, When the cycle ships, Then the reorder endpoint and `position` column remain present and tested

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Legacy dnd-kit preset API
  - Optimistic update with rollback on failure
  - Keyboard sensor wired for accessibility, as the Board usage does
  - Tests written BEFORE implementation

Must-not-have:
  - `@dnd-kit/react` imports
  - Cross-phase drag (that is assignment, handled by T7 and T16)
  - Any change to Board's drag code
  - Modifications to files outside the listed scope

Open question risks:
  - none

Rollback note:
  - Cutting this task leaves the endpoint and column intact; nothing else depends on it.

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Another task made dependent on this one → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: the installed dnd-kit version's API differs from the legacy preset expected here
Escalate when: reordering cannot be scoped to a single phase with the chosen collision strategy

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
