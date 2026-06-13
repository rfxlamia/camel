# Multi-Workspace MVP — Workspace picker, switcher, invites, and create flow UI (Phase 3 of 3)

**Date:** 2026-06-13
**Original plan:** docs/pocket/plans/2026-06-13-multi-workspace/execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T7, T8, T9}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T7: Workspace picker, switcher, invites, and create flow UI [depends: T6]
T8: Workspace-scoped settings, permissions, and delete replacement [depends: T6]
T9: End-to-end integration validation and legacy route cleanup [depends: T7, T8]

---

## Pocket Packets

---

### Task 7: Workspace picker, switcher, invites, and create flow UI [depends: T6]

## OBJECTIVE

Replace sidebar header with a creative-brief-aligned workspace switcher across desktop/mobile, add picker modal, invite modal/popover, unsaved switch confirmation, and create workspace flow.

Files:
- Modify: `client/src/layout/Sidebar.tsx`
- Modify: `client/src/components/AuthPage.tsx`
- Modify: `client/src/context/BoardContext.tsx`
- Modify: `client/src/api.ts`
- Modify: `client/src/types.ts`
- Test: `client/src/lib/workspaceSwitcher.test.ts`
- Test: `client/src/api.test.ts`

Steps:
1. Write failing test for: switcher and invite UI state reducers/helpers.
   File: `client/src/lib/workspaceSwitcher.test.ts`
   Test verifies: Given unsaved card edits, When switch attempted, Then confirm dialog state is required; Given Remind me later was chosen, When switcher opens, Then invite popover state appears; Given 10 memberships, When Accept or create is attempted, Then action is disabled with cap message.
   Test code:
   ```ts
   import { describe, expect, it } from "vitest";
   import {
     CAP_MESSAGE,
     getInvitePopoverState,
     getSwitchAttemptState,
     getWorkspaceLimitActionState,
   } from "./workspaceSwitcher";

   describe("workspace switcher state", () => {
     it("requires confirmation before switching with unsaved edits", () => {
       expect(getSwitchAttemptState({
         activeWorkspaceId: 1,
         targetWorkspaceId: 2,
         hasUnsavedCardEdits: true,
       })).toEqual({
         status: "confirm-required",
         pendingWorkspaceId: 2,
       });
     });

     it("shows invite popover after remind me later when switcher opens", () => {
       expect(getInvitePopoverState({
         switcherOpen: true,
         remindedInviteIds: [5],
         pendingInvites: [{ id: 5, workspaceName: "Team", role: "member" }],
       })).toEqual({
         visible: true,
         invites: [{ id: 5, workspaceName: "Team", role: "member" }],
       });
     });

     it("disables accept and create actions at the membership cap", () => {
       expect(CAP_MESSAGE).toBe("You've reached the workspace limit (10).");
       expect(getWorkspaceLimitActionState({ membershipCount: 10, action: "accept-invite" })).toEqual({
         disabled: true,
         message: CAP_MESSAGE,
       });
       expect(getWorkspaceLimitActionState({ membershipCount: 10, action: "create-workspace" })).toEqual({
         disabled: true,
         message: CAP_MESSAGE,
       });
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/workspaceSwitcher.test.ts`
   Expected failure: switcher helpers do not exist.

3. Implement minimal code to satisfy the test:
   File: `client/src/context/BoardContext.tsx`
   Implement: unsaved-edit flag registration from card panel, pending switch target, invite remind-later state, accept/decline/remind actions, create workspace action, and cap handling.
   File: `client/src/types.ts`
   Implement: UI state types needed for switcher/invite helpers.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workspaceSwitcher.test.ts`
   Expected: PASS

5. Write failing API/UI contract tests for create/accept invite methods.
   File: `client/src/api.test.ts`
   Test verifies: create workspace and invite actions call the correct endpoints and propagate 409 cap errors.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";

   const mockFetch = vi.fn();
   vi.stubGlobal("fetch", mockFetch);

   describe("workspace create and invite API contracts", () => {
     it("creates workspaces and accepts invites through scoped endpoints", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ id: 9, name: "Launch", role: "owner", isPersonal: false }),
       });
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ workspaceId: 7, role: "member" }),
       });
       const { api } = await import("./api");

       await api.createWorkspace({ name: "Launch" });
       await api.acceptInvite(7, 12);

       expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/workspaces", expect.objectContaining({ method: "POST" }));
       expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/workspaces/7/invites/12/accept", expect.objectContaining({ method: "POST" }));
     });

     it("surfaces the 409 cap message for create and accept failures", async () => {
       mockFetch.mockResolvedValue({
         ok: false,
         status: 409,
         json: () => Promise.resolve({ error: "You've reached the workspace limit (10)." }),
       });
       const { api } = await import("./api");

       await expect(api.createWorkspace({ name: "Extra" })).rejects.toMatchObject({
         status: 409,
         message: "You've reached the workspace limit (10).",
       });
       await expect(api.acceptInvite(7, 12)).rejects.toMatchObject({
         status: 409,
         message: "You've reached the workspace limit (10).",
       });
     });
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/api.test.ts`
   Expected failure: create/accept wrapper behavior and cap handling are incomplete.

7. Implement minimal code to satisfy the test:
   File: `client/src/layout/Sidebar.tsx`
   Implement: desktop and mobile workspace switcher replacing header, active workspace display with logo/initials `h-6 w-6`, dropdown active item classes, Ghost "Create workspace", picker modal, pending invite modal/popover, unsaved confirm dialog, and toast copy "Workspace created."
   File: `client/src/components/AuthPage.tsx`
   Implement: post-auth invite modal/picker coordination if needed by context.
   File: `client/src/api.ts`
   Implement: final wrapper adjustments for create/accept/decline/remind flows.

8. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workspaceSwitcher.test.ts src/api.test.ts`
   Expected: PASS

9. Commit:
   `git add client/src/layout/Sidebar.tsx client/src/components/AuthPage.tsx client/src/context/BoardContext.tsx client/src/api.ts client/src/types.ts client/src/lib/workspaceSwitcher.test.ts client/src/api.test.ts`
   `git commit -m "feat(workspaces): add workspace switcher ui"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — rules: Post-login workspace selection, Signup and invites, Workspace switcher.
docs/pocket/rule/creative-brief.md — UI tokens, tone, button, input, modal/dropdown styling.
client/src/layout/Sidebar.tsx — current sidebar/header/sign-out popover patterns.
client/src/components/AuthPage.tsx — current auth surface.

## WHY THIS APPROACH

Complexity: standard
Justification: UI depends on active workspace context and API contracts, but does not need settings role work.

## SANDWICH CONTEXT

[CRITICAL: Workspace switcher must use active workspace context and must not create URL slug routing.]
You are implementing workspace picker/switcher UI for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: Keep app routes like `/board`; switch workspace via context and scoped API calls.
Files in scope: `client/src/layout/Sidebar.tsx`, `client/src/components/AuthPage.tsx`, `client/src/context/BoardContext.tsx`, `client/src/api.ts`, `client/src/types.ts`, `client/src/lib/workspaceSwitcher.test.ts`, `client/src/api.test.ts`
Test framework: Vitest colocated in `client/src/**/*.test.ts`
Available after: T6
Architecture rule: follow creative brief tokens and current SignOutPopover/modal patterns.
[RESTATE: Workspace switcher must use active workspace context and must not create URL slug routing.]

## DELIVERABLE

Given pending invites, When first login completes, Then blocking modal with Accept/Decline/Remind me later is shown.
Given Remind me later, When switcher opens, Then invite popover appears using SignOutPopover pattern.
Given frank has 10 memberships, When Accept or create is available, Then action is disabled or returns 409 cap message.
Given grace has unsaved card edits, When grace attempts to switch workspace, Then confirm dialog appears.
Given grace confirms Switch, Then workspace switches and edits are discarded.
Given switcher or picker, When create clicked, Then workspace is created and toast shows "Workspace created."

All tests PASS. Commit exists with message matching `feat(workspaces): add workspace switcher ui`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - Active workspace always visible in sidebar desktop and mobile drawer.
  - Dropdown uses `rounded-md`, active item `bg-primary-100 text-primary-800`, Ghost create action.
  - Picker modal uses `rounded-lg`, `border-neutral-200`, `shadow-lg`.
  - Unsaved switch confirmation uses Cancel/Switch pattern.
  - Tests written before implementation.
  - Commit message follows conventional commits format.

Must-not-have:
  - No Cmd+K, search, recent, or pinned switcher.
  - No email/link invite handling.
  - No multi-tab sync.

Open question risks:
  - Cap handling assumes client disables when membership count is known and server remains authoritative with 409.

Rollback note:
  - UI relies on active workspace context and scoped API contracts from T6.

## STOP CONDITIONS

Done when: switcher/invite tests pass, commit created.
Uncertain when: card panel cannot reliably expose unsaved edit state.
Escalate when: design implementation requires unrelated layout refactor outside listed files.

---

### Task 8: Workspace-scoped settings, permissions, and delete replacement [depends: T6]

## OBJECTIVE

Scope settings per workspace, restrict edits to owner/admin, remove `reset-app`, and replace danger-zone behavior with workspace deletion rules.

Files:
- Modify: `server/src/routes/settings.ts`
- Modify: `server/src/routes.ts`
- Modify: `client/src/pages/SettingsPage.tsx`
- Modify: `client/src/api.ts`
- Modify: `client/src/types.ts`
- Test: `server/src/routes/settings.test.ts`
- Test: `client/src/lib/settingsValidation.test.ts`
- Test: `client/src/api.test.ts`

Steps:
1. Write failing server settings tests.
   File: `server/src/routes/settings.test.ts`
   Test verifies: Given WS-A boardName="Alpha" and WS-B boardName="Beta", When settings are read through each workspace route, Then values stay scoped; Given owner/admin PATCH settings, Then saved per workspace; Given member PATCH settings, Then 403; Given `POST /settings/reset-app`, Then route is absent.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import { createWorkspaceSettingsService, hasResetAppRoute } from "./settings.js";

   describe("workspace settings service", () => {
     it("reads and writes settings by workspace id", async () => {
       const repo = {
         getMembership: vi.fn(async (_workspaceId, userId) => ({ userId, role: "admin" })),
         getSettings: vi.fn(async (workspaceId) => (
           workspaceId === 1
             ? [{ key: "board_name", textValue: "Alpha", boolValue: null, version: 1, updatedAt: "2026-06-13" }]
             : [{ key: "board_name", textValue: "Beta", boolValue: null, version: 1, updatedAt: "2026-06-13" }]
         )),
         updateSettings: vi.fn(async (workspaceId, updates) => ({ workspaceId, updates })),
       };
       const service = createWorkspaceSettingsService(repo);

       await expect(service.getSettings({ userId: 1, workspaceId: 1 }))
         .resolves.toMatchObject({ boardName: "Alpha" });
       await expect(service.getSettings({ userId: 1, workspaceId: 2 }))
         .resolves.toMatchObject({ boardName: "Beta" });

       await service.updateSettings({
         userId: 1,
         workspaceId: 2,
         updates: [{ key: "board_name", textValue: "Beta 2", version: 1 }],
       });
       expect(repo.updateSettings).toHaveBeenCalledWith(2, [{ key: "board_name", textValue: "Beta 2", version: 1 }]);
     });

     it("blocks member writes and removes reset-app", async () => {
       const service = createWorkspaceSettingsService({
         getMembership: vi.fn(async () => ({ role: "member" })),
         getSettings: vi.fn(),
         updateSettings: vi.fn(),
       });

       await expect(service.updateSettings({
         userId: 4,
         workspaceId: 7,
         updates: [{ key: "board_name", textValue: "Nope", version: 1 }],
       })).resolves.toEqual({ status: 403, error: "Forbidden" });
       expect(hasResetAppRoute()).toBe(false);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/settings.test.ts`
   Expected failure: settings are global and reset-app exists.

3. Implement minimal code to satisfy the test:
   File: `server/src/routes/settings.ts`
   Implement: workspace-aware settings router expecting workspace context, owner/admin edit checks, scoped `workspace_id` queries, scoped logo cleanup, and removal of `reset-app`.
   File: `server/src/routes.ts`
   Implement: mount settings under `/workspaces/:workspaceId/settings` with membership context and remove global settings mount.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/settings.test.ts`
   Expected: PASS

5. Write failing client settings tests.
   File: `client/src/api.test.ts`
   Test verifies: settings calls use `/api/workspaces/:workspaceId/settings`; `resetApp` wrapper is removed or no longer exported.
   File: `client/src/lib/settingsValidation.test.ts`
   Test verifies: danger-zone validation no longer references reset app and workspace delete confirmation remains owner-only UI state.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import {
     canEditWorkspaceSettings,
     getWorkspaceDangerZoneState,
   } from "./lib/settingsValidation";

   const mockFetch = vi.fn();
   vi.stubGlobal("fetch", mockFetch);

   describe("scoped settings API", () => {
     it("uses workspace-prefixed settings paths and removes resetApp", async () => {
       mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ boardName: "Alpha", logoPath: "/logo.png", version: 1 }) });
       const { api } = await import("./api");

       await api.getSettings(7);
       await api.updateSettings(7, [{ key: "board_name", textValue: "Alpha", version: 1 }]);

       expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/workspaces/7/settings", expect.any(Object));
       expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/workspaces/7/settings", expect.objectContaining({ method: "PATCH" }));
       expect("resetApp" in api).toBe(false);
     });
   });

   describe("workspace settings validation state", () => {
     it("allows owner/admin edits and blocks member edits", () => {
       expect(canEditWorkspaceSettings("owner")).toBe(true);
       expect(canEditWorkspaceSettings("admin")).toBe(true);
       expect(canEditWorkspaceSettings("member")).toBe(false);
     });

     it("uses workspace delete danger state instead of reset app", () => {
       expect(getWorkspaceDangerZoneState({
         role: "owner",
         memberCount: 1,
         isPersonal: false,
       })).toEqual({ canDelete: true, reason: null, resetAppVisible: false });
       expect(getWorkspaceDangerZoneState({
         role: "owner",
         memberCount: 1,
         isPersonal: true,
       })).toMatchObject({ canDelete: false, resetAppVisible: false });
     });
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/api.test.ts src/lib/settingsValidation.test.ts`
   Expected failure: client still calls global settings/reset-app.

7. Implement minimal code to satisfy the test:
   File: `client/src/api.ts`
   Implement: scoped settings API methods and remove reset-app wrapper.
   File: `client/src/pages/SettingsPage.tsx`
   Implement: use active workspace role; owner/admin can edit settings; member sees permission state; danger zone removes reset-app and uses workspace delete rules, including personal non-deletable and multi-member block copy.
   File: `client/src/types.ts`
   Implement: settings role fields if needed.

8. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/settings.test.ts && npm run test --workspace=client -- src/api.test.ts src/lib/settingsValidation.test.ts`
   Expected: PASS

9. Commit:
   `git add server/src/routes/settings.ts server/src/routes.ts server/src/routes/settings.test.ts client/src/pages/SettingsPage.tsx client/src/api.ts client/src/types.ts client/src/api.test.ts client/src/lib/settingsValidation.test.ts`
   `git commit -m "feat(workspaces): scope settings permissions"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — rules: Workspace settings, Ownership transfer and deletion.
server/src/routes/settings.ts — current global settings router and reset-app implementation.
client/src/pages/SettingsPage.tsx — current identity and danger zone UI.
docs/pocket/rule/creative-brief.md — settings UI tokens and permission/error copy style.

## WHY THIS APPROACH

Complexity: standard
Justification: Settings work is independent of switcher UI after active workspace context exists, but must be coordinated with server role checks and delete semantics.

## SANDWICH CONTEXT

[CRITICAL: Settings writes are workspace-scoped and owner/admin only; members receive 403.]
You are implementing workspace-scoped settings for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: Settings belongs under `/api/workspaces/:id/settings`; reset-app is removed.
Files in scope: `server/src/routes/settings.ts`, `server/src/routes.ts`, `server/src/routes/settings.test.ts`, `client/src/pages/SettingsPage.tsx`, `client/src/api.ts`, `client/src/types.ts`, `client/src/api.test.ts`, `client/src/lib/settingsValidation.test.ts`
Test framework: Vitest colocated in `server/src/**/*.test.ts` and `client/src/**/*.test.ts`
Available after: T6
Architecture rule: owner/admin permissions enforced server-side; client role gating is only UX.
[RESTATE: Settings writes are workspace-scoped and owner/admin only; members receive 403.]

## DELIVERABLE

Given WS-A boardName="Alpha" and WS-B boardName="Beta", When user switches from WS-A to WS-B, Then sidebar shows "Beta".
Given owner/admin, When PATCH settings, Then settings are saved per workspace.
Given member "kate" in WS-M, When kate PATCHes settings, Then 403.
Given sole owner deletes non-personal workspace, When delete succeeds, Then workspace and all scoped data are permanently removed.
Given personal workspace, When delete attempted, Then 403.

All tests PASS. Commit exists with message matching `feat(workspaces): scope settings permissions`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - Settings queries always include active workspace id.
  - Server enforces owner/admin write permission.
  - `reset-app` endpoint and UI are removed.
  - Personal workspace delete remains blocked.
  - Tests written before implementation.
  - Commit message follows conventional commits format.

Must-not-have:
  - No global settings state remains for board name/logo.
  - No `reset-app` endpoint or UI.
  - No organization or workspace templates.

Open question risks:
  - Personal workspace delete/leave is blocked in MVP; if product wants delete, report NEEDS_CONTEXT.

Rollback note:
  - If settings migration is wrong, restore DB backup before using scoped settings.

## STOP CONDITIONS

Done when: scoped settings tests pass, client settings tests pass, commit created.
Uncertain when: uploaded logo cleanup cannot safely distinguish workspace-owned files.
Escalate when: member edit permission cannot be enforced server-side.

---

### Task 9: End-to-end integration validation and legacy route cleanup [depends: T7, T8]

## OBJECTIVE

Validate the full multi-workspace workflow across server/client contracts, remove legacy global route assumptions, and ensure build/lint pass without out-of-scope behavior.

Files:
- Modify: `server/src/routes.ts`
- Modify: `server/src/routes/settings.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/context/BoardContext.tsx`
- Modify: `client/src/layout/Sidebar.tsx`
- Modify: `client/src/pages/SettingsPage.tsx`
- Test: `server/src/routes/workspaceAccess.test.ts`
- Test: `server/src/realtime.test.ts`
- Test: `server/src/routes/settings.test.ts`
- Test: `client/src/api.test.ts`
- Test: `client/src/lib/workspaceSelection.test.ts`
- Test: `client/src/lib/workspaceSwitcher.test.ts`

Steps:
1. Write failing integration coverage for: complete workspace flow and legacy route absence.
   File: `server/src/routes/workspaceAccess.test.ts`
   Test verifies: Given a user signs in, picks/creates a workspace, creates a card, switches workspace, and requests the original card through the second workspace, Then the second workspace returns 404 and no cross-workspace activity appears; Given legacy global board/settings endpoints, Then route access is absent or redirects to scoped equivalents according to final API contract.
   Test code:
   ```ts
   import { describe, expect, it } from "vitest";
   import { createWorkspaceIntegrationHarness, legacyWorkspaceRouteMatrix } from "../routes.js";

   describe("workspace integration cleanup", () => {
     it("keeps cards and activity isolated through a create and switch flow", async () => {
       const app = createWorkspaceIntegrationHarness();
       const alice = await app.signIn("alice");
       const wsA = await app.createWorkspace(alice, "WS-A");
       const wsB = await app.createWorkspace(alice, "WS-B");
       const card = await app.createCard(alice, wsA.id, { title: "Only in A" });

       await expect(app.getCard(alice, wsB.id, card.id)).resolves.toEqual({ status: 404 });
       await expect(app.getActivity(alice, wsB.id)).resolves.toEqual([]);
       await expect(app.getActivity(alice, wsA.id)).resolves.toEqual([
         expect.objectContaining({ cardId: card.id, workspaceId: wsA.id }),
       ]);
     });

     it("removes legacy global board, card, settings, event, and presence routes", () => {
       expect(legacyWorkspaceRouteMatrix()).toEqual([
         { method: "GET", path: "/api/board", status: 404 },
         { method: "POST", path: "/api/cards", status: 404 },
         { method: "GET", path: "/api/settings", status: 404 },
         { method: "GET", path: "/api/events/stream", status: 404 },
         { method: "GET", path: "/api/presence", status: 404 },
       ]);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`
   Expected failure: cross-task cleanup gaps or legacy routes may remain.

3. Implement minimal code to satisfy the test:
   Files: `server/src/routes.ts`, `server/src/routes/settings.ts`
   Implement: remove or guard legacy global `/board`, `/cards`, `/settings`, `/events/stream`, `/presence` routes; ensure all route mounts use workspace prefix and membership context.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts src/realtime.test.ts src/routes/settings.test.ts`
   Expected: PASS

5. Write failing client integration contract coverage.
   File: `client/src/lib/workspaceSelection.test.ts`
   Test verifies: Given active workspace changes, Then API calls refresh board, metrics, activity, presence, settings and event stream path in the expected sequence.
   File: `client/src/lib/workspaceSwitcher.test.ts`
   Test verifies: Given create workspace succeeds from picker, Then active workspace becomes the new workspace and localStorage updates.
   Test code:
   ```ts
   import { describe, expect, it } from "vitest";
   import { planWorkspaceRefresh } from "./workspaceSelection";
   import { applyCreatedWorkspaceSelection } from "./workspaceSwitcher";

   describe("workspace client integration plan", () => {
     it("refreshes every scoped resource and reconnects SSE when active workspace changes", () => {
       expect(planWorkspaceRefresh(12)).toEqual([
         "close-event-stream",
         "load-board:12",
         "load-metrics:12",
         "load-activity:12",
         "load-presence:12",
         "load-settings:12",
         "open-event-stream:12",
       ]);
     });

     it("selects a newly created workspace and persists it", () => {
       expect(applyCreatedWorkspaceSelection({
         currentWorkspaceIds: [1, 2],
         createdWorkspace: { id: 13, name: "Launch", role: "owner", isPersonal: false },
       })).toEqual({
         workspaces: [
           { id: 1 },
           { id: 2 },
           { id: 13, name: "Launch", role: "owner", isPersonal: false },
         ],
         activeWorkspaceId: 13,
         localStorageWrite: { key: "activeWorkspaceId", value: "13" },
         toast: "Workspace created.",
       });
     });
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/workspaceSelection.test.ts src/lib/workspaceSwitcher.test.ts`
   Expected failure: any missing integration behavior from prior tasks is exposed.

7. Implement minimal code to satisfy the test:
   Files: `client/src/api.ts`, `client/src/context/BoardContext.tsx`, `client/src/layout/Sidebar.tsx`, `client/src/pages/SettingsPage.tsx`
   Implement: final wiring corrections only, preserving task scopes and avoiding new features.

8. Run test, lint, and build — verify PASS:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts src/realtime.test.ts src/routes/settings.test.ts`
   `npm run test --workspace=client -- src/api.test.ts src/lib/workspaceSelection.test.ts src/lib/workspaceSwitcher.test.ts`
   `npm run lint`
   `npm run build`
   Expected: PASS

9. Commit:
   `git add server/src/routes.ts server/src/routes/settings.ts server/src/routes/workspaceAccess.test.ts server/src/realtime.test.ts server/src/routes/settings.test.ts client/src/api.ts client/src/context/BoardContext.tsx client/src/layout/Sidebar.tsx client/src/pages/SettingsPage.tsx client/src/api.test.ts client/src/lib/workspaceSelection.test.ts client/src/lib/workspaceSwitcher.test.ts`
   `git commit -m "test(workspaces): verify workspace integration"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — all acceptance groups used as final integration verification.
server/src/routes.ts — final route mount and legacy cleanup target.
client/src/context/BoardContext.tsx — final active workspace flow target.
client/src/layout/Sidebar.tsx — switcher integration target.

## WHY THIS APPROACH

Complexity: standard
Justification: The final task verifies behavior spanning tasks and catches any residual global assumptions without introducing new product scope.

## SANDWICH CONTEXT

[CRITICAL: Final integration must not reintroduce global board/settings access or out-of-scope workspace features.]
You are implementing final integration validation for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: Full workspace boundary with path-prefixed API and context-based client routing.
Files in scope: `server/src/routes.ts`, `server/src/routes/settings.ts`, `server/src/routes/workspaceAccess.test.ts`, `server/src/realtime.test.ts`, `server/src/routes/settings.test.ts`, `client/src/api.ts`, `client/src/context/BoardContext.tsx`, `client/src/layout/Sidebar.tsx`, `client/src/pages/SettingsPage.tsx`, `client/src/api.test.ts`, `client/src/lib/workspaceSelection.test.ts`, `client/src/lib/workspaceSwitcher.test.ts`
Test framework: Vitest plus repo lint/build commands.
Available after: T7, T8
Architecture rule: this task may only close integration gaps; it must not add features outside the spec.
[RESTATE: Final integration must not reintroduce global board/settings access or out-of-scope workspace features.]

## DELIVERABLE

Given switch workspace, When selected, Then all context reloads and SSE reconnects to workspace channel only.
Given non-member, When access workspace API, Then 404.
Given cross-workspace event, When SSE active, Then event is not delivered.
Given owner/admin settings and member settings cases, When final full test suite runs, Then permissions remain correct.
Given out-of-scope list, When final implementation is reviewed, Then no organization layer, templates, public discovery, slug routing, or multi-tab sync is present.

All tests PASS. Commit exists with message matching `test(workspaces): verify workspace integration`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - Targeted server and client workspace tests pass.
  - `npm run lint` and `npm run build` pass.
  - Legacy global route assumptions are removed or guarded according to final scoped API contract.
  - Commit message follows conventional commits format.

Must-not-have:
  - No out-of-scope features.
  - No broad refactors unrelated to workspace integration.
  - No edits to `server/src/core/*`.

Open question risks:
  - If legacy route compatibility is required, this plan needs product clarification because the design decision prefers path-prefixed workspace APIs.

Rollback note:
  - Full feature rollback requires DB restore and previous release tag for API/client.

## STOP CONDITIONS

Done when: integration tests, lint, build, and commit complete.
Uncertain when: legacy route compatibility is required.
Escalate when: final validation exposes a missing acceptance criterion requiring more than integration cleanup.

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
