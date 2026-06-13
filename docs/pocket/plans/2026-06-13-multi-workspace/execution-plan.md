# EXECUTION PLAN — Multi-Workspace MVP

**Date:** 2026-06-13
**Spec:** docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
**Status:** draft
**Total tasks:** 9

---

## Preflight Summary

PREFLIGHT COMPLETE
Codebase scanned: `server/src/db/schema.sql`, `server/src/db/migrate.ts`, `server/src/db/seed.ts`, `server/src/auth.ts`, `server/src/routes.ts`, `server/src/routes/settings.ts`, `server/src/realtime.ts`, `client/src/context/BoardContext.tsx`, `client/src/layout/Sidebar.tsx`, `client/src/layout/AppLayout.tsx`, `client/src/components/AuthPage.tsx`, `client/src/pages/BoardPage.tsx`, `client/src/pages/SettingsPage.tsx`, `client/src/api.ts`, `client/src/types.ts`, `docs/pocket/rule/creative-brief.md`
Test framework: Vitest. Server tests are colocated under `server/src/**/*.test.ts`; client tests are colocated under `client/src/**/*.test.ts`. Existing tests favor pure validators/helpers and typed fetch wrapper assertions.
File conventions: Express routers in `server/src/routes.ts` and `server/src/routes/*.ts`; `requireAuth` populates `req.user`; board API routes publish SSE after successful DB mutation; settings helpers export pure validators from `server/src/routes/settings.ts`; client API wrapper prefixes `/api`; `BoardProvider` owns board, metrics, activity, presence, settings, SSE, toast, and session state above the router.
Library docs fetched: React Router `/remix-run/react-router/react-router_7.9.4`; Redis Node.js Client `/redis/node-redis`.
Key findings: Current data model is global. `routes/settings.ts` already exists and includes `POST /settings/reset-app`, which the spec removes. Realtime uses one Redis channel and one local `Set<Response>`, so workspace isolation must affect both Redis and local fallback paths.
Unknown areas: none.

SPEC PARSED: Multi-Workspace MVP
Design: Option A — Full Multi-Workspace MVP with URL path prefix using `/api/workspaces/:id/...` routes.
Constraints: May touch listed server/client files and router paths; must not touch `server/src/core/*`; use `requireAuth`, optimistic locking, SSE Redis degradation, creative brief tokens.
Rules: 8 acceptance groups, 21 listed criteria | GWT coverage: all rules usable, 0 need derivation, 2 negative criteria.
Open questions: 6 assumptions captured in spec.
Rollback plan: present — DB restore from pre-migration backup; disable new routes and restore old monolithic API from prior release tag if partial deploy.
Conflicts: none.

### Test-Architect Summary

Tasks enriched: 9
Integration test tasks added: 0 — Task 9 already covers cross-task integration and legacy route cleanup.
TDD order corrections made: 0 — existing red/green cycles already follow write failing test, verify fail, implement, verify pass, commit.
Test framework used: Vitest, colocated under `server/src/**/*.test.ts` and `client/src/**/*.test.ts`.
Coverage areas: schema/migration helpers, auth bootstrap helpers, workspace membership/role APIs, scoped board API contracts, realtime/presence isolation, client workspace selection helpers, switcher/invite UI state helpers, scoped settings permissions, and final integration cleanup. Intentional non-coverage: browser E2E, real PostgreSQL/Redis fixtures, and out-of-scope workspace features.

---

## Execution Overview

### Recommended Order

```
T1 -> T2 -> T3 -> T4,T5 (parallel) -> T6 -> T7,T8 (parallel) -> T9
```

> Dependency order above is recommended. Pocket skill enforces actual parallelism and sequencing based on the dependency annotations.

### Parallelizable Groups

| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T4 scoped board API, T5 realtime isolation | T3 workspace/member API contracts complete |
| Group B | T7 switcher/invites UI, T8 settings permissions/UI | T6 client workspace context complete |

### Constraints Reminder

**Architecture:** Do not edit `server/src/core/*`; all board isolation must be enforced by callers passing scoped rows into core functions. Use `requireAuth`, optimistic locking, SSE Redis degradation, and creative brief tokens.
**File-scope note:** The spec's related areas omit some caller/UI files that are necessary to route accepted workspace behavior (`client/src/App.tsx`, `client/src/components/ContextPanel.tsx`, `client/src/pages/SettingsPage.tsx`, test files, and DB migrate/seed callers). Those files are included only where the acceptance criteria require them; `server/src/core/*` remains the hard no-touch boundary.
**Out-of-scope:** No organization layer, aggregated dashboard, templates, email/link invites, Cmd+K, search/recent/pin switcher, public workspaces, granular roles, `reset-app`, per-workspace scroll/card-panel persistence, slug routing, or multi-tab storage sync.
**Assumptions at risk:** Independent tabs with localStorage last-write-wins; add-at-cap returns 409; admin removing owner returns 403; personal workspace identified by `is_personal`; personal workspace leave/delete blocked; first legacy user is owner during migration.
**Sequencing:** Dependency order shown is recommended only. Pocket enforces actual blocking rules.

### File Structure Map

```
Rule: Post-login workspace selection
  Modify: client/src/App.tsx
  Modify: client/src/context/BoardContext.tsx
  Modify: client/src/api.ts
  Modify: client/src/types.ts
  Modify: client/src/layout/Sidebar.tsx
  Test:   client/src/api.test.ts
  Test:   client/src/types.test.ts
  Test:   client/src/lib/workspaceSelection.test.ts (created by T6)

Rule: Signup and invites
  Modify: server/src/db/schema.sql
  Modify: server/src/db/seed.ts
  Modify: server/src/auth.ts
  Modify: server/src/routes.ts
  Modify: client/src/components/AuthPage.tsx
  Modify: client/src/context/BoardContext.tsx
  Modify: client/src/layout/Sidebar.tsx
  Modify: client/src/api.ts
  Modify: client/src/types.ts
  Test:   server/src/workspaces.test.ts (created by T2)
  Test:   server/src/auth.test.ts (created by T2)
  Test:   server/src/routes/workspaceAccess.test.ts (created by T3)
  Test:   client/src/lib/workspaceSelection.test.ts (created by T6)

Rule: Workspace switcher
  Modify: client/src/context/BoardContext.tsx
  Modify: client/src/layout/Sidebar.tsx
  Modify: client/src/api.ts
  Modify: client/src/types.ts
  Test:   client/src/api.test.ts
  Test:   client/src/lib/workspaceSelection.test.ts (created by T6)
  Test:   client/src/lib/workspaceSwitcher.test.ts (created by T7)

Rule: Membership and roles
  Modify: server/src/routes.ts
  Modify: server/src/auth.ts
  Modify: client/src/api.ts
  Modify: client/src/types.ts
  Test:   server/src/routes/workspaceAccess.test.ts (created by T3)

Rule: Removal and real-time
  Modify: server/src/realtime.ts
  Modify: server/src/routes.ts
  Modify: client/src/context/BoardContext.tsx
  Test:   server/src/realtime.test.ts (created by T5)
  Test:   client/src/lib/workspaceSelection.test.ts (created by T6)

Rule: Migration
  Modify: server/src/db/schema.sql
  Modify: server/src/db/migrate.ts
  Modify: server/src/db/seed.ts
  Test:   server/src/db/workspaceMigration.test.ts (created by T1)

Rule: Deep links
  Modify: client/src/App.tsx
  Modify: client/src/components/ContextPanel.tsx
  Modify: client/src/context/BoardContext.tsx
  Test:   client/src/lib/cardPanel.test.ts
  Test:   client/src/lib/workspaceSelection.test.ts (created by T6)

Rule: Settings
  Modify: server/src/routes/settings.ts
  Modify: client/src/pages/SettingsPage.tsx
  Modify: client/src/api.ts
  Modify: client/src/types.ts
  Test:   server/src/routes/settings.test.ts
  Test:   client/src/api.test.ts
  Test:   client/src/lib/settingsValidation.test.ts
```

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

### Task 4: Workspace-scoped board, metrics, activity, and card APIs [depends: T3]

## OBJECTIVE

Move board data routes under `/api/workspaces/:workspaceId/...` and enforce workspace isolation for columns, cards, moves, metrics, activity, and card deep-link reads.

Files:
- Modify: `server/src/routes.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/types.ts`
- Test: `server/src/routes/workspaceAccess.test.ts`
- Test: `client/src/api.test.ts`

Steps:
1. Write failing test for: Cross-workspace board/card isolation.
   File: `server/src/routes/workspaceAccess.test.ts`
   Test verifies: Given user "oscar" is member of WS-A only, When oscar requests a card or board data in WS-B by ID, Then 404; Given board reads in WS-A, When columns/cards/events exist in WS-B, Then WS-B rows are absent.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import { createScopedBoardService } from "../routes.js";

   describe("scoped board service", () => {
     it("returns 404 for non-member card reads", async () => {
       const service = createScopedBoardService({
         getMembership: vi.fn(async (_workspaceId, userId) => (userId === 1 ? null : { role: "member" })),
         getCardById: vi.fn(async () => ({ id: 42, workspaceId: 2, title: "Hidden" })),
         getBoardRows: vi.fn(),
         getActivityRows: vi.fn(),
       });

       await expect(service.getCard({ userId: 1, workspaceId: 2, cardId: 42 }))
         .resolves.toEqual({ status: 404, error: "Not found" });
     });

     it("filters board rows to the requested workspace", async () => {
       const service = createScopedBoardService({
         getMembership: vi.fn(async () => ({ role: "member" })),
         getCardById: vi.fn(),
         getBoardRows: vi.fn(async (workspaceId) => [
           { id: 10, workspaceId, title: "WS-A column", cards: [{ id: 100, workspaceId, title: "Keep" }] },
         ]),
         getActivityRows: vi.fn(async (workspaceId) => [
           { id: 200, workspaceId, cardTitle: "Keep activity" },
         ]),
       });

       const board = await service.getBoard({ userId: 1, workspaceId: 1 });
       expect(board).toMatchObject({
         columns: [{ id: 10, workspaceId: 1, cards: [{ id: 100, workspaceId: 1 }] }],
         activity: [{ id: 200, workspaceId: 1 }],
       });
       expect(JSON.stringify(board)).not.toContain("WS-B");
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`
   Expected failure: board routes are still global and not path-prefixed.

3. Implement minimal code to satisfy the test:
   File: `server/src/routes.ts`
   Implement: path-prefixed board routes for board, columns, cards, card update/delete/move, metrics, metrics history, activity, and per-card activity; add workspace membership checks; constrain every query by `workspace_id`; keep optimistic locking and WIP behavior unchanged inside scoped queries.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`
   Expected: PASS

5. Write failing client API tests for scoped board paths.
   File: `client/src/api.test.ts`
   Test verifies: board, metrics, history, activity, presence, card, column, and move methods include `/workspaces/:workspaceId` in the request path.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";

   const mockFetch = vi.fn();
   vi.stubGlobal("fetch", mockFetch);

   describe("scoped board API paths", () => {
     it("prefixes board, metrics, activity, presence, and card methods with workspace id", async () => {
       mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
       const { api } = await import("./api");

       await api.getBoard(7);
       await api.getMetrics(7);
       await api.getMetricsHistory(7);
       await api.getActivity(7);
       await api.getPresence(7);
       await api.getCard(7, 42);
       await api.createCard(7, { columnId: 1, title: "New" });
       await api.moveCard(7, 42, { toColumnId: 2, position: 1000, version: 3 });

       const paths = mockFetch.mock.calls.map(([path]) => path);
       expect(paths).toEqual([
         "/api/workspaces/7/board",
         "/api/workspaces/7/metrics",
         "/api/workspaces/7/metrics/history",
         "/api/workspaces/7/activity",
         "/api/workspaces/7/presence",
         "/api/workspaces/7/cards/42",
         "/api/workspaces/7/cards",
         "/api/workspaces/7/cards/42/move",
       ]);
     });
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/api.test.ts`
   Expected failure: API wrapper methods currently call global paths.

7. Implement minimal code to satisfy the test:
   File: `client/src/api.ts`
   Implement: workspaceId argument or scoped API factory for all board methods.
   File: `client/src/types.ts`
   Implement: any additional response fields needed by scoped routes.

8. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts && npm run test --workspace=client -- src/api.test.ts`
   Expected: PASS

9. Commit:
   `git add server/src/routes.ts server/src/routes/workspaceAccess.test.ts client/src/api.ts client/src/api.test.ts client/src/types.ts`
   `git commit -m "feat(workspaces): scope board api"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — rules: Data isolation and real-time, Deep links.
server/src/routes.ts — current board, columns, cards, metrics, activity, presence, SSE routes.
client/src/api.ts — current global board method paths.

## WHY THIS APPROACH

Complexity: deep
Justification: Board scoping spans many routes, but all are in one router file and share the same membership/query boundary.

## SANDWICH CONTEXT

[CRITICAL: All board, metrics, activity, and card queries must filter by workspace membership and `workspace_id`.]
You are implementing scoped board APIs for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: API path prefix `/api/workspaces/:id/...`.
Files in scope: `server/src/routes.ts`, `server/src/routes/workspaceAccess.test.ts`, `client/src/api.ts`, `client/src/api.test.ts`, `client/src/types.ts`
Test framework: Vitest colocated in `server/src/**/*.test.ts` and `client/src/**/*.test.ts`
Available after: T3
Architecture rule: keep core modules pure by passing only scoped rows into `computeFlowMetrics`, `computeMetricsHistory`, and WIP helpers.
[RESTATE: All board, metrics, activity, and card queries must filter by workspace membership and `workspace_id`.]

## DELIVERABLE

Given user "oscar" member of WS-A only, When oscar requests card in WS-B by ID, Then 404.
Given WS-A board read, When WS-B columns/cards/events exist, Then they are not returned.
Given card move in WS-A, When optimistic locking and WIP checks run, Then existing 409 behavior remains scoped to WS-A.
Given card not in active workspace, When client loads it through scoped API, Then the API returns 404 for the client to redirect silently.

All tests PASS. Commit exists with message matching `feat(workspaces): scope board api`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - All board/data queries include workspace membership and `workspace_id` filters.
  - Existing WIP, optimistic locking, activity recording, and soft delete semantics remain intact.
  - Client board APIs require an active workspace id.
  - Tests written before implementation.
  - Commit message follows conventional commits format.

Must-not-have:
  - No changes to `server/src/core/*`.
  - No cross-workspace dashboard or aggregation.
  - No slug-based URL routing.

Open question risks:
  - Deep links intentionally redirect to `/board` instead of auto-switching workspace.

Rollback note:
  - Partial deploy with scoped client and unscoped server is unsafe; deploy scoped API/client together or rollback both.

## STOP CONDITIONS

Done when: scoped API tests pass, client API path tests pass, commit created.
Uncertain when: any global route must remain for compatibility.
Escalate when: any route cannot distinguish non-member 404 from missing entity without leaking workspace existence.

---

### Task 5: Per-workspace realtime, presence, and removal events [depends: T3]

## OBJECTIVE

Scope Redis pub/sub, local SSE fallback, presence keys, and membership removal events per workspace.

Files:
- Modify: `server/src/realtime.ts`
- Modify: `server/src/routes.ts`
- Test: `server/src/realtime.test.ts`
- Test: `server/src/routes/workspaceAccess.test.ts`

Steps:
1. Write failing test for: Realtime workspace isolation and Redis degradation.
   File: `server/src/realtime.test.ts`
   Test verifies: Given WS-A and WS-B clients connected through local fallback, When event fires in WS-B, Then WS-A clients do not receive it; Given Redis channel naming, Then events publish to `camel:workspace:{id}:events`; Given presence keys, Then scans are restricted to `camel:workspace:{id}:presence:*`.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import {
     createRealtimeHub,
     workspaceEventChannel,
     workspacePresencePattern,
   } from "./realtime.js";

   describe("workspace realtime isolation", () => {
     it("keeps local fallback clients isolated by workspace", async () => {
       const hub = createRealtimeHub({ publisher: null, subscriber: null });
       const wsA = hub.connectLocalClient({ workspaceId: 1, userId: 10 });
       const wsB = hub.connectLocalClient({ workspaceId: 2, userId: 11 });

       await hub.publishEvent(2, { type: "card.created", cardId: 42 });

       expect(wsA.drain()).toEqual([]);
       expect(wsB.drain()).toEqual([{ type: "card.created", cardId: 42 }]);
     });

     it("uses workspace-specific Redis channels and presence key scans", async () => {
       expect(workspaceEventChannel(7)).toBe("camel:workspace:7:events");
       expect(workspacePresencePattern(7)).toBe("camel:workspace:7:presence:*");

       const publish = vi.fn(async () => 1);
       const scanIterator = vi.fn(async function* () {
         yield "camel:workspace:7:presence:1";
       });
       const hub = createRealtimeHub({ publisher: { publish }, subscriber: null, presence: { scanIterator } });

       await hub.publishEvent(7, { type: "card.updated", cardId: 5 });
       await hub.onlineUsers(7);

       expect(publish).toHaveBeenCalledWith("camel:workspace:7:events", expect.any(String));
       expect(scanIterator).toHaveBeenCalledWith({ MATCH: "camel:workspace:7:presence:*" });
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/realtime.test.ts`
   Expected failure: realtime uses global channel, global presence prefix, and global local client set.

3. Implement minimal code to satisfy the test:
   File: `server/src/realtime.ts`
   Implement: workspace-aware `publishEvent`, `sseHandler`, `heartbeat`, `clearPresence`, and `onlineUsers`; per-workspace Redis channels; per-workspace local client registry; graceful degradation unchanged.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/realtime.test.ts`
   Expected: PASS

5. Write failing route test for: membership removal event.
   File: `server/src/routes/workspaceAccess.test.ts`
   Test verifies: Given nina is removed from WS-R, When removal succeeds, Then `membership.removed` is published to WS-R and includes removed user id and workspace name; Given nina is removed from WS-R while viewing WS-S, Then no WS-S event is published.
   Test code:
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import { createWorkspaceAccessService } from "../routes.js";

   describe("membership removal events", () => {
     it("publishes membership.removed only to the removed workspace", async () => {
       const publishEvent = vi.fn(async () => undefined);
       const clearPresence = vi.fn(async () => undefined);
       const service = createWorkspaceAccessService({
         getActorMembership: vi.fn(async () => ({ userId: 1, role: "admin" })),
         getWorkspaceOwner: vi.fn(async () => ({ userId: 1, role: "owner" })),
         getWorkspace: vi.fn(async () => ({ id: 8, name: "WS-R" })),
         removeMember: vi.fn(async () => ({ userId: 4, username: "nina" })),
         publishEvent,
         clearPresence,
       });

       await service.removeMember({ actorId: 1, workspaceId: 8, userId: 4 });

       expect(publishEvent).toHaveBeenCalledWith(8, {
         type: "membership.removed",
         userId: 4,
         workspaceId: 8,
         workspaceName: "WS-R",
       });
       expect(publishEvent).not.toHaveBeenCalledWith(9, expect.anything());
       expect(clearPresence).toHaveBeenCalledWith(8, 4);
     });
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`
   Expected failure: removal does not emit workspace-scoped `membership.removed`.

7. Implement minimal code to satisfy the test:
   File: `server/src/routes.ts`
   Implement: publish workspace-scoped `membership.removed` after member removal and delete presence for removed user in that workspace.

8. Run test — verify PASS:
   `npm run test --workspace=server -- src/realtime.test.ts src/routes/workspaceAccess.test.ts`
   Expected: PASS

9. Commit:
   `git add server/src/realtime.ts server/src/realtime.test.ts server/src/routes.ts server/src/routes/workspaceAccess.test.ts`
   `git commit -m "feat(workspaces): isolate realtime events"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — rules: Removal and real-time, Data isolation and real-time.
server/src/realtime.ts — current Redis Pub/Sub, SSE local fan-out, presence scan implementation.
Redis Node.js Client docs — `scanIterator`, `mGet`, `subscribe`, and `publish` usage.

## WHY THIS APPROACH

Complexity: standard
Justification: Event producer/consumer isolation is independent after workspace route contracts exist and can run parallel to board query scoping.

## SANDWICH CONTEXT

[CRITICAL: Redis-down local fan-out must still filter events by active workspace.]
You are implementing per-workspace realtime for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: Redis channels `camel:workspace:{id}:events`; presence keys `camel:workspace:{id}:presence:{userId}`.
Files in scope: `server/src/realtime.ts`, `server/src/realtime.test.ts`, `server/src/routes.ts`, `server/src/routes/workspaceAccess.test.ts`
Test framework: Vitest colocated in `server/src/**/*.test.ts`
Available after: T3
Architecture rule: preserve Redis degradation semantics while preventing cross-workspace event delivery.
[RESTATE: Redis-down local fan-out must still filter events by active workspace.]

## DELIVERABLE

Given oscar SSE connected to WS-A, When card created in WS-B, Then oscar does not receive that event.
Given Redis is down and local fan-out is used, When event fires in WS-B, Then WS-A clients do not refresh.
Given user "nina" is viewing WS-R and has personal workspace WS-N, When admin removes nina from WS-R, Then SSE event `membership.removed` is delivered for WS-R.
Given nina is viewing WS-S, When nina is removed from WS-R, Then no redirect-triggering event occurs for WS-S.

All tests PASS. Commit exists with message matching `feat(workspaces): isolate realtime events`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - Redis channel and local fallback both include workspace separation.
  - Presence list is per workspace.
  - Unknown event fields are tolerated by clients.
  - Tests written before implementation.
  - Commit message follows conventional commits format.

Must-not-have:
  - No global SSE channel remains for board events.
  - No cross-workspace event delivery.
  - No changes to `server/src/core/*`.

Open question risks:
  - Personal workspace redirect depends on `is_personal` being reliable.

Rollback note:
  - Partial deploy risks stale client reconnects; keep old and new event paths aligned during deployment.

## STOP CONDITIONS

Done when: realtime tests pass, removal event route test passes, commit created.
Uncertain when: Redis client cannot subscribe dynamically per workspace without a connection strategy adjustment.
Escalate when: local fallback cannot know each client's workspace id.

---

### Task 6: Client workspace selection state and scoped data context [depends: T4, T5]

## OBJECTIVE

Add active workspace state to the client root, restore last-active workspace, load/scope all board context by workspace, reconnect SSE, handle membership removal redirect, and silently clear invalid card deep links.

Files:
- Modify: `client/src/App.tsx`
- Modify: `client/src/context/BoardContext.tsx`
- Modify: `client/src/components/ContextPanel.tsx`
- Modify: `client/src/api.ts`
- Modify: `client/src/types.ts`
- Test: `client/src/lib/workspaceSelection.test.ts`
- Test: `client/src/api.test.ts`
- Test: `client/src/lib/cardPanel.test.ts`

Steps:
1. Write failing test for: workspace selection state decisions.
   File: `client/src/lib/workspaceSelection.test.ts`
   Test verifies: Given last-active workspace valid, When session initializes, Then restore it; Given single workspace and no saved id, Then auto-land; Given invalid saved workspace, Then picker state is required and saved id is cleared; Given removal from active workspace with personal workspace available, Then redirect target is personal workspace and toast copy is "You were removed from {name}."
   Test code:
   ```ts
   import { describe, expect, it } from "vitest";
   import {
     WORKSPACE_STORAGE_KEY,
     chooseInitialWorkspace,
     getRemovalRedirect,
     planWorkspaceRefresh,
   } from "./workspaceSelection";

   const wsA = { id: 1, name: "WS-A", role: "member", isPersonal: false };
   const wsB = { id: 2, name: "WS-B", role: "admin", isPersonal: false };
   const personal = { id: 3, name: "Nina's Workspace", role: "owner", isPersonal: true };

   describe("workspace selection", () => {
     it("restores a valid saved workspace", () => {
       expect(chooseInitialWorkspace({ workspaces: [wsA, wsB], savedWorkspaceId: 1 })).toEqual({
         activeWorkspaceId: 1,
         pickerRequired: false,
         clearSavedWorkspace: false,
       });
     });

     it("auto-lands in the only workspace when no saved id exists", () => {
       expect(chooseInitialWorkspace({ workspaces: [personal], savedWorkspaceId: null })).toMatchObject({
         activeWorkspaceId: 3,
         pickerRequired: false,
       });
     });

     it("requires picker and clears invalid saved workspace", () => {
       expect(chooseInitialWorkspace({ workspaces: [wsA, wsB], savedWorkspaceId: 99 })).toEqual({
         activeWorkspaceId: null,
         pickerRequired: true,
         clearSavedWorkspace: true,
       });
       expect(WORKSPACE_STORAGE_KEY).toBe("activeWorkspaceId");
     });

     it("redirects removal from active workspace to personal workspace with product copy", () => {
       expect(getRemovalRedirect({
         activeWorkspaceId: 8,
         removedWorkspaceId: 8,
         removedWorkspaceName: "WS-R",
         workspaces: [personal],
       })).toEqual({
         nextWorkspaceId: 3,
         toast: "You were removed from WS-R.",
       });
     });

     it("plans all scoped refreshes and event reconnects on workspace switch", () => {
       expect(planWorkspaceRefresh(2)).toEqual([
         "close-event-stream",
         "load-board:2",
         "load-metrics:2",
         "load-activity:2",
         "load-presence:2",
         "load-settings:2",
         "open-event-stream:2",
       ]);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/workspaceSelection.test.ts`
   Expected failure: workspace selection helpers do not exist and BoardProvider has no active workspace state.

3. Implement minimal code to satisfy the test:
   File: `client/src/context/BoardContext.tsx`
   Implement: active workspace id, workspace list/invite state, last-active localStorage key, selection helper exports if needed for tests, scoped calls to board/metrics/activity/presence/settings, SSE reconnect to active workspace stream, membership removal handling, and refresh of all context on workspace switch.
   File: `client/src/App.tsx`
   Implement: initial workspace list check after session check and picker requirement state.
   File: `client/src/types.ts`
   Implement: client workspace selection state types if not already present.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workspaceSelection.test.ts`
   Expected: PASS

5. Write failing deep-link test.
   File: `client/src/lib/cardPanel.test.ts`
   Test verifies: Given card id is not found in active workspace, When context panel evaluates the route param after board load, Then it redirects to `/board` silently and no toast is produced.
   Test code:
   ```ts
   import { describe, expect, it } from "vitest";
   import { getMissingCardRedirect } from "./cardPanel";

   describe("workspace-aware card panel redirects", () => {
     it("silently replaces the route when the card is absent from the active workspace", () => {
       expect(getMissingCardRedirect({
         cardId: 42,
         boardLoaded: true,
         cardFound: false,
       })).toEqual({
         to: "/board",
         replace: true,
         toast: null,
       });
     });

     it("does not redirect while the board is still loading", () => {
       expect(getMissingCardRedirect({ cardId: 42, boardLoaded: false, cardFound: false })).toBeNull();
     });
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/cardPanel.test.ts`
   Expected failure: current helper finds missing cards but route redirect behavior is not workspace-aware.

7. Implement minimal code to satisfy the test:
   File: `client/src/components/ContextPanel.tsx`
   Implement: active-workspace-aware missing-card redirect to `/board` with `replace: true` and no toast.
   File: `client/src/context/BoardContext.tsx`
   Implement: exposed switch confirmation hook/state needed by UI tasks, without rendering UI yet.

8. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/workspaceSelection.test.ts src/lib/cardPanel.test.ts src/api.test.ts`
   Expected: PASS

9. Commit:
   `git add client/src/App.tsx client/src/context/BoardContext.tsx client/src/components/ContextPanel.tsx client/src/api.ts client/src/types.ts client/src/lib/workspaceSelection.test.ts client/src/lib/cardPanel.test.ts client/src/api.test.ts`
   `git commit -m "feat(workspaces): add active workspace context"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md — rules: Post-login workspace selection, Workspace switcher, Removal and real-time, Deep links.
client/src/context/BoardContext.tsx — current state/SSE owner.
client/src/App.tsx — current auth check and router provider.
client/src/components/ContextPanel.tsx — current route-driven card panel behavior.
React Router docs — `Navigate`, `useNavigate`, and `replace` programmatic navigation behavior.

## WHY THIS APPROACH

Complexity: deep
Justification: Client workspace context is the shared interface between API scoping, realtime, UI switcher, and deep-link behavior.

## SANDWICH CONTEXT

[CRITICAL: `BoardProvider` must keep all board/SSE state scoped to exactly one active workspace.]
You are implementing client active workspace state for Multi-Workspace MVP.
Spec: docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md
Design decision: Keep public client routes like `/board` and derive workspace context from `BoardContext`; use path prefix only for API.
Files in scope: `client/src/App.tsx`, `client/src/context/BoardContext.tsx`, `client/src/components/ContextPanel.tsx`, `client/src/api.ts`, `client/src/types.ts`, `client/src/lib/workspaceSelection.test.ts`, `client/src/lib/cardPanel.test.ts`, `client/src/api.test.ts`
Test framework: Vitest colocated in `client/src/**/*.test.ts`
Available after: T4, T5
Architecture rule: navigation must not tear down the app shell unnecessarily; `BoardProvider` remains above router.
[RESTATE: `BoardProvider` must keep all board/SSE state scoped to exactly one active workspace.]

## DELIVERABLE

Given user "alice" is member of WS-A and WS-B and localStorage activeWorkspaceId = WS-A, When alice logs in, Then board loads WS-A data and sidebar shows WS-A as active.
Given user "bob" is member of only WS-P and localStorage has no activeWorkspaceId, When bob logs in, Then bob lands on WS-P without picker.
Given user "carol" was removed from WS-X and localStorage activeWorkspaceId = WS-X, When carol logs in, Then workspace picker is shown and invalid localStorage value is cleared.
Given user switches workspace, When selected, Then board, metrics, activity, presence, settings reload for target workspace, localStorage updates, and SSE reconnects.
Given user "nina" is viewing WS-R and receives `membership.removed`, Then she redirects to personal workspace and sees "You were removed from WS-R."
Given card 42 belongs outside the active workspace, When `/board/card/42` loads, Then redirect to `/board` silently.

All tests PASS. Commit exists with message matching `feat(workspaces): add active workspace context`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
  - Active workspace state is single-source-of-truth for all scoped API calls.
  - SSE reconnects on workspace switch and closes the old stream.
  - Invalid saved workspace id is cleared from localStorage.
  - Deep-link miss redirects silently.
  - Tests written before implementation.
  - Commit message follows conventional commits format.

Must-not-have:
  - No slug-based URL routing.
  - No multi-tab storage sync events.
  - No per-workspace scroll/card-panel persistence.

Open question risks:
  - Multi-tab workspace sync intentionally remains last-write-wins.

Rollback note:
  - Client context must deploy with scoped server API; otherwise app has no board data source.

## STOP CONDITIONS

Done when: workspace selection and deep-link tests pass, commit created.
Uncertain when: app needs URL workspace routes after all despite design decision.
Escalate when: state scoping requires moving BoardProvider below router and breaking current shell persistence.

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

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|------------------|
| T1 | Workspace schema and idempotent migration foundation | prereq | deep | Migration creates default + personal workspaces idempotently |
| T2 | Workspace bootstrap in auth and shared membership helpers | T1 | standard | Signup creates personal workspace; invites remain pending; cap helper works |
| T3 | Workspace and membership management API | T2 | deep | Workspace CRUD, roles, invites, transfer, delete, uniform 404 |
| T4 | Workspace-scoped board, metrics, activity, and card APIs | T3 | deep | Board/card/activity queries are workspace-isolated |
| T5 | Per-workspace realtime, presence, and removal events | T3 | standard | Redis/local SSE and presence are workspace-filtered |
| T6 | Client workspace selection state and scoped data context | T4, T5 | deep | Restore picker logic, scoped refreshes, SSE reconnect, removal redirect |
| T7 | Workspace picker, switcher, invites, and create flow UI | T6 | standard | Sidebar switcher, picker, invite modal/popover, unsaved confirm |
| T8 | Workspace-scoped settings, permissions, and delete replacement | T6 | standard | Scoped settings; owner/admin edit; member 403; reset-app removed |
| T9 | End-to-end integration validation and legacy route cleanup | T7, T8 | standard | Full scoped workflow passes tests, lint, and build |
