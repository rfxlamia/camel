# Tracker Project / Phase / WBS — Rollup and schedule derivation helper (Phase 3 of 4)

**Date:** 2026-08-05
**Original plan:** docs/pocket/plans/2026-08-05-tracker-project-phase-wbs/execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T12, T13, T16}
**Unlocks next:** Phase 4

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T12: Rollup and schedule derivation helper [depends: T11]
T13: Glyphs read the category column [depends: T11] [parallel: T12]
T16: Date fields and project/phase pickers on input surfaces [depends: T11]

---

## Pocket Packets

---

### Task 12: Rollup and schedule derivation helper [depends: T11]

## OBJECTIVE

Create the single derivation module every UI surface uses for progress, date bounds and
overdue — the one place Option B's correctness lives.

Files:
- Create: `client/src/lib/trackerRollup.ts`
- Test: `client/src/lib/trackerRollup.test.ts`
- Test: `client/src/lib/trackerUtils.test.ts`

Steps:

1. Write failing tests in `client/src/lib/trackerRollup.test.ts` for:
   - `rollup` of 5 completed / 2 canceled / 3 started returns 63% with counts 5 of 8
   - all-canceled returns the `no-active-work` state with no percentage
   - zero tasks returns the `no-tasks` state with no percentage
   - 8 completed / 2 canceled / 0 open returns 100%
   - a project rollup counts its phase-less tasks
   - `isTaskOverdue` is true for a past end date with a live status, false for `completed`,
     false for `canceled`, false with no end date, false when end equals today
   - `phaseBounds` returns derived `MIN`/`MAX` when no explicit date is set
   - `phaseBounds` honours an explicit start with a derived end (per-field fallback)
   - `isPhaseOverdue` is false when a past explicit end has all tasks completed or canceled
   - `isPhaseOverdue` is true for a past explicit end with zero tasks
   - `isProjectOverdue` inherits from a date-only overdue phase
   And in `client/src/lib/trackerUtils.test.ts`, lock the existing behaviour that had no
   tests: `sortStatusesByPosition`, `sortItemsOldestFirst`, `groupItemsByStatus`

   ```typescript
   // client/src/lib/trackerRollup.test.ts
   import { afterEach, describe, expect, it, vi } from "vitest";
   import type {
     TrackerItem,
     TrackerPhase,
     TrackerProject,
     TrackerStatusCategory,
   } from "../types";
   import {
     isPhaseOverdue,
     isProjectOverdue,
     isTaskOverdue,
     phaseBounds,
     rollup,
   } from "./trackerRollup";

   let nextId = 1;

   function taskItem(
     category: TrackerStatusCategory,
     overrides: Partial<TrackerItem> = {},
   ): TrackerItem {
     const id = nextId++;
     return {
       id,
       key: `CA-${id}`,
       title: "Task",
       description: "",
       status: {
         id: 1,
         kind: "status",
         name: "Status",
         position: 1024,
         colour: "#ccc",
         category,
       },
       priority: null,
       labels: [],
       assignees: [],
       version: 1,
       createdAt: "2026-08-01T00:00:00.000Z",
       updatedAt: "2026-08-01T00:00:00.000Z",
       projectId: null,
       phaseId: null,
       startDate: null,
       endDate: null,
       completedAt: null,
       position: 1024,
       ...overrides,
     };
   }

   function phase(overrides: Partial<TrackerPhase> = {}): TrackerPhase {
     return {
       id: 9,
       projectId: 1,
       name: "Phase",
       subtitle: "",
       startDate: null,
       endDate: null,
       position: 1024,
       version: 1,
       createdAt: "2026-08-01T00:00:00.000Z",
       updatedAt: "2026-08-01T00:00:00.000Z",
       ...overrides,
     };
   }

   function project(overrides: Partial<TrackerProject> = {}): TrackerProject {
     return {
       id: 1,
       name: "Project",
       startDate: null,
       endDate: null,
       position: 1024,
       version: 1,
       phases: [],
       createdAt: "2026-08-01T00:00:00.000Z",
       updatedAt: "2026-08-01T00:00:00.000Z",
       ...overrides,
     };
   }

   describe("rollup", () => {
     it("reports 63% for 5 completed, 2 canceled and 3 started", () => {
       const items = [
         ...Array.from({ length: 5 }, () => taskItem("completed")),
         ...Array.from({ length: 2 }, () => taskItem("canceled")),
         ...Array.from({ length: 3 }, () => taskItem("started")),
       ];
       const result = rollup(items);
       expect(result).toMatchObject({ kind: "percent", completed: 5, total: 8 });
       if (result.kind === "percent") {
         expect(Math.round(result.ratio * 100)).toBe(63);
       }
     });

     it("returns no-active-work when every task is canceled", () => {
       const items = [taskItem("canceled"), taskItem("canceled")];
       expect(rollup(items)).toEqual({ kind: "no-active-work" });
     });

     it("returns no-tasks for an empty list", () => {
       expect(rollup([])).toEqual({ kind: "no-tasks" });
     });

     it("reports 100% when every non-canceled task is completed", () => {
       const items = [
         ...Array.from({ length: 8 }, () => taskItem("completed")),
         ...Array.from({ length: 2 }, () => taskItem("canceled")),
       ];
       const result = rollup(items);
       expect(result).toMatchObject({ kind: "percent", completed: 8, total: 8 });
     });

     it("counts phase-less tasks when the caller scopes items to a project", () => {
       const proj = project({ id: 5 });
       const allItems = [
         taskItem("completed", { projectId: 5, phaseId: null }),
         taskItem("started", { projectId: 5, phaseId: 9 }),
         taskItem("started", { projectId: 99, phaseId: null }),
       ];
       const scoped = allItems.filter((i) => i.projectId === proj.id);
       const result = rollup(scoped);
       expect(result).toMatchObject({ kind: "percent", completed: 1, total: 2 });
     });
   });

   describe("isTaskOverdue", () => {
     afterEach(() => vi.useRealTimers());

     it("is true for a past end date with a live status", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       expect(isTaskOverdue(taskItem("started", { endDate: "2026-09-20" }))).toBe(true);
     });

     it("is false for completed", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       expect(isTaskOverdue(taskItem("completed", { endDate: "2026-09-20" }))).toBe(false);
     });

     it("is false for canceled", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       expect(isTaskOverdue(taskItem("canceled", { endDate: "2026-09-20" }))).toBe(false);
     });

     it("is false with no end date", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       expect(isTaskOverdue(taskItem("started", { endDate: null }))).toBe(false);
     });

     it("is false when end equals today", () => {
       vi.setSystemTime(new Date("2026-09-20T12:00:00"));
       expect(isTaskOverdue(taskItem("started", { endDate: "2026-09-20" }))).toBe(false);
     });
   });

   describe("phaseBounds", () => {
     it("returns derived MIN/MAX when no explicit date is set", () => {
       const ph = phase({ startDate: null, endDate: null });
       const items = [
         taskItem("started", { startDate: "2026-09-05", endDate: "2026-09-15" }),
         taskItem("started", { startDate: "2026-09-01", endDate: "2026-09-25" }),
       ];
       expect(phaseBounds(ph, items)).toEqual({
         startDate: "2026-09-01",
         endDate: "2026-09-25",
       });
     });

     it("honours an explicit start with a derived end (per-field fallback)", () => {
       const ph = phase({ startDate: "2026-09-01", endDate: null });
       const items = [
         taskItem("started", { startDate: "2026-09-10", endDate: "2026-09-25" }),
       ];
       expect(phaseBounds(ph, items)).toEqual({
         startDate: "2026-09-01",
         endDate: "2026-09-25",
       });
     });
   });

   describe("isPhaseOverdue", () => {
     afterEach(() => vi.useRealTimers());

     it("is false when a past explicit end has every task completed or canceled", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       const ph = phase({ id: 9, endDate: "2026-09-20" });
       const items = [
         taskItem("completed", { phaseId: 9 }),
         taskItem("canceled", { phaseId: 9 }),
       ];
       expect(isPhaseOverdue(ph, items)).toBe(false);
     });

     it("is true for a past explicit end with zero tasks", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       const ph = phase({ id: 9, endDate: "2026-09-20" });
       expect(isPhaseOverdue(ph, [])).toBe(true);
     });
   });

   describe("isProjectOverdue", () => {
     afterEach(() => vi.useRealTimers());

     it("inherits overdue from a date-only overdue phase", () => {
       vi.setSystemTime(new Date("2026-10-05T12:00:00"));
       const overduePhase = phase({ id: 9, projectId: 1, endDate: "2026-09-20" });
       const proj = project({ id: 1, phases: [overduePhase] });
       const items = [
         taskItem("started", { projectId: 1, phaseId: 9, endDate: null }),
         taskItem("started", { projectId: 1, phaseId: null, endDate: null }),
       ];
       expect(isProjectOverdue(proj, items)).toBe(true);
     });
   });
   ```

   ```typescript
   // client/src/lib/trackerUtils.test.ts
   //
   // trackerUtils.ts already exists with untested behaviour this task locks
   // down before trackerRollup.ts is built on top of it. No implementation
   // change is made here.
   import { describe, expect, it } from "vitest";
   import type { TrackerItem, TrackerVocabulary } from "../types";
   import {
     groupItemsByStatus,
     sortItemsOldestFirst,
     sortStatusesByPosition,
   } from "./trackerUtils";

   function vocab(id: number, name: string, position: number): TrackerVocabulary {
     return { id, kind: "status", name, position, colour: "#ccc" };
   }

   function item(id: number, statusId: number, createdAt: string): TrackerItem {
     return {
       id,
       key: `CA-${id}`,
       title: `Task ${id}`,
       description: "",
       status: {
         id: statusId,
         kind: "status",
         name: "Status",
         position: 0,
         colour: "#ccc",
       },
       priority: null,
       labels: [],
       assignees: [],
       version: 1,
       createdAt,
       updatedAt: createdAt,
     };
   }

   describe("sortStatusesByPosition", () => {
     it("orders statuses by ascending position", () => {
       const statuses = [
         vocab(3, "Done", 4096),
         vocab(1, "Backlog", 1024),
         vocab(2, "Todo", 2048),
       ];
       expect(sortStatusesByPosition(statuses).map((s) => s.name)).toEqual([
         "Backlog",
         "Todo",
         "Done",
       ]);
     });

     it("does not mutate the input array", () => {
       const statuses = [vocab(2, "Todo", 2048), vocab(1, "Backlog", 1024)];
       const copy = [...statuses];
       sortStatusesByPosition(statuses);
       expect(statuses).toEqual(copy);
     });
   });

   describe("sortItemsOldestFirst", () => {
     it("orders items by ascending createdAt", () => {
       const items = [
         item(1, 1, "2026-08-03T00:00:00.000Z"),
         item(2, 1, "2026-08-01T00:00:00.000Z"),
         item(3, 1, "2026-08-02T00:00:00.000Z"),
       ];
       expect(sortItemsOldestFirst(items).map((i) => i.id)).toEqual([2, 3, 1]);
     });
   });

   describe("groupItemsByStatus", () => {
     it("buckets items under their status id, sorted oldest first within each bucket", () => {
       const statuses = [vocab(1, "Backlog", 1024), vocab(2, "Done", 2048)];
       const items = [
         item(1, 1, "2026-08-02T00:00:00.000Z"),
         item(2, 2, "2026-08-01T00:00:00.000Z"),
         item(3, 1, "2026-08-01T00:00:00.000Z"),
       ];
       const grouped = groupItemsByStatus(items, statuses);
       expect(grouped.get(1)?.map((i) => i.id)).toEqual([3, 1]);
       expect(grouped.get(2)?.map((i) => i.id)).toEqual([2]);
     });

     it("initializes a bucket for every status even with no items", () => {
       const statuses = [vocab(1, "Backlog", 1024), vocab(2, "Done", 2048)];
       const grouped = groupItemsByStatus([], statuses);
       expect(grouped.get(1)).toEqual([]);
       expect(grouped.get(2)).toEqual([]);
     });

     it("drops items whose status id has no matching vocabulary", () => {
       const statuses = [vocab(1, "Backlog", 1024)];
       const items = [item(1, 999, "2026-08-01T00:00:00.000Z")];
       const grouped = groupItemsByStatus(items, statuses);
       expect(grouped.get(1)).toEqual([]);
       expect(grouped.get(999)).toBeUndefined();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/trackerRollup.test.ts`
   Expected failure: `Cannot find module './trackerRollup'`

3. Implement `client/src/lib/trackerRollup.ts` as pure functions over already-fetched data:
   - `rollup(items)` → a discriminated result: `{kind: "percent", completed, total, ratio}`,
     `{kind: "no-active-work"}`, or `{kind: "no-tasks"}`. Numerator counts
     `category === "completed"`; denominator counts `category !== "canceled"`
   - `isTaskOverdue(item)` → `endDate !== null && category not in {completed, canceled}
     && endDate < todayISODate()`, comparing ISO strings lexically
   - `phaseBounds(phase, items)` → per-field: explicit value wins, otherwise `MIN(startDate)`
     / `MAX(endDate)` across the phase's items
   - `isPhaseOverdue(phase, items)` → true if any task is overdue, OR the phase's explicit
     `endDate` is past AND not every task is `completed`/`canceled` (a phase with zero tasks
     counts as not-all-done, so it IS overdue)
   - `isProjectOverdue(project, items)` → true if any of its phases is overdue or any of its
     tasks is overdue
   - Import `todayISODate` from `./boardViewUtils` — read-only, do not edit that module.
     Do NOT use `date-fns`

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/trackerRollup.test.ts src/lib/trackerUtils.test.ts`
   Expected: PASS

5. Refactor while green (bounded):
   - If category checks appear inline three or more times, extract a small predicate
     (`isCompleted`, `isCanceled`, `isLive`) inside this module and use it everywhere
   - Re-run both test files — must stay PASS

6. Commit:
   `git add client/src/lib/trackerRollup.ts client/src/lib/trackerRollup.test.ts client/src/lib/trackerUtils.test.ts`
   `git commit -m "feat(tracker): derive rollup, bounds and overdue from item lists"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Rollup, Overdue; the three-branch rollup result and the phase-overdue carve-out
client/src/lib/boardViewUtils.ts:22-34,44-49 — `todayISODate`, `formatDueDate` and the
lexical ISO comparison this module reuses rather than reaching for `date-fns`
client/src/lib/trackerUtils.ts — the existing grouping helpers, whose behaviour this task
also locks with its first tests

## WHY THIS APPROACH

Justification: pure functions, but they encode every numeric and temporal rule in the spec,
and five UI surfaces depend on them agreeing.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: the denominator EXCLUDES canceled tasks, and a zero denominator is `no-active-work` — never 0% and never 100%.]
You are implementing the rollup and schedule derivation for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — this module IS the rollup implementation; no server aggregate exists or may be added.
Files in scope: `client/src/lib/trackerRollup.ts` and the two test files — no other files.
Test framework: Vitest with jsdom; run with `npm run test --workspace=client`.
Available after: T11 (client types)
Architecture rule: pure functions only — no fetching, no React, no side effects. Dates are `YYYY-MM-DD` strings compared lexically; `date-fns` must not be introduced. `boardViewUtils.ts` is imported read-only and never edited.
[RESTATE: the denominator EXCLUDES canceled tasks, and a zero denominator is `no-active-work` — never 0% and never 100%.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given 5 Done, 2 Canceled and 3 In Progress tasks, When rollup runs, Then it reports 63% and 5 of 8
Given all tasks canceled, When rollup runs, Then the result is `no-active-work` with no percentage
Given zero tasks, When rollup runs, Then the result is `no-tasks` with no percentage
Given a project with 2 phases and 4 phase-less tasks, When its rollup runs, Then every task with that project id is counted
Given end 2026-09-20, status In Progress, today 2026-10-05, When checked, Then the task is overdue
Given end 2026-09-20 and status Done, When checked, Then not overdue
Given end equal to today, When checked, Then not overdue
Given no end date, When checked, Then not overdue
Given a phase with explicit end 2026-09-20 and all six tasks Done, today 2026-10-05, When checked, Then not overdue
Given a phase with explicit end 2026-09-20 and zero tasks, today 2026-10-05, When checked, Then overdue
Given a phase with explicit start 2026-09-01, no explicit end, latest task ending 2026-09-25, When bounds are computed, Then the range is 2026-09-01 to 2026-09-25
Given a project whose only overdue descendant is a date-only overdue phase, When checked, Then the project is overdue
[must-not] Given a phase with no explicit dates, When bounds are derived, Then no task is ever flagged as outside the range

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Three-branch rollup result, not a bare number
  - Per-field date fallback, not all-or-nothing
  - Lexical ISO string comparison for every date check
  - Tests written BEFORE implementation

Must-not-have:
  - `date-fns` imported
  - Any edit to `boardViewUtils.ts`
  - React, hooks, or fetching inside this module
  - A general phase range check that flags tasks against derived bounds
  - Modifications to files outside the listed scope

Open question risks:
  - none

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Canceled tasks counted in the denominator → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: an item's status category is null because it predates the backfill
Escalate when: a rule cannot be expressed without fetching or server support

---

### Task 13: Glyphs read the category column [depends: T11] [parallel: T12]

## OBJECTIVE

Replace the name-regex inference in the status glyph with the `category` column, so a status
named "Batal" or "Selesai" renders correctly.

Files:
- Modify: `client/src/components/tracker/TrackerGlyphs.tsx`
- Test: `client/src/components/tracker/TrackerGlyphs.test.ts`

Steps:

1. Write failing tests in `client/src/components/tracker/TrackerGlyphs.test.ts` for:
   - a status named "Batal" with `category: "canceled"` yields the `cancelled` shape
   - a status named "Selesai" with `category: "completed"` yields the `done` shape
   - a status with `category: "backlog"` yields `pending`
   - a status with `category: "started"` yields `progress` with a fraction derived from
     position rank among the non-canceled statuses
   - a status whose `category` is null falls back to `pending` without throwing

   ```typescript
   // client/src/components/tracker/TrackerGlyphs.test.ts — REPLACES the
   // file's existing content. `category` is now the sole signal for shape,
   // so the old `vocab(id, name, position, kind)` helper (which had no
   // `category`) is replaced by `statusVocab`/`priorityVocab`. The
   // pre-existing position-rank assertions are kept, now driving fixtures
   // through explicit `category` rather than name matching, so this file
   // still locks the "started" fraction behaviour the objective calls out
   // as a required survivor.
   import { describe, expect, it } from "vitest";
   import type { TrackerVocabulary } from "../../types";
   import { priorityBars, statusGlyphSpec } from "./TrackerGlyphs";

   function statusVocab(
     id: number,
     name: string,
     position: number,
     category: TrackerVocabulary["category"] = null,
   ): TrackerVocabulary {
     return { id, kind: "status", name, position, colour: "#ccc", category };
   }

   function priorityVocab(
     id: number,
     name: string,
     position: number,
   ): TrackerVocabulary {
     return { id, kind: "priority", name, position, colour: "#ccc" };
   }

   const statuses = [
     statusVocab(1, "Backlog", 1024, "backlog"),
     statusVocab(2, "Todo", 2048, "backlog"),
     statusVocab(3, "In Progress", 3072, "started"),
     statusVocab(4, "Done", 4096, "completed"),
     statusVocab(5, "Canceled", 5120, "canceled"),
   ];

   describe("statusGlyphSpec", () => {
     it("marks the first workflow status as pending", () => {
       expect(statusGlyphSpec(statuses, 1)).toEqual({
         shape: "pending",
         fraction: 0,
       });
     });

     it("fills partially for mid-workflow statuses", () => {
       const spec = statusGlyphSpec(statuses, 3);
       expect(spec.shape).toBe("progress");
       expect(spec.fraction).toBeCloseTo(2 / 3);
     });

     it("marks the last workflow status as done", () => {
       expect(statusGlyphSpec(statuses, 4).shape).toBe("done");
     });

     it("excludes cancelled statuses from the progress scale", () => {
       expect(statusGlyphSpec(statuses, 5).shape).toBe("cancelled");
     });

     it("does not divide by zero for a lone started status among non-canceled ones", () => {
       const single = [statusVocab(9, "Only", 1024, "started")];
       const spec = statusGlyphSpec(single, 9);
       expect(spec.shape).toBe("progress");
       expect(Number.isFinite(spec.fraction)).toBe(true);
     });

     it("falls back to pending for an unknown status", () => {
       expect(statusGlyphSpec(statuses, 404).shape).toBe("pending");
     });

     it("renders the cancelled shape for a status named 'Batal' with category canceled", () => {
       const custom = [statusVocab(1, "Batal", 1024, "canceled")];
       expect(statusGlyphSpec(custom, 1).shape).toBe("cancelled");
     });

     it("renders the done shape for a status named 'Selesai' with category completed", () => {
       const custom = [statusVocab(1, "Selesai", 1024, "completed")];
       expect(statusGlyphSpec(custom, 1).shape).toBe("done");
     });

     it("renders pending for category backlog", () => {
       const custom = [statusVocab(1, "Antrian", 1024, "backlog")];
       expect(statusGlyphSpec(custom, 1).shape).toBe("pending");
     });

     it("renders progress for category started, fraction from position rank among non-canceled statuses", () => {
       const custom = [
         statusVocab(1, "Mulai", 1024, "started"),
         statusVocab(2, "Lanjut", 2048, "started"),
         statusVocab(3, "Selesai", 3072, "completed"),
       ];
       const spec = statusGlyphSpec(custom, 2);
       expect(spec.shape).toBe("progress");
       expect(spec.fraction).toBeCloseTo(1 / 2);
     });

     it("falls back to pending without throwing when category is null", () => {
       const custom = [statusVocab(1, "Legacy", 1024, null)];
       expect(() => statusGlyphSpec(custom, 1)).not.toThrow();
       expect(statusGlyphSpec(custom, 1).shape).toBe("pending");
     });

     it("ignores a name containing 'cancel' when its category is not canceled", () => {
       const custom = [
         statusVocab(1, "Cancel My Subscription Reminder", 1024, "started"),
         statusVocab(2, "Done", 2048, "completed"),
       ];
       const spec = statusGlyphSpec(custom, 1);
       expect(spec.shape).not.toBe("cancelled");
       expect(spec.shape).toBe("progress");
     });
   });

   describe("priorityBars", () => {
     const priorities = [
       priorityVocab(10, "High", 1024),
       priorityVocab(11, "Medium", 2048),
       priorityVocab(12, "Low", 3072),
     ];

     it("lights every bar for the highest priority", () => {
       expect(priorityBars(priorities, 10)).toBe(3);
     });

     it("lights one bar for the lowest priority", () => {
       expect(priorityBars(priorities, 12)).toBe(1);
     });

     it("returns no bars for an unknown priority", () => {
       expect(priorityBars(priorities, 99)).toBe(0);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/components/tracker/TrackerGlyphs.test.ts`
   Expected failure: "Batal" is not recognised as cancelled because the regex does not match

3. Implement in `client/src/components/tracker/TrackerGlyphs.tsx`:
   - Delete the `CANCELLED = /cancel/i` constant at :9 and both its uses at :27 and :29
   - `statusGlyphSpec` selects the shape from `category`: `canceled` → `cancelled`,
     `completed` → `done`, `backlog` → `pending`, `started` → `progress`
   - Inside `started`, keep deriving the fill fraction from position rank among statuses
     whose category is not `canceled`, preserving today's visual behaviour
   - A null `category` falls back to `pending`

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/components/tracker/TrackerGlyphs.test.ts`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - If the category-to-shape mapping is expressed as a chain of conditionals, replace it
     with a single lookup object
   - Re-run: `npm run test --workspace=client -- src/components/tracker/TrackerGlyphs.test.ts` — must stay PASS

6. Commit:
   `git add client/src/components/tracker/TrackerGlyphs.tsx client/src/components/tracker/TrackerGlyphs.test.ts`
   `git commit -m "fix(tracker): derive status glyphs from category instead of the name"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rule: Status semantics, "glyphs read the column, never the name"
client/src/components/tracker/TrackerGlyphs.tsx:9,20-36 — the regex and the position-rank
fraction logic that must survive for `started`
client/src/components/tracker/TrackerGlyphs.test.ts — the existing test file this extends

## WHY THIS APPROACH

Justification: one component file plus its test, with a precisely specified behaviour change
and an existing visual detail that must be preserved.
Complexity: lightweight

## SANDWICH CONTEXT

[CRITICAL: no name-based matching may remain — the `/cancel/i` regex is deleted, not kept as a fallback.]
You are implementing the glyph fix for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — `category` is the single machine-readable signal, shared by glyphs and rollup.
Files in scope: `client/src/components/tracker/TrackerGlyphs.tsx` and its test — no other files.
Test framework: Vitest with jsdom; run with `npm run test --workspace=client`.
Available after: T11 (the `category` field on `TrackerVocabulary`)
Architecture rule: preserve the existing `started` fill fraction derived from position rank — four categories alone cannot reproduce it, and losing it is a visual regression.
[RESTATE: no name-based matching may remain — the `/cancel/i` regex is deleted, not kept as a fallback.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a status named "Batal" with category `canceled`, When a row renders, Then the cancelled glyph shows
Given a status named "Selesai" with category `completed`, When a row renders, Then the done glyph shows
Given a status with category `started`, When rendered, Then the progress ring is filled proportionally to its position rank
Given a status with a null category, When rendered, Then it falls back to `pending` without throwing
[must-not] Given any status, When its glyph is computed, Then no name-based regex participates in the decision

All tests PASS. Commit exists with message matching `fix(tracker): …`.

## QUALITY BAR

Must-have:
  - `CANCELLED` regex deleted entirely
  - `started` fraction behaviour preserved
  - Null category handled without throwing
  - Tests written BEFORE implementation

Must-not-have:
  - Name matching retained as a fallback
  - Changes to the SVG rendering or sizing
  - Modifications to files outside the listed scope

Open question risks:
  - Grandfathered statuses carry `category: "backlog"` and will render flat `pending` — this
    is accepted, not a bug

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Any string comparison against a status name → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: an existing snapshot or test depends on the regex behaviour
Escalate when: preserving the `started` fraction proves impossible from category plus position

---

### Task 16: Date fields and project/phase pickers on input surfaces [depends: T11]

## OBJECTIVE

Let people actually set the new fields: dates on the create modal, and dates plus project
and phase pickers on the detail page.

Files:
- Create: `client/src/components/tracker/TrackerDateFields.tsx`
- Modify: `client/src/components/tracker/TrackerCreateModal.tsx`
- Modify: `client/src/pages/TrackerDetailPage.tsx`
- Test: `client/src/components/tracker/TrackerCreateModal.test.tsx`
- Test: `client/src/pages/TrackerDetailPage.test.tsx`

Steps:

1. Write failing tests for:
   - the create modal submits `startDate` and `endDate` when both are filled
   - the create modal submits without dates when they are left empty
   - the create modal surfaces the server's 400 for an inverted range as an inline message
   - the detail page renders start and end fields and saves them
   - the detail page offers project and phase pickers, and choosing a project resets the
     phase selection
   - the detail page shows the overdue marker for a past end date with a live status

   ```typescript
   // Appended to client/src/components/tracker/TrackerCreateModal.test.tsx —
   // reuses `renderModal`, `createTrackerItem` and the `statuses`/`priorities`
   // fixtures already declared at the top of this file. Import `ApiError`
   // alongside the existing `../../api` import (the mocked class the module
   // factory already exports).
   describe("TrackerCreateModal dates", () => {
     it("submits startDate and endDate when both are filled", async () => {
       renderModal();
       fireEvent.change(screen.getByLabelText("Item title"), {
         target: { value: "Ship the release" },
       });
       fireEvent.change(screen.getByLabelText(/start date/i), {
         target: { value: "2026-09-21" },
       });
       fireEvent.change(screen.getByLabelText(/end date/i), {
         target: { value: "2026-09-30" },
       });
       fireEvent.click(screen.getByRole("button", { name: "Create item" }));
       await waitFor(() =>
         expect(createTrackerItem).toHaveBeenCalledWith(7, {
           title: "Ship the release",
           statusId: 1,
           priorityId: null,
           startDate: "2026-09-21",
           endDate: "2026-09-30",
         }),
       );
     });

     it("submits without startDate or endDate when both are left empty", async () => {
       renderModal();
       fireEvent.change(screen.getByLabelText("Item title"), {
         target: { value: "No dates" },
       });
       fireEvent.click(screen.getByRole("button", { name: "Create item" }));
       await waitFor(() => expect(createTrackerItem).toHaveBeenCalled());
       const [, body] = createTrackerItem.mock.calls[0] as [number, Record<string, unknown>];
       expect(body).not.toHaveProperty("startDate");
       expect(body).not.toHaveProperty("endDate");
     });

     it("surfaces the server's 400 for an inverted date range inline", async () => {
       createTrackerItem.mockRejectedValueOnce(
         new ApiError("End date must be on or after the start date.", 400),
       );
       renderModal();
       fireEvent.change(screen.getByLabelText("Item title"), {
         target: { value: "Bad range" },
       });
       fireEvent.change(screen.getByLabelText(/start date/i), {
         target: { value: "2026-09-30" },
       });
       fireEvent.change(screen.getByLabelText(/end date/i), {
         target: { value: "2026-09-21" },
       });
       fireEvent.click(screen.getByRole("button", { name: "Create item" }));
       expect(
         await screen.findByText("End date must be on or after the start date."),
       ).toBeTruthy();
       expect(screen.getByLabelText("Item title")).toBeTruthy();
     });
   });
   ```

   ```typescript
   // Appended to client/src/pages/TrackerDetailPage.test.tsx — reuses the
   // mocked api, `item` fixture, `backlog`/`inProgress` statuses and `ApiError`
   // import already declared at the top of this file. Extend the top-level
   // `vi.hoisted` block and `vi.mock("../api", …)` factory with one more entry
   // (`mockListTrackerProjects` → `listTrackerProjects`), matching the shape
   // already there, and default it to `[projectA, projectB]` below.
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

   const projectA: TrackerProject = {
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

   const projectB: TrackerProject = {
     id: 2,
     name: "Rilis v3",
     startDate: null,
     endDate: null,
     position: 2048,
     version: 1,
     phases: [],
     createdAt: "2026-08-01T00:00:00Z",
     updatedAt: "2026-08-01T00:00:00Z",
   };

   beforeEach(() => {
     mockListTrackerProjects.mockResolvedValue([projectA, projectB]);
   });

   describe("TrackerDetailPage dates and project/phase pickers", () => {
     it("sets and saves start and end dates from the property rail", async () => {
       mockUpdateTrackerItem.mockResolvedValue({
         ...item,
         startDate: "2026-09-21",
         endDate: "2026-09-30",
         version: 2,
       });
       render(<TrackerDetailPage />);
       await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
       fireEvent.change(screen.getByLabelText(/start date/i), {
         target: { value: "2026-09-21" },
       });
       fireEvent.change(screen.getByLabelText(/end date/i), {
         target: { value: "2026-09-30" },
       });
       fireEvent.click(screen.getByRole("button", { name: /save/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "CK-42", {
           title: "Workspace Rename",
           description: "details",
           startDate: "2026-09-21",
           endDate: "2026-09-30",
           version: 1,
         }),
       );
     });

     it("resets the phase selection when a different project is picked", async () => {
       mockUpdateTrackerItem
         .mockResolvedValueOnce({ ...item, projectId: 1, phaseId: null, version: 2 })
         .mockResolvedValueOnce({ ...item, projectId: 1, phaseId: 9, version: 3 })
         .mockResolvedValueOnce({ ...item, projectId: 2, phaseId: null, version: 4 });
       render(<TrackerDetailPage />);
       await waitFor(() => screen.getByDisplayValue("Workspace Rename"));

       // Assign the first project — the phase starts unset.
       fireEvent.click(await screen.findByRole("button", { name: /project/i }));
       fireEvent.click(screen.getByRole("option", { name: /rilis v2/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerItem).toHaveBeenCalledWith(7, "CK-42", {
           projectId: 1,
           phaseId: null,
           version: 1,
         }),
       );

       // Pick a phase within that project.
       fireEvent.click(screen.getByRole("button", { name: /phase/i }));
       fireEvent.click(screen.getByRole("option", { name: /persiapan/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CK-42", {
           projectId: 1,
           phaseId: 9,
           version: 2,
         }),
       );

       // Switching projects clears the now-inconsistent phase in the same request.
       fireEvent.click(screen.getByRole("button", { name: /rilis v2/i }));
       fireEvent.click(screen.getByRole("option", { name: /rilis v3/i }));
       await waitFor(() =>
         expect(mockUpdateTrackerItem).toHaveBeenLastCalledWith(7, "CK-42", {
           projectId: 2,
           phaseId: null,
           version: 3,
         }),
       );
     });

     it("shows the overdue marker for a past end date with a live status", async () => {
       mockGetTrackerItem.mockResolvedValue({
         ...item,
         status: inProgress,
         endDate: "2026-07-01",
       });
       vi.setSystemTime(new Date("2026-08-05T12:00:00"));
       render(<TrackerDetailPage />);
       await waitFor(() => screen.getByDisplayValue("Workspace Rename"));
       expect(screen.getByLabelText(/overdue/i)).toBeTruthy();
       vi.useRealTimers();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx src/pages/TrackerDetailPage.test.tsx`
   Expected failure: no date inputs found

3. Implement:
   - `TrackerDateFields.tsx`: a shared start/end date field pair, created **unconditionally**
     in this task — not as a conditional refactor. Both surfaces below use it, and T18 reuses
     it for explicit phase dates, so it must exist by the end of this task
   - `TrackerCreateModal.tsx`: add the shared date fields to the existing chip-row property
     layout, following its current picker composition
   - `TrackerDetailPage.tsx`: add date fields to the property rail, plus project and phase
     pickers built on `TrackerPropertyPicker`; selecting a project clears the phase choice
     so an inconsistent pair can never be submitted
   - Both surfaces send `YYYY-MM-DD` strings and rely on server validation for the inverted
     range, rendering the returned message inline

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/components/tracker/TrackerCreateModal.test.tsx src/pages/TrackerDetailPage.test.tsx`
   Then: `npm run test --workspace=client` and `npm run typecheck`
   Expected: PASS

5. Refactor while green (bounded):
   - Confirm neither surface carries its own copy of the date markup — both must render
     `TrackerDateFields`. If either inlined it, move it into the shared component
   - Re-run both test files — must stay PASS

6. Commit:
   `git add client/src/components/tracker/TrackerDateFields.tsx client/src/components/tracker/TrackerCreateModal.tsx client/src/pages/TrackerDetailPage.tsx client/src/components/tracker/TrackerCreateModal.test.tsx client/src/pages/TrackerDetailPage.test.tsx`
   `git commit -m "feat(tracker): add schedule fields and project pickers to item surfaces"`

## REFERENCES LOADED

docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md —
rules: Scheduling, Project / phase assignment
client/src/components/tracker/TrackerCreateModal.tsx — the chip-row property layout to extend
client/src/pages/TrackerDetailPage.tsx — the document-with-property-rail layout to extend
client/src/components/tracker/TrackerPropertyPicker.tsx — the picker the new selectors reuse
docs/pocket/rule/creative-brief.md — input states, 6px radius, Work Sans, neutral-friendly copy

## WHY THIS APPROACH

Justification: two established surfaces, both extended with the same field set, where the
picker interaction rule (project resets phase) carries real correctness weight.
Complexity: standard

## SANDWICH CONTEXT

[CRITICAL: choosing a project MUST reset the phase selection — the client must never submit a phase belonging to a different project.]
You are implementing the item input surfaces for Tracker Project / Phase / WBS.
Spec: docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md
Design decision: Option B — these surfaces submit raw ids and dates; the server validates and the client derives display state.
Files in scope: `TrackerDateFields.tsx`, `TrackerCreateModal.tsx`, `TrackerDetailPage.tsx` and the two test files — no other files.
Test framework: Vitest with jsdom; run client tests with `npm run test --workspace=client`.
Available after: T11 (client types and API)
Architecture rule: dates travel as `YYYY-MM-DD` strings; reuse `TrackerPropertyPicker` rather than building a new picker; follow the creative brief for input states and copy.
[RESTATE: choosing a project MUST reset the phase selection — the client must never submit a phase belonging to a different project.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given the create modal, When a member sets start 2026-09-21 and end 2026-09-30, Then both are submitted as `YYYY-MM-DD` strings
Given the create modal, When dates are left empty, Then the item is created without them
Given the detail page, When a member sets dates, Then they save and the range renders
Given the detail page, When a member picks a different project, Then the phase selection resets
Given a task with a past end date and a live status, When the detail page renders, Then the overdue marker appears
[must-not] Given an inverted range, When submitted, Then the server's 400 is surfaced inline rather than swallowed
[must-not] Given the pickers, When used, Then a phase from another project can never be submitted

All tests PASS. Commit exists with message matching `feat(tracker): …`.

## QUALITY BAR

Must-have:
  - Project change resets phase selection
  - Dates submitted as calendar strings
  - Server validation errors surfaced inline in the brief's neutral-friendly register
  - Tests written BEFORE implementation

Must-not-have:
  - Client-side duplication of the server's date validation rules beyond basic input typing
  - A second picker implementation
  - Comments or attachments UI
  - Modifications to files outside the listed scope

Open question risks:
  - none

Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - A phase from a different project submittable → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, client tests green, commit created
Uncertain when: the detail page's existing save path cannot carry the new fields without restructuring
Escalate when: the picker cannot express the project→phase dependency without a new component

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 4 ONLY after this gate passes.
