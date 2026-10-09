# Sidebar.tsx Granular Split — Extract WorkspaceModals (+ WorkspaceOverlays) (Phase 2 of 2)

**Date:** 2026-06-26
**Original plan:** docs/pocket/plans/2026-06-26-sidebar-split/execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T6, T7, T8, T9}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

T6: Extract WorkspaceModals (+ WorkspaceOverlays) [depends: T5]
T7: Extract desktop Sidebar (default export) with lifted mode props [depends: T3, T4, T5]
T8: Extract MobileNav with lifted mode props [depends: T3, T4, T5]
T9: Barrel export + AppLayout cutover + delete old Sidebar.tsx [depends: T2, T6, T7, T8]

---

## Pocket Packets

---

### Task 6: Extract WorkspaceModals (+ WorkspaceOverlays) [depends: T5]

## OBJECTIVE
Move the workspace modal stack — `ModalBackdrop`, `BlockingInviteModal`, `WorkspacePickerModal`, `CreateWorkspaceModal`, and the public `WorkspaceOverlays` — into one file. Import `WorkspaceAvatar` from `./WorkspaceSwitcher` (T5) and `inputClass` from `./shared`. Verbatim move from `Sidebar.tsx` lines 517–791.

Files:
- Create: `client/src/layout/sidebar/WorkspaceModals.tsx`
- Verify: `npm run typecheck --workspace=client`

Steps (structural task — `[no-tdd — structural]`):
1. Create `WorkspaceModals.tsx`:
   - Imports (corrected depths):
     - `import { Plus, X } from "lucide-react";`
     - `import { type FormEvent, useEffect, useState } from "react";`
     - `import { useBoard } from "../../context/BoardContext";`
     - `import { getWorkspaceLimitActionState } from "../../lib/workspaceSwitcher";`
     - `import type { WorkspaceInvite } from "../../types";`
     - `import { inputClass } from "./shared";`
     - `import { WorkspaceAvatar } from "./WorkspaceSwitcher";`
   - Copy verbatim from `Sidebar.tsx`: `ModalBackdrop` (517–530), `BlockingInviteModal` (532–606), `WorkspacePickerModal` (608–672), `CreateWorkspaceModal` (674–764), and `export function WorkspaceOverlays()` (766–791). Keep `WorkspaceOverlays` exported (public, goes in barrel at T9); the rest stay internal to this file.
2. Verify: `npm run typecheck --workspace=client` → exit 0. Confirm `WorkspaceAvatar` import from `./WorkspaceSwitcher` resolves.
3. Commit:
   `git add client/src/layout/sidebar/WorkspaceModals.tsx`
   `git commit -m "refactor(sidebar): extract workspace modals and overlays"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md — Story 1 Rule 1 (WorkspaceModals.tsx contains the four modals + WorkspaceOverlays, per Story 1 acceptance Gherkin line 100); Story 3 (membership cap, invite flow — verified at T9/manual).
client/src/layout/Sidebar.tsx:517-791 — verbatim source; renders WorkspaceAvatar; uses inputClass; consumes useBoard + getWorkspaceLimitActionState.

## WHY THIS APPROACH
Complexity: standard
Justification: 4 modals + the public overlay aggregator (~275 lines), with a cross-file dependency on T5's `WorkspaceAvatar`. Verbatim but the import wiring and the public/internal split need care.

## SANDWICH CONTEXT
[CRITICAL: Pure move. Import WorkspaceAvatar from ./WorkspaceSwitcher (T5). WorkspaceOverlays stays the only export. Corrected `../../` depths. Do NOT touch lib/context.]
You are extracting the workspace modals + WorkspaceOverlays for the Sidebar.tsx Granular Split.
Spec: docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md
Design decision: Option A — modals grouped in WorkspaceModals.tsx (per Story 1 acceptance).
Files in scope: client/src/layout/sidebar/WorkspaceModals.tsx ONLY.
Test framework: N/A — component unit tests out-of-scope; verification is typecheck.
Available after: T5 (WorkspaceAvatar), T1 (inputClass).
Architecture rule: only `WorkspaceOverlays` is exported (public). The four modals + ModalBackdrop are internal. No edits to lib/workspaceSwitcher or BoardContext.
[RESTATE: Verbatim move; WorkspaceAvatar from ./WorkspaceSwitcher; only WorkspaceOverlays exported; no lib/context edits.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given the new file, When `npm run typecheck --workspace=client` runs, Then exit 0.
Given the file, When inspected, Then it contains ModalBackdrop + BlockingInviteModal + WorkspacePickerModal + CreateWorkspaceModal + WorkspaceOverlays; only `WorkspaceOverlays` is exported; `WorkspaceAvatar` is imported from `./WorkspaceSwitcher`.
[no behavioral GWT — structural extraction; Story 3 membership-cap/invite flows verified by full suite + manual smoke at T9; component unit tests out-of-scope per spec.]

Commit exists matching `refactor(sidebar): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Verbatim move of lines 517–791; corrected `../../` depths; WorkspaceAvatar imported from `./WorkspaceSwitcher`.
  - Only `WorkspaceOverlays` exported.
  - `[no-tdd — structural]` — component tests out-of-scope; verification = typecheck (+ full suite at T9).
  - Conventional commit format.

Must-not-have:
  - Re-declaring a local `WorkspaceAvatar` instead of importing T5's (would duplicate / drift).
  - Exporting the internal modals.
  - Editing lib/context or files outside scope.

Open question risks:
  - None new.

Rollback note:
  - WorkspaceOverlays is wired into AppLayout at T9; inert until then.

Red flags:
  - `WorkspaceAvatar` redefined locally → DONE_WITH_CONCERNS.
  - Any diff under lib/ or context/ → STOP.

## STOP CONDITIONS
Done when: typecheck clean, file structured as specified, commit created.
Uncertain when: `WorkspaceAvatar` export from T5 is missing (report NEEDS_CONTEXT — it is T5's contract).
Escalate when: extraction would force a behavioral or lib/context change.

---

### Task 7: Extract desktop Sidebar (default export) with lifted mode props [depends: T3, T4, T5]

## OBJECTIVE
Recreate the desktop `Sidebar` (default export) as its own file that consumes the extracted leaves and **receives `mode` + `onModeChange` as props** instead of owning mode state. Drop the internal `useState<Mode>` + path-sync `useEffect` (that logic now lives in `useSidebarMode`, lifted to AppLayout at T9). Move from `Sidebar.tsx` lines 797–915, minus the mode state.

Files:
- Create: `client/src/layout/sidebar/Sidebar.tsx`
- Verify: `npm run typecheck --workspace=client`

Steps (structural task — `[no-tdd — structural]`):
1. Create `sidebar/Sidebar.tsx`:
   - Imports:
     - `import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";`
     - `import { useCallback, useState } from "react";`
     - `import { NavLink } from "react-router";`
     - `import { useBoard } from "../../context/BoardContext";`
     - `import { AGENT_NAV, KANBAN_NAV, SETTINGS_ITEM } from "./navItems";`
     - `import { type Mode, navLinkClass } from "./shared";`
     - `import { ModeSwitcher } from "./ModeSwitcher";`
     - `import { SignOutPopover } from "./SignOutPopover";`
     - `import { WorkspaceSwitcher } from "./WorkspaceSwitcher";`
   - New props interface:
     ```ts
     interface SidebarProps {
       collapsed: boolean;
       onToggle: () => void;
       mode: Mode;
       onModeChange: (m: Mode) => void;
     }
     export default function Sidebar({ collapsed, onToggle, mode, onModeChange }: SidebarProps) { ... }
     ```
   - Body: copy lines 802–915 verbatim EXCEPT:
     - DELETE the `const [mode, setMode] = useState<Mode>(...)` (line 809–811) and the path-sync `useEffect` (line 814–820) and the `useLocation` import/usage — `mode` now comes from props.
     - Render `<ModeSwitcher mode={mode} onSwitch={onModeChange} />` (was `onSwitch={setMode}`).
     - Keep `showSignOutPopover` local state, `handleSignOut` useCallback, `activeNav = mode === "kanban" ? KANBAN_NAV : AGENT_NAV`, and all JSX (header, mode switcher, nav, footer, workspace switcher, settings link, sign out, collapse toggle) verbatim.
2. Verify: `npm run typecheck --workspace=client` → exit 0. Confirm no `useLocation`/mode-state remnants and no unused imports (Biome `noUnusedLocals`).
3. Commit:
   `git add client/src/layout/sidebar/Sidebar.tsx`
   `git commit -m "refactor(sidebar): extract desktop Sidebar with lifted mode props"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md — Story 1 Rule 1; Story 2 Rule 1 (Sidebar receives mode + onModeChange as props).
client/src/layout/Sidebar.tsx:797-915 — source; note mode state at 809–820 is REMOVED (lifted to AppLayout).

## WHY THIS APPROACH
Complexity: standard
Justification: verbatim layout move PLUS a deliberate behavioral subtraction (removing local mode state, switching to props). The subtraction is the error-prone part; promote to standard.

## SANDWICH CONTEXT
[CRITICAL: Remove the local mode useState + path-sync useEffect — Sidebar must be a controlled component driven by `mode`/`onModeChange` props. Leaving the local state in causes a double source of truth and breaks Story 2 sync.]
You are extracting the desktop Sidebar for the Sidebar.tsx Granular Split.
Spec: docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md
Design decision: Option A — mode lifted to AppLayout; Sidebar consumes it via props.
Files in scope: client/src/layout/sidebar/Sidebar.tsx ONLY.
Test framework: N/A — component unit tests out-of-scope; verification is typecheck.
Available after: T3 (SignOutPopover), T4 (ModeSwitcher), T5 (WorkspaceSwitcher), T1 (navItems/shared).
Architecture rule: default export named Sidebar; controlled mode via props; `noUnusedLocals` — drop the now-unused `useLocation`, `useEffect`, `getModeFromPath` imports.
[RESTATE: Sidebar is controlled — no local mode state; `<ModeSwitcher onSwitch={onModeChange}/>`.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given the new file, When `npm run typecheck --workspace=client` runs, Then exit 0.
Given the file, When inspected, Then `Sidebar` is the default export, takes `{ collapsed, onToggle, mode, onModeChange }`, has NO local mode state/useLocation/useEffect-for-mode, and renders `<ModeSwitcher mode={mode} onSwitch={onModeChange} />`.
[no behavioral GWT — structural extraction; Story 4/5 desktop flows verified by full suite + manual smoke at T9; component unit tests out-of-scope per spec.]

Commit exists matching `refactor(sidebar): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Default export `Sidebar` with the 4-prop interface; controlled mode.
  - All JSX (header/mode-switcher/nav/footer/sign-out/collapse) moved verbatim.
  - `[no-tdd — structural]` — component tests out-of-scope; verification = typecheck (+ full suite at T9).
  - No unused imports (Biome).
  - Conventional commit format.

Must-not-have:
  - Retaining the local `useState<Mode>` / path-sync `useEffect` / `useLocation` in Sidebar.
  - Changing any JSX/styling/behavior beyond the mode-state removal.
  - Importing SignOutPopover from anywhere but `./SignOutPopover`.
  - Editing files outside scope.

Open question risks:
  - None new.

Rollback note:
  - Wired by AppLayout at T9; inert until then.

Red flags:
  - `useLocation` still imported → unused-import failure and stale logic, DONE_WITH_CONCERNS.

## STOP CONDITIONS
Done when: typecheck clean, controlled-mode prop contract in place, commit created.
Uncertain when: removing mode state surfaces a reference that still needs `mode` locally (report NEEDS_CONTEXT).
Escalate when: extraction would require changing JSX behavior beyond the mode lift.

---

### Task 8: Extract MobileNav with lifted mode props [depends: T3, T4, T5]

## OBJECTIVE
Recreate `MobileNav` as its own file, consuming the extracted leaves and **receiving `mode` + `onModeChange` as props** instead of owning mode state. Drop the internal `useState<Mode>` + path-sync `useEffect`. Move from `Sidebar.tsx` lines 921–1034, minus the mode state.

Files:
- Create: `client/src/layout/sidebar/MobileNav.tsx`
- Verify: `npm run typecheck --workspace=client`

Steps (structural task — `[no-tdd — structural]`):
1. Create `MobileNav.tsx`:
   - Imports:
     - `import { LogOut, X } from "lucide-react";`
     - `import { useCallback, useState } from "react";`
     - `import { NavLink } from "react-router";`
     - `import { useBoard } from "../../context/BoardContext";`
     - `import { AGENT_NAV, KANBAN_NAV, SETTINGS_ITEM } from "./navItems";`
     - `import { type Mode, navLinkClass } from "./shared";`
     - `import { ModeSwitcher } from "./ModeSwitcher";`
     - `import { SignOutPopover } from "./SignOutPopover";`
     - `import { WorkspaceSwitcher } from "./WorkspaceSwitcher";`
   - New props interface:
     ```ts
     interface MobileNavProps {
       open: boolean;
       onClose: () => void;
       mode: Mode;
       onModeChange: (m: Mode) => void;
     }
     export function MobileNav({ open, onClose, mode, onModeChange }: MobileNavProps) { ... }
     ```
   - Body: copy lines 927–1034 verbatim EXCEPT:
     - DELETE the `const [mode, setMode] = useState<Mode>(...)` (929–932), the path-sync `useEffect` (934–938), and the `useLocation` import/usage.
     - Render `<ModeSwitcher mode={mode} onSwitch={onModeChange} />` (was `onSwitch={setMode}`).
     - Keep `showSignOutPopover` local state, `handleSignOut` (which calls `onClose()` then `logout()`), `activeNav`, the backdrop `onClick={showSignOutPopover ? undefined : onClose}`, and all drawer JSX verbatim.
2. Verify: `npm run typecheck --workspace=client` → exit 0. No `useLocation`/mode-state remnants; no unused imports.
3. Commit:
   `git add client/src/layout/sidebar/MobileNav.tsx`
   `git commit -m "refactor(sidebar): extract MobileNav with lifted mode props"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md — Story 1 Rule 1 Example B; Story 2 Rule 1 (MobileNav receives mode + onModeChange); Story 5 (mobile drawer preserved).
client/src/layout/Sidebar.tsx:921-1034 — source; mode state at 929–938 REMOVED (lifted).

## WHY THIS APPROACH
Complexity: standard
Justification: verbatim drawer move plus the same deliberate mode-state subtraction as T7; the `handleSignOut` ordering (`onClose` before `logout`) and the backdrop guard must be preserved exactly.

## SANDWICH CONTEXT
[CRITICAL: Remove local mode useState + path-sync useEffect — MobileNav is controlled via `mode`/`onModeChange` props. Preserve `handleSignOut` order (onClose → logout) and the backdrop `onClick={showSignOutPopover ? undefined : onClose}` guard.]
You are extracting MobileNav for the Sidebar.tsx Granular Split.
Spec: docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md
Design decision: Option A — mode lifted to AppLayout; MobileNav consumes it via props.
Files in scope: client/src/layout/sidebar/MobileNav.tsx ONLY.
Test framework: N/A — component unit tests out-of-scope; verification is typecheck.
Available after: T3 (SignOutPopover), T4 (ModeSwitcher), T5 (WorkspaceSwitcher), T1 (navItems/shared).
Architecture rule: named export MobileNav; controlled mode via props; `noUnusedLocals` — drop unused `useLocation`/`useEffect`/`getModeFromPath`.
[RESTATE: Controlled mode via props; preserve sign-out order and backdrop guard.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given the new file, When `npm run typecheck --workspace=client` runs, Then exit 0.
Given the file, When inspected, Then `MobileNav` is a named export taking `{ open, onClose, mode, onModeChange }`, has NO local mode state/useLocation, renders `<ModeSwitcher mode={mode} onSwitch={onModeChange} />`, and preserves `handleSignOut` (onClose→logout) + backdrop guard.
[no behavioral GWT — structural extraction; Story 5/6 mobile + Escape-scoping flows verified by full suite + manual smoke at T9; component unit tests out-of-scope per spec.]

Commit exists matching `refactor(sidebar): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Named export `MobileNav` with 4-prop interface; controlled mode.
  - Drawer JSX, `handleSignOut` order, and backdrop guard moved verbatim.
  - `[no-tdd — structural]` — component tests out-of-scope; verification = typecheck (+ full suite at T9).
  - No unused imports.
  - Conventional commit format.

Must-not-have:
  - Retaining local mode state / useLocation.
  - Changing sign-out order (onClose must precede logout) or backdrop guard.
  - Editing files outside scope.

Open question risks:
  - None new.

Rollback note:
  - Wired by AppLayout at T9; inert until then.

Red flags:
  - Backdrop guard or sign-out order altered → behavior regression, STOP.

## STOP CONDITIONS
Done when: typecheck clean, controlled-mode contract + preserved drawer behavior, commit created.
Uncertain when: removing mode state surfaces a local `mode` reference (report NEEDS_CONTEXT).
Escalate when: extraction would change drawer behavior beyond the mode lift.

---

### Task 9: Barrel export + AppLayout cutover + delete old Sidebar.tsx [depends: T2, T6, T7, T8]

## OBJECTIVE
Atomic cutover in ONE commit: create the `sidebar/index.ts` barrel, rewire `AppLayout.tsx` to import from `"./sidebar"` and lift mode via `useSidebarMode` (passing `mode`/`onModeChange` to both Sidebar and MobileNav), and DELETE the old `client/src/layout/Sidebar.tsx`. Then prove zero regression: full client typecheck + full client test suite green.

Files:
- Create: `client/src/layout/sidebar/index.ts`
- Modify: `client/src/layout/AppLayout.tsx`
- Delete: `client/src/layout/Sidebar.tsx`
- Verify: `npm run typecheck --workspace=client` AND `npm run test --workspace=client`

Steps:
1. Create `sidebar/index.ts` (barrel — preserves public API, Story 1 Rule 2):
   ```ts
   export { default } from "./Sidebar";
   export { MobileNav } from "./MobileNav";
   export { NAV_ITEMS } from "./navItems";
   export { WorkspaceOverlays } from "./WorkspaceModals";
   ```
   Do NOT export `SignOutPopover` (acceptance: internal only).
2. Edit `AppLayout.tsx`:
   - Change import (line 8) from `import Sidebar, { MobileNav, NAV_ITEMS, WorkspaceOverlays } from "./Sidebar";` to `... from "./sidebar";`.
   - Add `import { useSidebarMode } from "./sidebar/useSidebarMode";` (not in barrel by design).
   - Inside the component, add `const [mode, setMode] = useSidebarMode();`.
   - Pass props: `<Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} mode={mode} onModeChange={setMode} />` and `<MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} mode={mode} onModeChange={setMode} />`.
   - Leave everything else (NAV_ITEMS pageTitle logic, WorkspaceOverlays, title/favicon effect, `onSettings`) unchanged.
3. Delete the old file: `git rm client/src/layout/Sidebar.tsx`.
   (On case-insensitive macOS, the old `Sidebar.tsx` MUST be gone before typecheck, else `tsc` may throw "File name differs only in casing" against `sidebar/` — the delete is the fix.)
4. Verify zero regression:
   - `npm run typecheck --workspace=client` → exit 0 (confirms the old file is gone and all imports resolve to the barrel).
   - `npm run test --workspace=client` → full suite green (App.test.tsx, lib/workspaceSwitcher.test.ts, lib/workspaceSelection.test.ts, the new navItems + useSidebarMode tests, etc. — all pass, proving no consumer broke).
5. Commit (single atomic cutover):
   `git add client/src/layout/sidebar/index.ts client/src/layout/AppLayout.tsx`
   (the `git rm` is already staged)
   `git commit -m "refactor(sidebar): cut over to sidebar/ barrel and lift mode to AppLayout"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md — Story 1 Rule 2 (barrel preserves public API; SignOutPopover NOT exported); Story 2 Rule 1 (mode lifted to AppLayout, passed to both); In-Scope (update AppLayout import); Rollback Plan.
client/src/layout/AppLayout.tsx:8,52-53 — current import + render sites to rewire.
client/src/layout/Sidebar.tsx — file being deleted (now fully superseded by sidebar/).

## WHY THIS APPROACH
Complexity: standard
Justification: 3-file atomic change that is the integration linchpin; correctness depends on the barrel shape, the AppLayout prop wiring, the useSidebarMode lift, AND the delete happening together so the project compiles and the suite passes in one commit.

## SANDWICH CONTEXT
[CRITICAL: ONE atomic commit — create barrel + rewire AppLayout + delete old Sidebar.tsx together. A partial cutover leaves the project uncompilable or causes the case-insensitive `./sidebar` vs `Sidebar.tsx` resolution collision.]
You are performing the cutover for the Sidebar.tsx Granular Split.
Spec: docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md
Design decision: Option A — barrel export from sidebar/index.ts; mode lifted to AppLayout via useSidebarMode.
Files in scope: client/src/layout/sidebar/index.ts, client/src/layout/AppLayout.tsx, and deletion of client/src/layout/Sidebar.tsx — NO others.
Test framework: Vitest + jsdom; run `npm run test --workspace=client` for the full suite.
Available after: T2 (useSidebarMode), T6 (WorkspaceOverlays), T7 (Sidebar default), T8 (MobileNav).
Architecture rule: barrel exports default Sidebar, MobileNav, NAV_ITEMS, WorkspaceOverlays ONLY; SignOutPopover stays internal. useSidebarMode imported directly (not via barrel). Old Sidebar.tsx must be deleted.
[RESTATE: One atomic commit; delete old Sidebar.tsx before typecheck; SignOutPopover not in barrel.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given AppLayout imports `{ Sidebar(default), MobileNav, NAV_ITEMS, WorkspaceOverlays }` from `"./sidebar"`, When the project builds, Then `npm run typecheck --workspace=client` exits 0.
Given the barrel, When inspected, Then it exports default(Sidebar), MobileNav, NAV_ITEMS, WorkspaceOverlays and does NOT export SignOutPopover.
Given the old `client/src/layout/Sidebar.tsx`, When the cutover completes, Then it no longer exists.
Given mode is lifted, When AppLayout renders, Then both `<Sidebar>` and `<MobileNav>` receive the same `mode` + `onModeChange` from `useSidebarMode()`.
Given the full suite, When `npm run test --workspace=client` runs, Then all tests pass (zero regression; existing lib tests + App.test unaffected).

All tests PASS. Single commit exists matching `refactor(sidebar): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Barrel exactly: default(Sidebar), MobileNav, NAV_ITEMS, WorkspaceOverlays.
  - AppLayout: import from `"./sidebar"`, `useSidebarMode` lift, props passed to both views.
  - Old `Sidebar.tsx` deleted in the SAME commit.
  - Full `npm run test --workspace=client` green.
  - Conventional commit format.

Must-not-have:
  - `SignOutPopover` in the barrel (acceptance: internal only).
  - Leaving the old `Sidebar.tsx` in place (casing collision + dead duplicate).
  - Splitting the cutover across multiple commits.
  - Changing AppLayout's title/favicon/pageTitle logic.
  - Editing files outside scope.

Open question risks:
  - SignOutPopover internal-only (spec assumption, low risk) → if a consumer outside sidebar/ needs it, report NEEDS_CONTEXT before adding to barrel.

Rollback note:
  - Per spec Rollback Plan: `git revert` this cutover commit restores `"./Sidebar"` and the monolith. No DB/external state involved.

Red flags:
  - typecheck error "File name differs only in casing" → old Sidebar.tsx not deleted; delete it.
  - Any existing test fails → a consumer or behavior regressed; do NOT mark done — investigate (likely a prop/behavior drift in T7/T8).

## STOP CONDITIONS
Done when: typecheck + full client test suite green, old file deleted, single atomic commit created.
Uncertain when: a previously-passing test fails post-cutover (report NEEDS_CONTEXT with the failing test + diff).
Escalate when: making the suite pass would require adding SignOutPopover to the barrel or changing component behavior (out-of-scope) — STOP and surface.

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
