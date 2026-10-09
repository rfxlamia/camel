# Sidebar.tsx Granular Split

**Date:** 2026-06-26
**Status:** draft
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-06-26-sidebar-split/sidebar-granular-split.md

---

## Summary

Refactor `client/src/layout/Sidebar.tsx` (1032 lines, 10 useState, 7 useEffect) into a granular `sidebar/` folder structure. The monolithic component mixes three concerns — navigation, workspace management, and sign-out — making it hard to change safely. This split extracts each component into its own file, synchronizes mode state between desktop and mobile views, and preserves all existing behavior with zero regression.

---

## Context

### Current State
- `client/src/layout/Sidebar.tsx` — 1032 lines, single file containing 10+ components
- Exports: `Sidebar` (default), `MobileNav`, `NAV_ITEMS`, `WorkspaceOverlays`, `SignOutPopover`
- Consumer: Only `AppLayout.tsx` imports from this file
- Existing helpers: `lib/workspaceSwitcher.ts` and `lib/workspaceSelection.ts` already extract pure functions
- Pattern precedent: `components/agent/` uses folder-per-feature (AgentBoardHeader, AgentBoardVisual, etc.)
- No integration/E2E tests; only unit tests for pure functions in `lib/`

### Problem / Motivation
- 10 `useState` and 7 `useEffect` in one component
- Workspace switching, navigation, and presence concerns are interleaved
- Hard to change safely — modifying one concern risks breaking another
- PR conflicts likely when multiple developers touch different concerns

### Related Areas
- `client/src/layout/AppLayout.tsx` — imports from Sidebar, will need import path update
- `client/src/lib/workspaceSwitcher.ts` — pure functions used by WorkspaceSwitcher
- `client/src/lib/workspaceSelection.ts` — workspace selection logic
- `client/src/context/BoardContext.tsx` — provides workspace state via useBoard()

---

## Scope

### In-Scope
- Extract each component to its own file in `sidebar/` folder
- Sync mode state (kanban/agent) between MobileNav and Sidebar via lifted state in AppLayout
- Create barrel export (`sidebar/index.ts`) preserving public API
- Update `AppLayout.tsx` import path from `"./Sidebar"` to `"./sidebar"`
- Preserve all existing behavior with zero regression

### Out-of-Scope
- Changing behavior or UI — pure structural refactor only
- Adding new features
- Refactoring BoardContext or workspaceSwitcher.ts
- Writing unit tests for extracted components (follow-up work)
- Changing PopoverShell behavior or positioning logic

---

## Architecture Constraints

- **Layers this work may touch:** `client/src/layout/` and new `client/src/layout/sidebar/` subfolder
- **Layers this work must NOT touch:** `server/`, `lib/`, `context/`, `pages/`, `components/`
- **Patterns that must be followed:**
  - Barrel export from `sidebar/index.ts`
  - Flat folder structure (consistent with `components/agent/`)
  - Each component in its own file
- **Architecture validation result:** PASS

---

## Stories + Scenarios

### Story 1: Structural Decomposition
> As a developer, I want Sidebar.tsx split into granular files, so that I can work on different sidebar concerns without merge conflicts.

**Rule 1: Each component lives in its own file**
- Example A: `WorkspaceSwitcher` → `sidebar/WorkspaceSwitcher.tsx`
- Example B: `MobileNav` → `sidebar/MobileNav.tsx`
- Example C: `ModeSwitcher` → `sidebar/ModeSwitcher.tsx`

**Rule 2: Barrel export preserves public API**
- Example A: `AppLayout.tsx` imports `{ Sidebar, MobileNav, NAV_ITEMS, WorkspaceOverlays }` from `"./sidebar"` — same names as before
- Example B: `SignOutPopover` remains internal (not in barrel export)

**Rule 3: Shared primitives extracted to common files**
- Example A: `PopoverShell`, `navLinkClass`, `inputClass`, `Mode` type → `sidebar/shared.ts`
- Example B: `NAV_ITEMS`, `KANBAN_NAV`, `AGENT_NAV`, `getModeFromPath` → `sidebar/navItems.ts`

```gherkin
Scenario: AppLayout imports unchanged after refactor
  Given AppLayout.tsx imports { Sidebar, MobileNav, NAV_ITEMS, WorkspaceOverlays } from "./Sidebar"
  When  Sidebar.tsx is split into sidebar/ folder with barrel export
  Then  AppLayout.tsx imports should change to "./sidebar" with same named exports
  And   TypeScript compilation passes without errors

Scenario: Each component has single responsibility
  Given sidebar/ folder structure
  When  examining each file in sidebar/
  Then  WorkspaceSwitcher.tsx contains only WorkspaceSwitcher + WorkspaceAvatar
  And   MobileNav.tsx contains only MobileNav component
  And   WorkspaceModals.tsx contains BlockingInviteModal + WorkspacePickerModal + CreateWorkspaceModal + WorkspaceOverlays
```

---

### Story 2: Mode State Synchronization
> As a user, I want my mode selection (kanban/agent) to persist when I switch between mobile and desktop views, so that I don't lose my context.

**Rule 1: Mode state lifted to AppLayout**
- Example A: `mode` and `setMode` state in AppLayout component
- Example B: Both `Sidebar` and `MobileNav` receive `mode` and `onModeChange` as props
- Example C: `useSidebarMode()` helper hook encapsulates the `getModeFromPath` + `useEffect` logic

**Rule 2: Mode changes propagate immediately**
- Example A: User switches to "Agent" on mobile → closes drawer → desktop sidebar shows "Agent" tab active
- Example B: User navigates to `/agent` directly → both mobile and desktop show "Agent" mode

**Rule 3: Settings route behavior preserved**
- Example A: Navigating TO `/settings` does not change mode
- Example B: Navigating FROM `/settings` to `/board` updates mode to "kanban" (URL-driven)

```gherkin
Scenario: Mode syncs between mobile and desktop
  Given user is on mobile viewing "kanban" mode
  When  user switches to "agent" mode via ModeSwitcher in MobileNav
  And   user resizes browser to desktop breakpoint
  Then  desktop Sidebar should show "agent" mode active
  And   navigation items should show Agent nav (Agent, History)

Scenario: Mode syncs via URL navigation
  Given user is on /board (kanban mode)
  When  user navigates directly to /agent via URL
  Then  both Sidebar and MobileNav should show "agent" mode
  And   ModeSwitcher highlights "Agent" button

Scenario: Settings route does not override mode
  Given user is in "agent" mode
  When  user navigates to /settings
  Then  mode stays "agent" (not reset to kanban)

Scenario: Leaving settings updates mode to match URL
  Given user is on /settings with mode="agent"
  When  user navigates to /board
  Then  mode updates to "kanban"
```

---

### Story 3: Zero Regression — Workspace Switching Flow
> As a user, I want workspace switching to work exactly as before, with no behavior changes.

**Rule 1: Workspace dropdown opens/closes correctly**
- Example A: Click workspace name → dropdown appears above
- Example B: Click outside → dropdown closes
- Example C: Press Escape → dropdown closes

**Rule 2: Switch confirmation flow preserved**
- Example A: User has unsaved edits → click different workspace → confirm popover appears
- Example B: User clicks "Switch" → workspace changes, popover closes
- Example C: User clicks "Cancel" → stays in current workspace

**Rule 3: Invite flow preserved**
- Example A: Pending invite → invite popover shows when switcher closed
- Example B: Accept invite → workspace added, popover closes
- Example C: Decline invite → invite removed from list
- Example D: At membership cap → accept/create buttons disabled with message

```gherkin
Scenario: Workspace switch with unsaved edits shows confirmation
  Given user has unsaved card edits in workspace "Team A"
  When  user opens workspace dropdown and clicks "Team B"
  Then  confirm popover appears with "Switch workspace?" message
  And   message says "You have unsaved card edits. They will be discarded."

Scenario: Workspace switch confirmation proceeds
  Given confirm popover is visible for workspace switch
  When  user clicks "Switch"
  Then  workspace switches to target
  And   dropdown closes
  And   confirm popover closes

Scenario: Workspace switch cancelled
  Given confirm popover is visible for workspace switch
  When  user clicks "Cancel"
  Then  stays in current workspace
  And   confirm popover closes

Scenario: Membership cap blocks workspace creation
  Given user has 10 workspace memberships
  When  user opens workspace dropdown
  Then  "Create workspace" button is disabled
  And   tooltip shows "You've reached the workspace limit (10)."
```

---

### Story 4: Zero Regression — Sign Out Flow
> As a user, I want sign out to work exactly as before.

**Rule 1: Sign out popover positioning**
- Example A: Desktop sidebar — popover appears to the right of button (placement="right")
- Example B: Mobile nav — popover appears above button (placement="top")

**Rule 2: Sign out flow preserved**
- Example A: Click sign out → popover appears
- Example B: Click "Sign out" in popover → user logged out, popover closes
- Example C: Click "Cancel" or press Escape → popover closes, stays logged in

```gherkin
Scenario: Sign out from desktop sidebar
  Given user is on desktop with sidebar visible
  When  user clicks "Sign out" button in sidebar footer
  Then  SignOutPopover appears to the right of the button
  And   popover shows "Sign out?" with Cancel and Sign out buttons

Scenario: Sign out confirmation
  Given SignOutPopover is visible
  When  user clicks "Sign out" button in popover
  Then  user is logged out
  And   popover closes

Scenario: Sign out cancelled via Escape
  Given SignOutPopover is visible
  When  user presses Escape key
  Then  popover closes
  And   user remains logged in
```

---

### Story 5: Zero Regression — Mobile Navigation
> As a mobile user, I want the mobile drawer to work exactly as before.

**Rule 1: Drawer open/close**
- Example A: Click hamburger menu → drawer slides in from left
- Example B: Click backdrop → drawer closes
- Example C: Click X button → drawer closes

**Rule 2: Navigation in mobile drawer**
- Example A: Click nav item → navigates and closes drawer
- Example B: Mode switcher works with lifted state

```gherkin
Scenario: Mobile drawer opens and closes
  Given user is on mobile viewport
  When  user clicks hamburger menu button
  Then  MobileNav drawer appears from left side
  And   backdrop overlay is visible

Scenario: Mobile drawer closes on nav item click
  Given MobileNav drawer is open
  When  user clicks "Board" nav item
  Then  drawer closes
  And   navigates to /board

Scenario: Mobile drawer closes on backdrop click
  Given MobileNav drawer is open
  When  user clicks the backdrop overlay
  Then  drawer closes
```

---

### Story 6: PopoverShell Extraction Preserves Behavior
> As a developer, I want PopoverShell to work identically after extraction.

**Rule 1: Escape key closes popover**
- Example A: Popover open → press Escape → closes via onCancel callback
- Example B: SignOutPopover in MobileNav → Escape closes popover but not drawer

**Rule 2: Placement positioning preserved**
- Example A: `placement="right"` → popover appears to the right with left-pointing arrow
- Example B: `placement="top"` → popover appears above with bottom-pointing arrow

```gherkin
Scenario: PopoverShell closes on Escape
  Given a PopoverShell is open with placement="right"
  When  user presses Escape key
  Then  popover closes via onCancel callback

Scenario: PopoverShell arrow positioning
  Given PopoverShell with placement="top"
  When  rendered
  Then  popover appears above the trigger element
  And   arrow points downward

Scenario: Escape closes popover but not drawer
  Given MobileNav drawer is open with SignOutPopover visible
  When  user presses Escape
  Then  SignOutPopover closes
  And   MobileNav drawer remains open
```

---

## Acceptance Criteria

```
Rule: Structural decomposition
  ✓ Given sidebar/ folder exists, When examining files, Then each component is in its own file
  ✓ Given AppLayout.tsx, When importing from "./sidebar", Then same named exports work
  ✓ Given sidebar/index.ts, When importing, Then exports: Sidebar (default), MobileNav, NAV_ITEMS, WorkspaceOverlays
  ✗ Given sidebar/index.ts, When importing, Then SignOutPopover is NOT exported (internal only)

Rule: Mode state synchronization
  ✓ Given user on mobile switches to "agent", When resizing to desktop, Then desktop shows "agent"
  ✓ Given user navigates to /agent, When both Sidebar and MobileNav render, Then both show "agent"
  ✓ Given user on /settings, When navigating to /board, Then mode updates to "kanban"
  ✗ Given user on /settings, When mode was "agent", Then mode does NOT reset to "kanban"

Rule: Workspace switching preserved
  ✓ Given unsaved edits, When switching workspace, Then confirm popover appears
  ✓ Given confirm popover, When clicking "Switch", Then workspace changes
  ✓ Given confirm popover, When clicking "Cancel", Then stays in current workspace
  ✓ Given 10 memberships, When opening dropdown, Then create button disabled with message

Rule: Sign out preserved
  ✓ Given desktop sidebar, When clicking sign out, Then popover appears to the right
  ✓ Given mobile nav, When clicking sign out, Then popover appears above
  ✓ Given popover visible, When clicking "Sign out", Then user logged out
  ✓ Given popover visible, When pressing Escape, Then popover closes

Rule: Mobile navigation preserved
  ✓ Given mobile viewport, When clicking hamburger, Then drawer opens from left
  ✓ Given drawer open, When clicking nav item, Then navigates and drawer closes
  ✓ Given drawer open, When clicking backdrop, Then drawer closes

Rule: PopoverShell behavior preserved
  ✓ Given popover open, When pressing Escape, Then closes via onCancel
  ✓ Given placement="right", When rendered, Then appears to the right with arrow
  ✓ Given MobileNav + SignOutPopover, When pressing Escape, Then only popover closes
```

---

## Design Decision

**Chosen option:** Option A — Flat sidebar/ folder

**Summary:** Extract all components into a flat `sidebar/` folder with barrel export. Mode state lifted to AppLayout as prop. Each component in its own file, shared primitives in `shared.ts` and `navItems.ts`.

**Rejected options:**
- Option B (Nested sidebar/workspace/ subfolder): Rejected because over-engineered for current scope, inconsistent with `components/agent/` pattern, and WorkspaceAvatar too small to justify separate file

**Key tradeoffs accepted:**
- WorkspaceSwitcher.tsx will still be ~300 lines (includes WorkspaceAvatar) — acceptable because they're tightly coupled
- Mode state lifted to AppLayout adds responsibility there — acceptable because AppLayout already manages sidebar state

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| SignOutPopover export | Assumed: internal only, not in barrel | Low — can add to barrel later if needed |
| Mode sync mechanism | Resolved: lift state to AppLayout | Low — standard React pattern |
| Settings route behavior | Resolved: mode follows URL when leaving | Low — matches current behavior |

---

## Implementation Notes

- `useSidebarMode()` helper hook should encapsulate `getModeFromPath` + `useEffect` logic to avoid duplication
- AppLayout will need new `mode` state + `setMode` callback, passed to both Sidebar and MobileNav
- Import paths in extracted files must use `../lib/workspaceSwitcher` (relative to sidebar/)
- Biome linting enforces `noUnusedLocals` — each file must export exactly what's consumed
- Existing unit tests in `lib/workspaceSwitcher.test.ts` and `lib/workspaceSelection.test.ts` should still pass (no changes to those modules)

---

## Rollback Plan

- `git revert` the commit that performs the split
- All imports revert to `"./Sidebar"` path
- No database migrations or external state changes — pure code refactor
