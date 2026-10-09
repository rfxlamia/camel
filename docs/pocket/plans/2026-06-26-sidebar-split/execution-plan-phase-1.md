# Sidebar.tsx Granular Split — Extract shared primitives — navItems.ts + shared.tsx (Phase 1 of 2)

**Date:** 2026-06-26
**Original plan:** docs/pocket/plans/2026-06-26-sidebar-split/execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T3, T4, T5}
**Unlocks next:** Phase 2

---

## Task List

Total: 5 tasks | Prerequisite phases must be complete before starting

T1: Extract shared primitives — navItems.ts + shared.tsx [prereq]
T2: useSidebarMode hook [depends: T1]
T3: Extract SignOutPopover [depends: T1]
T4: Extract ModeSwitcher [depends: T1]
T5: Extract WorkspaceSwitcher (+ WorkspaceAvatar) [depends: T1]

---

## Pocket Packets

---

### Task 1: Extract shared primitives — navItems.ts + shared.tsx [prereq]

## OBJECTIVE
Create the two foundation files every other sidebar file imports: `navItems.ts` (nav data + `getModeFromPath`) and `shared.tsx` (`Mode` type, `PopoverShell`, `navLinkClass`, `inputClass`). Move these verbatim from `client/src/layout/Sidebar.tsx`. The old `Sidebar.tsx` stays untouched and still owns the originals — this task only adds the new files.

Files:
- Create: `client/src/layout/sidebar/shared.tsx`
- Create: `client/src/layout/sidebar/navItems.ts`
- Test: `client/src/layout/sidebar/navItems.test.ts`

Steps:
1. Write failing test for: `getModeFromPath` (Story 2 — pure logic that drives mode selection).
   File: `client/src/layout/sidebar/navItems.test.ts`
   Pure function — no DOM/render needed (this file is `.ts`, no JSX). Insert exactly:
   ```ts
   import { describe, expect, it } from "vitest";
   import { getModeFromPath } from "./navItems";

   describe("getModeFromPath", () => {
     it("returns 'agent' for /agent", () => {
       expect(getModeFromPath("/agent")).toBe("agent");
     });

     it("returns 'agent' for /history", () => {
       expect(getModeFromPath("/history")).toBe("agent");
     });

     it("returns 'agent' for a nested /agent/abc (startsWith match)", () => {
       expect(getModeFromPath("/agent/abc")).toBe("agent");
     });

     it("returns 'kanban' for /board", () => {
       expect(getModeFromPath("/board")).toBe("kanban");
     });

     it("returns 'kanban' for /settings (default branch, not special-cased here)", () => {
       expect(getModeFromPath("/settings")).toBe("kanban");
     });

     it("returns 'kanban' for /dashboard", () => {
       expect(getModeFromPath("/dashboard")).toBe("kanban");
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/layout/sidebar/navItems.test.ts`
   Expected failure: module `./navItems` not found / `getModeFromPath` is not a function.

3. Implement the two files (move from `Sidebar.tsx` verbatim, adjust nothing behavioral):
   - `shared.tsx` exports:
     - `export type Mode = "kanban" | "agent";`
     - `export function PopoverShell({...}: PopoverShellProps)` — copy lines 114–162 of `Sidebar.tsx` exactly (incl. the Escape `useEffect`, `placement` position/arrow classes). Export it (was unexported).
     - `export function navLinkClass({ isActive }: { isActive: boolean }): string` — copy lines 99–105 exactly.
     - `export const inputClass = "..."` — copy line 107–108 exactly.
     - Keep `import { useEffect } from "react"` and `import type React from "react"` as needed for `PopoverShell`'s `children: React.ReactNode`.
   - `navItems.ts` exports:
     - `export const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[]` — copy lines 34–41 exactly (keep the `import { ... type LucideIcon } from "lucide-react"`).
     - `export const KANBAN_NAV`, `export const AGENT_NAV`, `export const AGENT_PATHS`, `export const SETTINGS_ITEM` — copy lines 46–53 exactly.
     - `export function getModeFromPath(pathname: string): Mode` — copy lines 57–59 exactly; add `import type { Mode } from "./shared";`.
   - Import direction: `navItems.ts` imports `Mode` FROM `shared.tsx`. `shared.tsx` imports nothing from `navItems.ts` (no cycle).

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/layout/sidebar/navItems.test.ts`
   Then confirm whole project still typechecks: `npm run typecheck --workspace=client`
   Expected: test PASS, typecheck clean (new files compile; old `Sidebar.tsx` still independently compiles).

5. Commit:
   `git add client/src/layout/sidebar/shared.tsx client/src/layout/sidebar/navItems.ts client/src/layout/sidebar/navItems.test.ts`
   `git commit -m "refactor(sidebar): extract shared primitives and nav items"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md — Story 1 Rule 3 (shared primitives → shared.tsx / navItems.ts); Story 2 (getModeFromPath drives mode).
client/src/layout/Sidebar.tsx — source of the verbatim definitions (lines 34–162); existing patterns: NavLink className fn, OKLCH focus ring on inputClass.

## WHY THIS APPROACH
Complexity: lightweight
Justification: 2 new files + 1 test, verbatim move. `getModeFromPath` is the only piece of real logic and it is pure → genuine red→green. Everything depends on this so it is the sole prereq.

## SANDWICH CONTEXT
[CRITICAL: This is a PURE MOVE — copy definitions byte-for-byte from Sidebar.tsx. Any behavioral change is a redo.]
You are implementing the shared-primitives extraction for the Sidebar.tsx Granular Split.
Spec: docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md
Design decision: Option A — flat `sidebar/` folder, barrel export, shared primitives in `shared.tsx`/`navItems.ts`.
Files in scope: client/src/layout/sidebar/shared.tsx, client/src/layout/sidebar/navItems.ts, client/src/layout/sidebar/navItems.test.ts — NO other files. Do NOT edit the old Sidebar.tsx.
Test framework: Vitest + jsdom; run `npm run test --workspace=client`. Client imports use NO file extensions.
Available after: none (prereq).
Architecture rule: `shared` must be `.tsx` (PopoverShell is JSX). Mode type lives in shared; navItems imports it (one-way, no cycle).
[RESTATE: Byte-for-byte move from Sidebar.tsx. PopoverShell behavior/positioning is out-of-scope to change.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given pathname `/agent`, When `getModeFromPath` called, Then returns `"agent"`.
Given pathname `/history`, When `getModeFromPath` called, Then returns `"agent"`.
Given pathname `/agent/abc` (startsWith), When `getModeFromPath` called, Then returns `"agent"`.
Given pathname `/board`, When `getModeFromPath` called, Then returns `"kanban"`.
[derived — no GWT in spec] Given pathname `/settings`, When `getModeFromPath` called, Then returns `"kanban"` (default branch, not special-cased here).
Given the project, When `npm run typecheck --workspace=client` runs, Then exit 0 (new files compile; old Sidebar.tsx unaffected).

All tests PASS. Commit exists matching `refactor(sidebar): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `shared.tsx` exports `Mode`, `PopoverShell`, `navLinkClass`, `inputClass`; `navItems.ts` exports `NAV_ITEMS`, `KANBAN_NAV`, `AGENT_NAV`, `AGENT_PATHS`, `SETTINGS_ITEM`, `getModeFromPath`.
  - Definitions copied verbatim from Sidebar.tsx (no behavioral edits).
  - `getModeFromPath` test written BEFORE the move (TDD).
  - Conventional commit format.

Must-not-have:
  - Editing the old `Sidebar.tsx` (stays the source of truth until T9).
  - Changing `PopoverShell` behavior or positioning logic (out-of-scope).
  - Touching `server/`, `context/`, `pages/`, `components/`, or `lib/`.
  - Adding `.ts`/`.tsx`/`.js` extensions to imports.

Open question risks:
  - None for this task.

Rollback note:
  - Whole feature reverts via `git revert` of the cutover; these added files are inert until imported.

Red flags:
  - Editing files outside the 3 listed → DONE_WITH_CONCERNS.
  - Any diff to PopoverShell semantics → STOP.

## STOP CONDITIONS
Done when: `getModeFromPath` tests pass, typecheck clean, commit created, old Sidebar.tsx untouched.
Uncertain when: a definition cannot be moved verbatim without a type error (report NEEDS_CONTEXT with the error).
Escalate when: the move would require changing PopoverShell behavior, or touching a file outside scope.

---

### Task 2: useSidebarMode hook [depends: T1]

## OBJECTIVE
Create `useSidebarMode()` — the hook that owns mode state for AppLayout, encapsulating `getModeFromPath` + the path-sync `useEffect` currently duplicated inside Sidebar and MobileNav. This is the one piece of NEW behavior in the refactor (Story 2): lifting mode so mobile and desktop share it.

Files:
- Create: `client/src/layout/sidebar/useSidebarMode.ts`
- Test: `client/src/layout/sidebar/useSidebarMode.test.tsx`

Steps:
1. Write failing test for: Story 2 mode-sync rules (init, URL nav, settings-preserve, settings-leave).
   File: `client/src/layout/sidebar/useSidebarMode.test.tsx`
   Drives REAL location changes with a `MemoryRouter` + a `useNavigate` harness (no router
   mocking — `getModeFromPath` and `Mode` are real modules, not stubbed). Button labels
   ("to-agent"/"to-board"/"to-settings") are deliberately distinct from the mode span text
   ("agent"/"kanban") so `getByText` never collides. Insert exactly:
   ```tsx
   import {
     cleanup,
     fireEvent,
     render,
     screen,
   } from "@testing-library/react";
   import { MemoryRouter, useNavigate } from "react-router";
   import { afterEach, describe, expect, it } from "vitest";
   import { useSidebarMode } from "./useSidebarMode";

   function Harness() {
     const [mode] = useSidebarMode();
     const navigate = useNavigate();
     return (
       <div>
         <span data-testid="mode">{mode}</span>
         <button type="button" onClick={() => navigate("/agent")}>
           to-agent
         </button>
         <button type="button" onClick={() => navigate("/board")}>
           to-board
         </button>
         <button type="button" onClick={() => navigate("/settings")}>
           to-settings
         </button>
         <button type="button" onClick={() => navigate("/settings/account")}>
           to-settings-nested
         </button>
       </div>
     );
   }

   function renderAt(path: string) {
     return render(
       <MemoryRouter initialEntries={[path]}>
         <Harness />
       </MemoryRouter>,
     );
   }

   const currentMode = () => screen.getByTestId("mode").textContent;

   describe("useSidebarMode", () => {
     afterEach(cleanup);

     it("initializes mode from the current path", () => {
       renderAt("/agent");
       expect(currentMode()).toBe("agent");
     });

     it("syncs mode when the URL changes to a mode route (Rule 2 Ex. B)", () => {
       renderAt("/board");
       expect(currentMode()).toBe("kanban");
       fireEvent.click(screen.getByText("to-agent"));
       expect(currentMode()).toBe("agent");
     });

     it("does NOT reset mode when navigating to /settings (discriminator)", () => {
       renderAt("/agent");
       expect(currentMode()).toBe("agent");
       fireEvent.click(screen.getByText("to-settings"));
       // exact `!== "/settings"` excludes settings — mode is preserved
       expect(currentMode()).toBe("agent");
     });

     it("updates mode when leaving /settings for a mode route (Rule 3 Ex. B)", () => {
       renderAt("/agent");
       fireEvent.click(screen.getByText("to-settings"));
       expect(currentMode()).toBe("agent"); // still agent while on /settings
       fireEvent.click(screen.getByText("to-board"));
       expect(currentMode()).toBe("kanban");
     });

     it("uses EXACT /settings match, not startsWith — a nested settings route syncs", () => {
       // True discriminator: `!== "/settings"` and `startsWith("/settings")`
       // behave identically on the exact path. They diverge on a nested path:
       // exact `!==` → sync to "kanban"; forbidden `startsWith` → stays "agent".
       renderAt("/agent");
       expect(currentMode()).toBe("agent");
       fireEvent.click(screen.getByText("to-settings-nested"));
       expect(currentMode()).toBe("kanban");
     });
   });
   ```
   > Note (for the T2 implementer): RTL `fireEvent` wraps `act`, which flushes the
   > effect's `setMode` before the assertion — these assertions are synchronous. If a
   > future change ever defers the update, wrap reads in `waitFor` rather than touching
   > the hook.

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/layout/sidebar/useSidebarMode.test.tsx`
   Expected failure: module `./useSidebarMode` not found / `useSidebarMode is not a function`.

3. Implement `useSidebarMode.ts` (mirror the EXACT logic from Sidebar.tsx lines 809–820):
   ```ts
   import { useEffect, useState } from "react";
   import { useLocation } from "react-router";
   import { getModeFromPath } from "./navItems";
   import type { Mode } from "./shared";

   export function useSidebarMode(): [Mode, (m: Mode) => void] {
     const location = useLocation();
     const [mode, setMode] = useState<Mode>(() => getModeFromPath(location.pathname));
     useEffect(() => {
       // Exact equality — NOT startsWith. Navigating TO /settings must not change mode;
       // leaving /settings to a mode route is URL-driven. Effect keyed on pathname only,
       // so a manual ModeSwitcher click persists until the next navigation.
       if (location.pathname !== "/settings") {
         setMode(getModeFromPath(location.pathname));
       }
     }, [location.pathname]);
     return [mode, setMode];
   }
   ```
   CRITICAL details (do not "improve"):
   - Comparison is `location.pathname !== "/settings"` (exact), NOT `startsWith("/settings")`. (AppLayout has an `onSettings = startsWith(...)` nearby — do NOT reuse it; it would change behavior.)
   - Effect dependency array is `[location.pathname]` only — so a `setMode` from a ModeSwitcher click is not overwritten until an actual navigation occurs (Story 2 Rule 2 Example A: switch on mobile → close drawer → desktop reads same mode, with no navigation between).

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/layout/sidebar/useSidebarMode.test.tsx`
   Then `npm run typecheck --workspace=client` → exit 0.
   Expected: all 5 scenarios PASS.

5. Commit:
   `git add client/src/layout/sidebar/useSidebarMode.ts client/src/layout/sidebar/useSidebarMode.test.tsx`
   `git commit -m "feat(sidebar): add useSidebarMode hook for lifted mode state"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md — Story 2 Rules 1–3 + 4 Gherkin scenarios; Acceptance "Mode state synchronization" block (incl. negative rule).
client/src/layout/Sidebar.tsx:809-820 — exact source logic (init + path-sync effect, `!== "/settings"`).
client/src/layout/AppLayout.tsx:20 — note the existing `onSettings = startsWith("/settings")`; intentionally NOT reused.

## WHY THIS APPROACH
Complexity: standard
Justification: only 1 small file but it is the sole behavioral change and has a subtle negative criterion (settings-preserve) plus an effect-keying nuance. Branching logic + must-not rule → promoted to standard.

## SANDWICH CONTEXT
[CRITICAL: Use exact `pathname !== "/settings"` and effect deps `[location.pathname]` — these encode the zero-regression mode behavior. Reusing AppLayout's `startsWith` onSettings, or adding `mode` to the deps, is a redo.]
You are implementing the `useSidebarMode` hook for the Sidebar.tsx Granular Split.
Spec: docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md
Design decision: Option A — mode state lifted to AppLayout; this hook encapsulates getModeFromPath + the sync effect.
Files in scope: client/src/layout/sidebar/useSidebarMode.ts, client/src/layout/sidebar/useSidebarMode.test.tsx — NO others.
Test framework: Vitest + jsdom; render the hook inside a router that lets you change location (MemoryRouter + a navigating harness, or controlled useLocation mock). Run `npm run test --workspace=client`.
Available after: T1 (needs `getModeFromPath` from navItems, `Mode` from shared).
Architecture rule: hook returns `[mode, setMode]`; no other responsibilities. Do not refactor BoardContext.
[RESTATE: Exact `!== "/settings"` and `[location.pathname]`-only deps. The negative criterion (settings does not reset mode) is the discriminating test.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given initial route `/agent`, When the hook mounts, Then `mode === "agent"`.
Given route `/board` then navigation to `/agent`, When the effect runs, Then `mode === "agent"`.
[must-not] Given `mode === "agent"`, When route changes to `/settings`, Then `mode` must NOT change (stays `"agent"`).
Given `mode === "agent"` on `/settings`, When route changes to `/board`, Then `mode === "kanban"`.
[discriminator] Given `mode === "agent"`, When route changes to nested `/settings/account`, Then `mode === "kanban"` (proves EXACT `!== "/settings"`, not `startsWith` — they only diverge on nested paths; matches current Sidebar behavior).
Given the project, When `npm run typecheck --workspace=client`, Then exit 0.

All tests PASS. Commit exists matching `feat(sidebar): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written BEFORE the hook (TDD), covering all 4 Story-2 scenarios incl. the negative one.
  - Logic identical in behavior to Sidebar.tsx:809-820.
  - Conventional commit format.

Must-not-have:
  - `startsWith("/settings")` (must be exact `!==`).
  - `mode` in the effect dependency array.
  - Touching BoardContext or any file outside the 2 listed.

Open question risks:
  - Mode-sync mechanism assumed to be "lift to AppLayout" (resolved in spec, low risk) → if a consumer needs mode before AppLayout mounts it, report NEEDS_CONTEXT.

Rollback note:
  - Reverts with the feature; AppLayout wiring happens in T9, so this hook is inert until then.

Red flags:
  - Test passes without exercising the settings-preserve path → coverage gap, DONE_WITH_CONCERNS.
  - Any change to BoardContext → STOP.

## STOP CONDITIONS
Done when: all 4 scenarios pass, typecheck clean, commit created.
Uncertain when: router test harness cannot drive location changes (report NEEDS_CONTEXT with approach tried).
Escalate when: zero-regression requires deviating from the exact `!==`/deps logic.

---

### Task 3: Extract SignOutPopover [depends: T1]

## OBJECTIVE
Move `SignOutPopover` into its own file, importing `PopoverShell` from `./shared`. Verbatim move from `Sidebar.tsx` lines 168–218. No barrel entry (stays internal).

Files:
- Create: `client/src/layout/sidebar/SignOutPopover.tsx`
- Verify: `npm run typecheck --workspace=client`

Steps (structural task — no behavioral GWT; `[no-tdd — structural]`):
1. Create `SignOutPopover.tsx`:
   - `import { useEffect, useRef } from "react";`
   - `import { PopoverShell } from "./shared";`
   - `export function SignOutPopover({ open, onConfirm, onCancel, placement = "right" }: SignOutPopoverProps)` — copy the component + its `SignOutPopoverProps` interface verbatim from `Sidebar.tsx` lines 168–218 (incl. the autofocus `useEffect` on `cancelRef`).
2. Verify (no behavioral test — extracting a component is out-of-scope for unit tests per spec):
   `npm run typecheck --workspace=client` → exit 0. Confirm the file is self-contained (only `PopoverShell` + react imports).
3. Commit:
   `git add client/src/layout/sidebar/SignOutPopover.tsx`
   `git commit -m "refactor(sidebar): extract SignOutPopover component"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md — Story 1 Rule 1 (each component own file); Story 4 (sign-out behavior preserved — verified at T9/manual, not unit-tested here per out-of-scope).
client/src/layout/Sidebar.tsx:168-218 — verbatim source; uses PopoverShell, autofocus cancel button.

## WHY THIS APPROACH
Complexity: lightweight
Justification: single-component verbatim move, 1 file, no logic change.

## SANDWICH CONTEXT
[CRITICAL: Pure move. SignOutPopover behavior and its placement-based positioning come from PopoverShell — do not alter either.]
You are extracting SignOutPopover for the Sidebar.tsx Granular Split.
Spec: docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md
Design decision: Option A — flat sidebar/ folder, each component its own file.
Files in scope: client/src/layout/sidebar/SignOutPopover.tsx ONLY.
Test framework: N/A — component unit tests are out-of-scope (spec); verification is typecheck.
Available after: T1 (PopoverShell from shared).
Architecture rule: SignOutPopover stays INTERNAL — it must NOT appear in the future barrel (index.ts).
[RESTATE: Verbatim move; no behavior change; not exported from the barrel.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given the new file, When `npm run typecheck --workspace=client` runs, Then exit 0.
Given the file, When inspected, Then it contains only `SignOutPopover` (+ its props interface) and imports `PopoverShell` from `./shared`.
[no behavioral GWT — structural extraction; sign-out flow (Story 4) is verified by the full suite + manual smoke at T9, and component unit tests are out-of-scope per spec.]

Commit exists matching `refactor(sidebar): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Verbatim move of lines 168–218; imports `PopoverShell` from `./shared`.
  - `[no-tdd — structural]` — spec out-of-scope: "Writing unit tests for extracted components (follow-up work)". Verification = typecheck (+ full suite at T9).
  - Conventional commit format.

Must-not-have:
  - Adding `SignOutPopover` to any barrel/export aggregator (internal only).
  - Changing PopoverShell behavior/positioning (out-of-scope).
  - Writing a component unit test for SignOutPopover (out-of-scope).
  - Editing the old Sidebar.tsx or any file outside scope.

Open question risks:
  - "SignOutPopover internal-only" is an assumption (spec, low risk) → if a consumer outside sidebar/ turns out to need it, report NEEDS_CONTEXT.

Rollback note:
  - Inert until imported by T7/T8; reverts with the feature.

Red flags:
  - File needs more than PopoverShell + react imports → likely pulled extra scope, DONE_WITH_CONCERNS.

## STOP CONDITIONS
Done when: typecheck clean, file self-contained, commit created.
Uncertain when: SignOutPopover references something not yet extracted (report NEEDS_CONTEXT).
Escalate when: extraction would change behavior or require exporting it from a barrel.

---

### Task 4: Extract ModeSwitcher [depends: T1]

## OBJECTIVE
Move `ModeSwitcher` into its own file. Verbatim move from `Sidebar.tsx` lines 65–97. Keeps its existing prop names `mode` and `onSwitch` (leaf component, unchanged) — the lifted `onModeChange` prop lives on the Sidebar/MobileNav containers (T7/T8), which wire `onSwitch={onModeChange}`.

Files:
- Create: `client/src/layout/sidebar/ModeSwitcher.tsx`
- Verify: `npm run typecheck --workspace=client`

Steps (structural task — `[no-tdd — structural]`):
1. Create `ModeSwitcher.tsx`:
   - `import type { Mode } from "./shared";`
   - `interface ModeSwitcherProps { mode: Mode; onSwitch: (m: Mode) => void; }`
   - `export function ModeSwitcher({ mode, onSwitch }: ModeSwitcherProps)` — copy lines 70–97 verbatim (the two Kanban/Agent buttons with active-state classes).
2. Verify: `npm run typecheck --workspace=client` → exit 0. File imports only `Mode` from `./shared`.
3. Commit:
   `git add client/src/layout/sidebar/ModeSwitcher.tsx`
   `git commit -m "refactor(sidebar): extract ModeSwitcher component"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md — Story 1 Rule 1 Example C (ModeSwitcher → its own file); Story 2 (mode switching).
client/src/layout/Sidebar.tsx:65-97 — verbatim source; prop names `mode`, `onSwitch`.

## WHY THIS APPROACH
Complexity: lightweight
Justification: single presentational component, 1 file, verbatim move.

## SANDWICH CONTEXT
[CRITICAL: Pure move. Keep prop names `mode`/`onSwitch` unchanged — containers adapt via `onSwitch={onModeChange}`.]
You are extracting ModeSwitcher for the Sidebar.tsx Granular Split.
Spec: docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md
Design decision: Option A — flat sidebar/ folder, each component its own file.
Files in scope: client/src/layout/sidebar/ModeSwitcher.tsx ONLY.
Test framework: N/A — component unit tests out-of-scope; verification is typecheck.
Available after: T1 (Mode from shared).
Architecture rule: ModeSwitcher is presentational — no useBoard, no router, no state.
[RESTATE: Verbatim move; prop names `mode`/`onSwitch` preserved.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given the new file, When `npm run typecheck --workspace=client` runs, Then exit 0.
Given the file, When inspected, Then it exports `ModeSwitcher` with props `{ mode, onSwitch }` and imports only `Mode` from `./shared`.
[no behavioral GWT — structural extraction; component unit tests are out-of-scope per spec.]

Commit exists matching `refactor(sidebar): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Verbatim move of lines 65–97; prop names unchanged.
  - `[no-tdd — structural]` — spec out-of-scope on component tests; verification = typecheck (+ full suite at T9).
  - Conventional commit format.

Must-not-have:
  - Renaming `onSwitch` to `onModeChange` here (the rename lives on the container prop, not this leaf).
  - Adding state/useBoard/router to ModeSwitcher.
  - Editing files outside scope.

Open question risks:
  - None.

Rollback note:
  - Inert until imported by T7/T8.

Red flags:
  - ModeSwitcher gains a hook or context import → DONE_WITH_CONCERNS.

## STOP CONDITIONS
Done when: typecheck clean, file self-contained, commit created.
Uncertain when: N/A.
Escalate when: extraction would require changing prop contract or adding state.

---

### Task 5: Extract WorkspaceSwitcher (+ WorkspaceAvatar) [depends: T1]

## OBJECTIVE
Move `WorkspaceAvatar` and `WorkspaceSwitcher` into one file (design decision: avatar is too small for its own file, tightly coupled to the switcher). **Export BOTH** — `WorkspaceAvatar` must be exported because `WorkspaceModals` (T6) renders it. Verbatim move from `Sidebar.tsx` lines 224–511. Fix relative import depths for the new location.

Files:
- Create: `client/src/layout/sidebar/WorkspaceSwitcher.tsx`
- Verify: `npm run typecheck --workspace=client`

Steps (structural task — `[no-tdd — structural]`):
1. Create `WorkspaceSwitcher.tsx`:
   - Imports (note corrected depths from `sidebar/`):
     - `import { Check, ChevronDown, Plus } from "lucide-react";`
     - `import { useEffect, useRef, useState } from "react";`
     - `import { useBoard } from "../../context/BoardContext";`
     - `import { getInvitePopoverState, getSwitchAttemptState, getWorkspaceLimitActionState, workspaceInitials } from "../../lib/workspaceSwitcher";`
     - `import type { Workspace, WorkspaceInvite } from "../../types";`
     - `import { PopoverShell } from "./shared";`
   - `export function WorkspaceAvatar({ workspace, logoPath }: { workspace: Workspace; logoPath?: string })` — copy lines 224–248 verbatim, add `export`.
   - `export function WorkspaceSwitcher({ collapsed = false, placement = "right" }: WorkspaceSwitcherProps)` — copy lines 254–511 verbatim (incl. the `WorkspaceSwitcherProps` interface, the outside-click `useEffect`, invite/switch popovers).
2. Verify: `npm run typecheck --workspace=client` → exit 0. Confirm NO behavioral change and that `workspaceSwitcher.ts` / BoardContext were NOT edited.
3. Commit:
   `git add client/src/layout/sidebar/WorkspaceSwitcher.tsx`
   `git commit -m "refactor(sidebar): extract WorkspaceSwitcher and WorkspaceAvatar"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md — Story 1 Rule 1 Example A; Story 3 (workspace switching preserved — verified at T9/manual); Design Decision (WorkspaceAvatar co-locates with switcher).
client/src/layout/Sidebar.tsx:224-511 — verbatim source; consumes useBoard + lib/workspaceSwitcher pure fns + PopoverShell.

## WHY THIS APPROACH
Complexity: standard
Justification: largest leaf (~290 lines, two components, several popovers and async invite handlers). Verbatim but import-depth fixes + the cross-file `WorkspaceAvatar` export contract for T6 require care.

## SANDWICH CONTEXT
[CRITICAL: Pure move with corrected import depths (`../../lib`, `../../context`, `../../types`). Export WorkspaceAvatar — T6 depends on it. Do NOT touch workspaceSwitcher.ts or BoardContext.]
You are extracting WorkspaceSwitcher + WorkspaceAvatar for the Sidebar.tsx Granular Split.
Spec: docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md
Design decision: Option A — avatar co-located with switcher (too small for its own file).
Files in scope: client/src/layout/sidebar/WorkspaceSwitcher.tsx ONLY.
Test framework: N/A — component unit tests out-of-scope; verification is typecheck.
Available after: T1 (PopoverShell from shared).
Architecture rule: consume `lib/workspaceSwitcher` pure functions as-is; refactoring that module or BoardContext is out-of-scope. Both `WorkspaceAvatar` and `WorkspaceSwitcher` must be `export`ed.
[RESTATE: Verbatim move, fixed `../../` depths, export WorkspaceAvatar, no edits to lib/context.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given the new file, When `npm run typecheck --workspace=client` runs, Then exit 0.
Given the file, When inspected, Then it exports BOTH `WorkspaceAvatar` and `WorkspaceSwitcher`, and imports resolve via `../../lib`, `../../context`, `../../types`, `./shared`.
[no behavioral GWT — structural extraction; Story 3 workspace flows verified by full suite + manual smoke at T9; component unit tests out-of-scope per spec.]

Commit exists matching `refactor(sidebar): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Verbatim move of lines 224–511; corrected `../../` import depths.
  - `WorkspaceAvatar` exported (T6 contract).
  - `[no-tdd — structural]` — component tests out-of-scope; verification = typecheck (+ full suite at T9).
  - Conventional commit format.

Must-not-have:
  - Editing `lib/workspaceSwitcher.ts`, `lib/workspaceSelection.ts`, or BoardContext (out-of-scope).
  - Changing the switch-confirm / invite / membership-cap behavior.
  - Wrong import depth (`../lib` instead of `../../lib`).
  - Editing files outside scope.

Open question risks:
  - None new.

Rollback note:
  - Inert until imported by T6/T7/T8.

Red flags:
  - Any diff under `lib/` or `context/` → STOP.
  - `WorkspaceAvatar` left unexported → T6 will break; fix before marking done.

## STOP CONDITIONS
Done when: typecheck clean, both components exported, commit created, no lib/context edits.
Uncertain when: a workspace pure-fn signature seems to require a change (report NEEDS_CONTEXT — do not edit lib).
Escalate when: extraction would force a behavioral or lib/context change.

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
