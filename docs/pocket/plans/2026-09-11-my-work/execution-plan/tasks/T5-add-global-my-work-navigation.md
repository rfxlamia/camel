# Task T5 — Add global My Work navigation

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: Add global My Work navigation [depends: T1]

## OBJECTIVE

Expose My Work as a global authenticated navigation item above workspace/mode-specific navigation on desktop and mobile, with correct active state and existing sidebar collapse behavior.

Files:

- Modify: `client/src/layout/sidebar/navItems.ts`
- Modify: `client/src/layout/sidebar/Sidebar.tsx`
- Modify: `client/src/layout/sidebar/MobileNav.tsx`
- Create: `client/src/layout/sidebar/myWorkNavigation.test.tsx`

Steps:

1. Write failing test for: expanded desktop global navigation.
   Test file: `client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Level: component
   Test intent: Given expanded desktop routes /my-work, /board, /tracker, when navigation renders, then global My Work link and active state are correct.
   Exercise through: Sidebar with MemoryRouter.
   Test doubles: fake contexts/history; do not mock Sidebar.
   Expected RED: global link does not exist.

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Add global nav definition/rendering.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: collapsed desktop accessible navigation.
   Test file: `client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Level: component
   Test intent: Given collapsed sidebar, when My Work renders/clicks, then accessible title/label and route navigation remain correct.
   Exercise through: collapsed Sidebar.
   Test doubles: fake contexts/history; do not mock link behavior.
   Expected RED: collapsed behavior is absent.

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Preserve collapsed global item accessibility.

8. Run test — verify PASS:
   `npm run test --workspace=client -- src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: mobile navigation placement/close.
   Test file: `client/src/layout/sidebar/myWorkNavigation.test.tsx`
   Level: component
   Test intent: Given mobile nav open, when My Work is clicked, then it is outside mode lists, navigates, and closes menu.
   Exercise through: MobileNav.
   Test doubles: fake context/history; do not mock MobileNav.
   Expected RED: mobile behavior is absent.

10. Run test — verify FAIL:
   `npm run test --workspace=client -- src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Add mobile global item and close behavior.

12. Run test — verify PASS:
   `npm run test --workspace=client -- src/layout/sidebar/myWorkNavigation.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

14. Commit:
   git add client/src/layout/sidebar/navItems.ts client/src/layout/sidebar/Sidebar.tsx client/src/layout/sidebar/MobileNav.tsx client/src/layout/sidebar/myWorkNavigation.test.tsx
    git commit -m "feat(my-work): add global navigation entry"

## REFERENCES LOADED

- Spec navigation and mobile criteria.
- `client/src/layout/sidebar/navItems.ts` — current mode grouping.
- `client/src/layout/sidebar/Sidebar.tsx` and `MobileNav.tsx` — desktop/mobile placement and accessibility classes.
- React Router docs for route link behavior.
- Lucide React docs for tree-shakable icon usage and accessible button/link props.

## WHY THIS APPROACH

Complexity: lightweight
Justification: Navigation is isolated from page data and can be verified independently before the route component exists.

## SANDWICH CONTEXT

[CRITICAL: My Work must remain a global navigation item and must not be placed inside the active-workspace switcher or mode-specific lists.]
You are implementing authenticated navigation for My Work.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: global item above Kanban/Agent mode navigation.
Files in scope: `navItems.ts`, `Sidebar.tsx`, `MobileNav.tsx`, and the navigation test.
Available after: T1.
Architecture rule: preserve existing responsive/collapsed/focus behavior and route-driven active states.
[RESTATE: My Work must remain a global navigation item and must not be placed inside the active-workspace switcher or mode-specific lists.]

## DELIVERABLE

Given the authenticated sidebar/mobile navigation, when the user is on `/my-work`, then My Work is visible and active without changing mode state.
Given collapsed desktop or mobile navigation, when My Work is rendered/clicked, then accessible labels and close behavior remain correct.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Desktop expanded/collapsed and mobile tests pass.
- Global nav does not alter existing Board/Tracker/Agent grouping.
- Focus-visible labels and route active state remain accessible.

Must-not-have:

- No workspace switcher behavior changes.
- No page/API/data loading in navigation components.

Open question risks:

- Exact icon choice may be finalized during implementation using existing Lucide conventions; it must not change route behavior.

Rollback note:

- Remove the global item; existing navigation remains.

## STOP CONDITIONS

Done when: navigation tests pass for desktop, collapsed, mobile, and active route states.
Uncertain when: existing mode grouping cannot accommodate a global section without changing AppLayout contracts.
Escalate when: adding the item requires changing workspace selection state.
