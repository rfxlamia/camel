# Multi-Workspace MVP — Workspace schema and idempotent migration foundation (Phase 1 of 3)

**Date:** 2026-06-13
**Original plan:** docs/pocket/plans/2026-06-13-multi-workspace/execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T3}
**Unlocks next:** Phase 2

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T1: Workspace schema and idempotent migration foundation [prereq]
T2: Workspace bootstrap in auth and shared membership helpers [depends: T1]
T3: Workspace and membership management API [depends: T2]

---

## Pocket Packets

---

### Task 1: Workspace schema and idempotent migration foundation [prereq]

## OBJECTIVE

Create the database foundation for workspaces and make migration/seed idempotently assign legacy board data without touching core modules.

Files:
- Modify: `server/src/db/schema.sql`
- Modify: `server/src/db/migrate.ts`
- Modify: `server/src/db/seed.ts`
- Test: `server/src/db/workspaceMigration.test.ts`

Steps:
1. Write failing test for: Migration and schema idempotency.
   File: `server/src/db/workspaceMigration.test.ts`
   Test verifies: Given legacy global board data and users with no workspaces, When the migration SQL is analyzed/applied by the migration helper, Then `workspaces`, `workspace_members`, `workspace_invites`, and scoped `workspace_id` columns exist, one "Default Workspace" owns legacy data, every user receives an empty personal workspace, `workspace_id` is not nullable after assignment, and re-running does not duplicate workspaces.
   Test code:
   ```ts
   import { describe, expect, it } from "vitest";
   import { readFileSync } from "node:fs";
   import { analyzeWorkspaceSchema, planLegacyWorkspaceMigration } from "./migrate.js";

   const schemaSql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

   describe("workspace migration foundation", () => {
     it("declares workspace tables and non-null scoped columns", () => {
       const schema = analyzeWorkspaceSchema(schemaSql);

       expect(schema.tables).toEqual(expect.arrayContaining([
         "workspaces",
         "workspace_members",
         "workspace_invites",
       ]));
       expect(schema.scopedTables).toMatchObject({
         columns: "workspace_id",
         cards: "workspace_id",
         card_events: "workspace_id",
         settings: "workspace_id",
       });
       expect(schema.notNullWorkspaceTables).toEqual(expect.arrayContaining([
         "columns",
         "cards",
         "card_events",
         "settings",
       ]));
       expect(schema.uniqueGuards).toEqual(expect.arrayContaining([
         "workspace_members:user_id,workspace_id",
         "workspace_invites:workspace_id,username",
       ]));
     });

     it("plans idempotent default and personal workspace assignment", () => {
       const firstRun = planLegacyWorkspaceMigration({
         workspaceCount: 0,
         users: [
           { id: 1, username: "alice", displayName: "Alice" },
           { id: 2, username: "bob", displayName: "Bob" },
           { id: 3, username: "carol", displayName: "Carol" },
         ],
         legacyColumnIds: [10, 11],
         legacyCardIds: [20],
         legacySettingKeys: ["board_name"],
       });

       expect(firstRun.defaultWorkspace).toMatchObject({ name: "Default Workspace", ownerUserId: 1 });
       expect(firstRun.defaultMembers).toEqual([
         { userId: 1, role: "owner" },
         { userId: 2, role: "member" },
         { userId: 3, role: "member" },
       ]);
       expect(firstRun.personalWorkspaces).toHaveLength(3);
       expect(firstRun.personalWorkspaces.every((ws) => ws.isPersonal)).toBe(true);
       expect(firstRun.assignments).toMatchObject({
         columns: [10, 11],
         cards: [20],
         settings: ["board_name"],
       });

       const secondRun = planLegacyWorkspaceMigration({
         workspaceCount: 4,
         users: [{ id: 1, username: "alice", displayName: "Alice" }],
         legacyColumnIds: [10],
         legacyCardIds: [20],
         legacySettingKeys: ["board_name"],
       });
       expect(secondRun.operations).toEqual([]);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/db/workspaceMigration.test.ts`
   Expected failure: assertions fail because `schema.sql` has no `workspaces`, membership tables, scoped settings, or migration guard.

3. Implement minimal code to satisfy the test:
   File: `server/src/db/schema.sql`
   Implement: tables `workspaces`, `workspace_members`, `workspace_invites`; `workspace_id` on `columns`, `cards`, `card_events`, and `settings`; indexes and uniqueness constraints; default legacy workspace creation; per-user personal workspace creation with `is_personal`; idempotent guard that skips duplicate workspace creation when workspaces already exist.
   File: `server/src/db/migrate.ts`
   Implement: any transaction wrapper or migration-order guard needed for the full schema to apply atomically.
   File: `server/src/db/seed.ts`
   Implement: seed into a default workspace and preserve no-op behavior when already seeded.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/db/workspaceMigration.test.ts`
   Expected: PASS

5. Commit:
   `git add server/src/db/schema.sql server/src/db/migrate.ts server/src/db/seed.ts server/src/db/workspaceMigration.test.ts`
   `git commit -m "feat(workspaces): add scoped schema migration"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — rules: Migration, Signup and invites; GWT scenarios used as verification.
server/src/db/schema.sql — existing schema source of truth; migrations are idempotent `IF NOT EXISTS` statements and ALTERs.
server/src/db/migrate.ts — applies only `schema.sql`.
server/src/db/seed.ts — currently seeds global columns/cards and skips if columns exist.

## WHY THIS APPROACH

Complexity: deep
Justification: Structural migration is the prerequisite for every later task and has the highest rollback risk.

## SANDWICH CONTEXT

[CRITICAL: Do not edit `server/src/core/*`; workspace scoping belongs in DB/API callers.]
You are implementing workspace schema and migration for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: Full workspace boundary with `/api/workspaces/:id/...` routes and `workspace_id` data scoping.
Files in scope: `server/src/db/schema.sql`, `server/src/db/migrate.ts`, `server/src/db/seed.ts`, `server/src/db/workspaceMigration.test.ts`
Test framework: Vitest colocated in `server/src/**/*.test.ts`
Available after: none
Architecture rule: migration must be idempotent and all scoped board data must carry `workspace_id`; core pure modules remain untouched.
[RESTATE: Do not edit `server/src/core/*`; workspace scoping belongs in DB/API callers.]

## DELIVERABLE

Given DB with global columns/cards and 3 users, no workspaces, When migration runs, Then one "Default Workspace" is created with all legacy data.
Given DB with global columns/cards and 3 users, no workspaces, When migration runs, Then all 3 users are members with first user as owner and others as member.
Given DB with users, When migration runs, Then each user gets an empty personal workspace marked `is_personal = true`.
Given migration completed, When inspecting scoped tables, Then `workspace_id` is NOT NULL on scoped tables.
Given migration has already run, When migration runs a second time, Then no duplicate workspaces or data assignments are created.

All tests PASS. Commit exists with message matching `feat(workspaces): add scoped schema migration`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - `workspace_id` FK exists on `columns`, `cards`, `card_events`, and `settings`.
  - `workspaces.is_personal` exists and is authoritative for personal workspace behavior.
  - Migration is idempotent and safe to re-run.
  - Tests written before implementation.
  - Commit message follows conventional commits format.

Must-not-have:
  - No organization layer, templates, public workspace discovery, granular roles, or slug routing.
  - No changes to `server/src/core/*`.
  - No destructive data loss during normal migration.

Open question risks:
  - Migration first user as owner is assumed lowest user id or seed user → if product requires a different owner, report NEEDS_CONTEXT.

Rollback note:
  - Feature is structural; rollback requires pre-migration DB restore.

## STOP CONDITIONS

Done when: migration GWT scenarios pass, server targeted test passes, commit created.
Uncertain when: owner assignment assumption is disputed by existing data.
Escalate when: migration cannot be made idempotent or requires editing `server/src/core/*`.

---

### Task 2: Workspace bootstrap in auth and shared membership helpers [depends: T1]

## OBJECTIVE

Create authenticated workspace bootstrap behavior: personal workspace on signup, membership listing, invite listing, and reusable membership/cap/role checks inside allowed server files.

Files:
- Modify: `server/src/auth.ts`
- Modify: `server/src/routes.ts`
- Test: `server/src/auth.test.ts`
- Test: `server/src/workspaces.test.ts`

Steps:
1. Write failing test for: Signup creates personal workspace and pending invites remain pending.
   File: `server/src/auth.test.ts`
   Test verifies: Given no user "dave" exists, When dave signs up with display name "Dave", Then "Dave's Workspace" is created, dave is sole owner, and `is_personal = true`; Given a pending invite for "eve", When eve signs up, Then eve has a personal workspace and is not automatically a member of the invited workspace.
   Test code:
   ```ts
   import { describe, expect, it } from "vitest";
   import { createSignupWorkspacePlan } from "./auth.js";

   describe("createSignupWorkspacePlan", () => {
     it("creates a personal workspace owned by the new user", () => {
       const plan = createSignupWorkspacePlan({
         user: { id: 4, username: "dave", displayName: "Dave" },
         pendingInvites: [],
       });

       expect(plan.personalWorkspace).toEqual({
         name: "Dave's Workspace",
         ownerUserId: 4,
         isPersonal: true,
       });
       expect(plan.memberships).toEqual([{ userId: 4, role: "owner", personal: true }]);
       expect(plan.consumedInviteIds).toEqual([]);
     });

     it("keeps pending invites unconsumed on signup", () => {
       const plan = createSignupWorkspacePlan({
         user: { id: 5, username: "eve", displayName: "Eve" },
         pendingInvites: [{ id: 99, workspaceId: 7, username: "eve", role: "member" }],
       });

       expect(plan.personalWorkspace.name).toBe("Eve's Workspace");
       expect(plan.memberships).toEqual([{ userId: 5, role: "owner", personal: true }]);
       expect(plan.pendingInvites).toEqual([{ id: 99, workspaceId: 7, username: "eve", role: "member" }]);
       expect(plan.consumedInviteIds).toEqual([]);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/auth.test.ts`
   Expected failure: signup only creates a user/session and no workspace membership.

3. Implement minimal code to satisfy the test:
   File: `server/src/auth.ts`
   Implement: transaction around user creation, personal workspace creation, owner membership creation, unchanged session behavior, and no auto-join for pending invites.
   File: `server/src/routes.ts`
   Implement: exported or local pure helpers for membership cap, role ordering, active membership lookup, and invite serialization used by later workspace routes.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/auth.test.ts`
   Expected: PASS

5. Write failing test for: Workspace listing and cap helper.
   File: `server/src/workspaces.test.ts`
   Test verifies: Given a user with 10 memberships, When checking create/accept capacity, Then the helper reports the 10-workspace cap and returns the spec error message "You've reached the workspace limit (10)."
   Test code:
   ```ts
   import { describe, expect, it } from "vitest";
   import {
     WORKSPACE_LIMIT,
     getWorkspaceCapacity,
     serializeWorkspaceList,
   } from "./routes.js";

   describe("workspace helper contracts", () => {
     it("blocks create and invite accept at 10 memberships", () => {
       expect(WORKSPACE_LIMIT).toBe(10);
       expect(getWorkspaceCapacity(9)).toEqual({ ok: true, remaining: 1 });
       expect(getWorkspaceCapacity(10)).toEqual({
         ok: false,
         status: 409,
         message: "You've reached the workspace limit (10).",
       });
     });

     it("serializes workspaces and pending invites for the client", () => {
       const response = serializeWorkspaceList({
         workspaces: [{ id: 1, name: "Default Workspace", role: "owner", isPersonal: false }],
         invites: [{ id: 5, workspaceId: 9, workspaceName: "Team", role: "member" }],
       });

       expect(response.workspaces[0]).toMatchObject({
         id: 1,
         name: "Default Workspace",
         role: "owner",
         isPersonal: false,
       });
       expect(response.pendingInvites).toEqual([
         { id: 5, workspaceId: 9, workspaceName: "Team", role: "member" },
       ]);
     });
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=server -- src/workspaces.test.ts`
   Expected failure: helper does not exist.

7. Implement minimal code to satisfy the test:
   File: `server/src/routes.ts`
   Implement: membership count helper, cap error helper, and workspace/invite response mappers with exact response fields consumed by client types.

8. Run test — verify PASS:
   `npm run test --workspace=server -- src/auth.test.ts src/workspaces.test.ts`
   Expected: PASS

9. Commit:
   `git add server/src/auth.ts server/src/routes.ts server/src/auth.test.ts server/src/workspaces.test.ts`
   `git commit -m "feat(workspaces): bootstrap personal memberships"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — rules: Signup and invites, Membership and roles.
server/src/auth.ts — current register/login/session flow.
server/src/routes.ts — existing authenticated API router and route helper location.

## WHY THIS APPROACH

Complexity: standard
Justification: Signup and reusable workspace helper contracts unblock both server API routes and client state without introducing files outside the allowed touch list.

## SANDWICH CONTEXT

[CRITICAL: Use `requireAuth`/session auth and do not add a second authentication path.]
You are implementing auth workspace bootstrap for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: Full workspace boundary with path-prefixed workspace APIs.
Files in scope: `server/src/auth.ts`, `server/src/routes.ts`, `server/src/auth.test.ts`, `server/src/workspaces.test.ts`
Test framework: Vitest colocated in `server/src/**/*.test.ts`
Available after: T1
Architecture rule: all workspace membership decisions are derived from `req.user` and DB membership rows.
[RESTATE: Use `requireAuth`/session auth and do not add a second authentication path.]

## DELIVERABLE

Given no user "dave" exists, When dave signs up with display_name "Dave", Then workspace "Dave's Workspace" is created with dave as owner.
Given dave signs up, When signup completes, Then dave is the sole member and personal workspace is marked `is_personal = true`.
Given pending invite for username "eve" to WS-T, When eve signs up, Then personal workspace is created and eve is NOT yet a member of WS-T.
Given frank has 10 workspace memberships, When frank attempts to Accept invite or create a workspace, Then helper/API returns 409 with "You've reached the workspace limit (10)."

All tests PASS. Commit exists with message matching `feat(workspaces): bootstrap personal memberships`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - Personal workspace creation happens in the same transactional signup flow as user creation.
  - Pending invites are listed/available after signup but not consumed automatically.
  - Membership cap counts personal workspaces.
  - Tests written before implementation.
  - Commit message follows conventional commits format.

Must-not-have:
  - No email/link invite implementation.
  - No public workspace discovery.
  - No changes outside listed files.

Open question risks:
  - Personal workspace identity uses `is_personal` → if existing data encodes this differently, report NEEDS_CONTEXT.

Rollback note:
  - Auth bootstrap depends on structural migration; rollback requires DB restore if deployed.

## STOP CONDITIONS

Done when: signup and cap tests pass, commit created.
Uncertain when: existing production signup flow cannot tolerate DB transaction around session creation.
Escalate when: helper implementation needs new server files outside the architecture constraints.

---

### Task 3: Workspace and membership management API [depends: T2]

## OBJECTIVE

Implement workspace CRUD, invite acceptance/decline, member management, ownership transfer, and uniform authorization responses under authenticated workspace routes.

Files:
- Modify: `server/src/routes.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/types.ts`
- Test: `server/src/routes/workspaceAccess.test.ts`
- Test: `client/src/api.test.ts`
- Test: `client/src/types.test.ts`

Steps:
1. Write failing test for: Workspace management API authorization and role rules.
   File: `server/src/routes/workspaceAccess.test.ts`
   Test verifies: Given an owner/admin, When adding an existing user with fewer than 10 memberships, Then member role is assigned; Given an unknown username, Then pending invite is stored; Given a member attempts to manage users, Then 404; Given admin attempts to remove owner, Then 403.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import { CAP_ERROR_MESSAGE, createWorkspaceAccessService } from "../routes.js";

   function repo(overrides = {}) {
     return {
       getActorMembership: vi.fn(async (_workspaceId, actorId) =>
         actorId === 1 ? { userId: 1, role: "admin" } : { userId: actorId, role: "member" },
       ),
       findUserByUsername: vi.fn(async (username) =>
         username === "iris" ? { id: 2, username: "iris", membershipCount: 2 } : null,
       ),
       getMembershipCount: vi.fn(async (userId) => (userId === 3 ? 10 : 2)),
       addMember: vi.fn(async (input) => ({ id: 10, ...input })),
       createInvite: vi.fn(async (input) => ({ id: 20, ...input })),
       getWorkspaceOwner: vi.fn(async () => ({ userId: 9, role: "owner" })),
       removeMember: vi.fn(async () => undefined),
       ...overrides,
     };
   }

   describe("workspace access service", () => {
     it("adds existing users as members and stores invites for unknown usernames", async () => {
       const fakeRepo = repo();
       const service = createWorkspaceAccessService(fakeRepo);

       await expect(service.addMember({ actorId: 1, workspaceId: 7, username: "iris" }))
         .resolves.toMatchObject({ userId: 2, role: "member" });
       expect(fakeRepo.addMember).toHaveBeenCalledWith({ workspaceId: 7, userId: 2, role: "member" });

       await expect(service.addMember({ actorId: 1, workspaceId: 7, username: "jack" }))
         .resolves.toMatchObject({ workspaceId: 7, username: "jack", role: "member" });
       expect(fakeRepo.createInvite).toHaveBeenCalledWith({ workspaceId: 7, username: "jack", role: "member", invitedBy: 1 });
     });

     it("hides management actions from members and blocks owner removal", async () => {
       const service = createWorkspaceAccessService(repo());

       await expect(service.addMember({ actorId: 4, workspaceId: 7, username: "iris" }))
         .resolves.toEqual({ status: 404, error: "Not found" });
       await expect(service.removeMember({ actorId: 1, workspaceId: 7, userId: 9 }))
         .resolves.toEqual({ status: 403, error: "Cannot remove workspace owner" });
     });

     it("returns the cap message when invitee already has 10 workspaces", async () => {
       const service = createWorkspaceAccessService(repo({
         findUserByUsername: vi.fn(async () => ({ id: 3, username: "iris", membershipCount: 10 })),
       }));

       await expect(service.addMember({ actorId: 1, workspaceId: 7, username: "iris" }))
         .resolves.toEqual({ status: 409, error: CAP_ERROR_MESSAGE });
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`
   Expected failure: workspace management routes do not exist.

3. Implement minimal code to satisfy the test:
   File: `server/src/routes.ts`
   Implement: `GET /workspaces`, `POST /workspaces`, `GET /workspaces/:workspaceId/members`, `POST /workspaces/:workspaceId/members`, invite accept/decline/remind endpoints, ownership transfer, member removal, workspace deletion, cap checks, role checks, and uniform 404 for non-member workspace access.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`
   Expected: PASS

5. Write failing client contract tests.
   File: `client/src/api.test.ts`
   Test verifies: `api.getWorkspaces`, `api.createWorkspace`, `api.addWorkspaceMember`, `api.acceptInvite`, `api.declineInvite`, `api.transferWorkspaceOwnership`, and `api.deleteWorkspace` call the documented `/api/workspaces...` paths.
   File: `client/src/types.test.ts`
   Test verifies: `Workspace`, `WorkspaceMember`, `WorkspaceInvite`, `WorkspaceRole`, and `WorkspaceListResponse` support the server response fields.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import type {
     Workspace,
     WorkspaceInvite,
     WorkspaceListResponse,
     WorkspaceMember,
     WorkspaceRole,
   } from "./types";

   const mockFetch = vi.fn();
   vi.stubGlobal("fetch", mockFetch);

   describe("workspace API methods", () => {
     it("calls documented workspace and membership endpoints", async () => {
       mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
       const { api } = await import("./api");

       await api.getWorkspaces();
       await api.createWorkspace({ name: "Launch" });
       await api.addWorkspaceMember(7, { username: "iris" });
       await api.acceptInvite(7, 12);
       await api.declineInvite(7, 12);
       await api.transferWorkspaceOwnership(7, { newOwnerId: 2, previousOwnerRole: "admin" });
       await api.deleteWorkspace(7);

       expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/workspaces", expect.any(Object));
       expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/workspaces", expect.objectContaining({ method: "POST" }));
       expect(mockFetch).toHaveBeenNthCalledWith(3, "/api/workspaces/7/members", expect.objectContaining({ method: "POST" }));
       expect(mockFetch).toHaveBeenNthCalledWith(4, "/api/workspaces/7/invites/12/accept", expect.objectContaining({ method: "POST" }));
       expect(mockFetch).toHaveBeenNthCalledWith(5, "/api/workspaces/7/invites/12", expect.objectContaining({ method: "DELETE" }));
       expect(mockFetch).toHaveBeenNthCalledWith(6, "/api/workspaces/7/transfer-ownership", expect.objectContaining({ method: "POST" }));
       expect(mockFetch).toHaveBeenNthCalledWith(7, "/api/workspaces/7", expect.objectContaining({ method: "DELETE" }));
     });
   });

   describe("workspace response types", () => {
     it("type-checks the server response shape", () => {
       const role: WorkspaceRole = "owner";
       const workspace: Workspace = { id: 7, name: "Launch", role, isPersonal: false, memberCount: 3 };
       const member: WorkspaceMember = { userId: 2, username: "iris", displayName: "Iris", role: "member" };
       const invite: WorkspaceInvite = { id: 12, workspaceId: 7, workspaceName: "Launch", role: "member" };
       const response: WorkspaceListResponse = { workspaces: [workspace], pendingInvites: [invite] };

       expect(response.workspaces[0].role).toBe("owner");
       expect(member.role).toBe("member");
       expect(response.pendingInvites[0].workspaceName).toBe("Launch");
     });
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/api.test.ts src/types.test.ts`
   Expected failure: client API methods/types do not exist.

7. Implement minimal code to satisfy the test:
   File: `client/src/api.ts`
   Implement workspace/membership/invite API wrapper methods using `/api/workspaces...`.
   File: `client/src/types.ts`
   Implement workspace, member, invite, role, and workspace settings response types.

8. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts && npm run test --workspace=client -- src/api.test.ts src/types.test.ts`
   Expected: PASS

9. Commit:
   `git add server/src/routes.ts server/src/routes/workspaceAccess.test.ts client/src/api.ts client/src/api.test.ts client/src/types.ts client/src/types.test.ts`
   `git commit -m "feat(workspaces): add management api"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — rules: Signup and invites, Membership and roles, Ownership transfer and deletion.
server/src/routes.ts — current API route style and `requireAuth` usage.
client/src/api.ts — typed fetch wrapper path convention.
client/src/types.ts — shared interface location.

## WHY THIS APPROACH

Complexity: deep
Justification: This task owns the API contract that later board scoping, settings, and UI tasks depend on.

## SANDWICH CONTEXT

[CRITICAL: Non-members must receive uniform 404 for workspace API access.]
You are implementing workspace and membership management APIs for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: API path prefix `/api/workspaces/:id/...`.
Files in scope: `server/src/routes.ts`, `server/src/routes/workspaceAccess.test.ts`, `client/src/api.ts`, `client/src/api.test.ts`, `client/src/types.ts`, `client/src/types.test.ts`
Test framework: Vitest colocated in `server/src/**/*.test.ts` and `client/src/**/*.test.ts`
Available after: T2
Architecture rule: authorization is role/membership based from `requireAuth`; non-member access is hidden as 404.
[RESTATE: Non-members must receive uniform 404 for workspace API access.]

## DELIVERABLE

Given admin "henry" in WS-M and user "iris" exists with fewer than 10 memberships, When henry adds "iris" by username, Then iris becomes member with default role member.
Given admin adds username "jack" who does not exist, Then pending invite is stored.
Given iris belongs to 10 workspaces, When henry adds iris to WS-M, Then 409 with cap message.
Given member "kate" in WS-M, When kate attempts to add a user, Then 404.
Given owner "leo" in WS-L, When admin attempts to remove leo, Then 403.
Given owner "leo" and member "mia" in WS-L, When leo transfers ownership to mia and chooses role admin, Then mia is owner and leo is admin.
Given owner leo and member mia in WS-L, When leo attempts to delete WS-L, Then request fails until sole member.
Given leo is sole member/owner of WS-L, When leo deletes WS-L, Then workspace and all scoped data are permanently removed.
Given user "nina" with personal workspace WS-N, When nina attempts to delete WS-N, Then 403.

All tests PASS. Commit exists with message matching `feat(workspaces): add management api`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - Role checks distinguish owner, admin, and member exactly as spec requires.
  - Cap checks return 409 and exact cap copy.
  - Non-member workspace API access returns 404.
  - Client API wrappers use path-prefixed workspace routes.
  - Tests written before implementation.
  - Commit message follows conventional commits format.

Must-not-have:
  - No organization layer, public workspaces, email/link invites, granular roles, or slug routes.
  - No reset-app replacement inside this task.
  - No edits to `server/src/core/*`.

Open question risks:
  - Admin remove owner is assumed 403 → if owner removal policy changes, report NEEDS_CONTEXT.

Rollback note:
  - Workspace delete is hard cascade; verify tests use isolated fixtures before executing against real DB.

## STOP CONDITIONS

Done when: server/client API contract tests pass, commit created.
Uncertain when: route tests require a DB fixture strategy not present in repo.
Escalate when: authorization cannot be implemented without leaking whether hidden workspaces exist.

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
