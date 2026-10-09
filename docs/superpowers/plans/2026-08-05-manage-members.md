# Manage Members — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Manage Members card in Settings that lists workspace members and lets admins/owners remove members and lets owners change roles (Member ↔ Admin).

**Architecture:** Extend `workspaceAccessService` with role-update logic and a self-removal guard on the existing delete path; add `PATCH /members/:userId` with supertest coverage in `members.mutations.test.ts` (PATCH + DELETE). UI tests precede component implementation (Task 6 → Task 7, **single commit** after tests pass). No SSE for role changes in v1.

**Tech Stack:** Express 5 + Kysely (server), React 18 + Vitest + Testing Library (client), NodeNext ESM (`.js` extensions on server imports).

## Global Constraints

- Server imports MUST use `.js` extensions (NodeNext ESM).
- Client imports use bundler resolution (no extensions).
- Run tests from repo root: `npm run test -- <full-path>` — do NOT use `npx vitest run` directly.
- `noUnusedLocals` / `noUnusedParameters` enabled on client — no unused imports.
- Biome for lint/format; React hooks rules enforced in `client/src/`.
- Activity logging (`recordActivity`) is NOT required for membership changes (existing remove path does not use it).
- Permission matrix from spec: view = all members; remove = admin + owner (not owner row, not self); role change = owner only.
- Self-removal returns `403` with message `"Cannot remove yourself"`.
- Role PATCH returns `404` for non-owner actors (stealth, same as `checkActorCanManage` for members).
- Role changes do **not** publish SSE events in v1 (unlike `membership.removed`). Other clients see updated roles only after refresh — intentional YAGNI; do not add realtime unless spec expands.
- Do NOT commit files under `docs/`.

## File Structure

| File | Responsibility |
|------|----------------|
| `server/src/routes/helpers.ts` | `checkCanRemoveUser` (add self guard), `checkActorCanChangeRole`, `updateMemberRole` on `workspaceAccessService` |
| `server/src/routes/members.ts` | `PATCH /members/:userId` route handler |
| `server/src/routes/members.mutations.test.ts` | Supertest unit tests for PATCH + DELETE routes (mocked service) |
| `server/src/routes/members-role.patch.integration.test.ts` | Optional real-DB PATCH integration test (`RUN_INTEGRATION=1`) |
| `server/src/routes.ts` | Re-export `checkActorCanChangeRole` |
| `server/src/routes/workspaceAccess.test.ts` | Unit tests for auth helpers + service methods |
| `client/src/api.ts` | `removeWorkspaceMember`, `updateWorkspaceMemberRole` |
| `client/src/api.test.ts` | Assert new fetch URLs/methods |
| `client/src/components/settings/ManageMembersSection.tsx` | Member list UI, remove modal, role dropdown |
| `client/src/components/settings/ManageMembersSection.test.tsx` | Permission rendering + interaction tests |
| `client/src/pages/SettingsPage.tsx` | Render card, pass props, bump `refreshKey` after invite |

---

### Task 1: Self-removal guard on `checkCanRemoveUser`

**Files:**
- Modify: `server/src/routes/helpers.ts:67-79` (function signature + body)
- Modify: `server/src/routes/helpers.ts:242-248` (call site in `removeMember`)
- Modify: `server/src/routes/workspaceAccess.test.ts:28-35`
- Test: `server/src/routes/workspaceAccess.test.ts`

**Interfaces:**
- Consumes: existing `AuthCheck` type
- Produces: `checkCanRemoveUser(actorId: number, targetUserId: number, targetRole: string): AuthCheck`

> **Signature migration:** Current signature is `(actorRole: string, targetRole: string)` — the `_actorRole` param is unused. Replace with `(actorId: number, targetUserId: number, targetRole: string)` so self-removal compares user IDs, not roles. Update the call site in `removeMember` and the existing tests (which currently pass role strings as the first two args).

- [ ] **Step 1: Write the failing test**

Add to `describe("workspace authorization rules")` in `server/src/routes/workspaceAccess.test.ts`:

```ts
it("blocks self-removal — returns 403", () => {
	expect(checkCanRemoveUser(5, 5, "admin")).toEqual({
		allowed: false,
		status: 403,
		error: "Cannot remove yourself",
	});
});
```

Update existing `checkCanRemoveUser` calls to pass actor/target IDs:

```ts
expect(checkCanRemoveUser(1, 2, "owner")).toEqual({
	allowed: false,
	status: 403,
	error: "Cannot remove workspace owner",
});
expect(checkCanRemoveUser(1, 2, "member")).toEqual({ allowed: true });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- server/src/routes/workspaceAccess.test.ts`

Expected: FAIL — self-removal not blocked yet; existing tests may fail on arity change.

- [ ] **Step 3: Write minimal implementation**

In `server/src/routes/helpers.ts`, replace `checkCanRemoveUser`:

```ts
export function checkCanRemoveUser(
	actorId: number,
	targetUserId: number,
	targetRole: string,
): AuthCheck {
	if (actorId === targetUserId) {
		return {
			allowed: false,
			status: 403,
			error: "Cannot remove yourself",
		};
	}
	if (targetRole === "owner") {
		return {
			allowed: false,
			status: 403,
			error: "Cannot remove workspace owner",
		};
	}
	return { allowed: true };
}
```

Update call site inside `createWorkspaceAccessService.removeMember`:

```ts
const canRemove = checkCanRemoveUser(
	actorId,
	userId,
	targetMembership.role,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- server/src/routes/workspaceAccess.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/helpers.ts server/src/routes/workspaceAccess.test.ts
git commit -m "$(cat <<'EOF'
fix(server): block self-removal in workspace member delete

EOF
)"
```

---

### Task 2: `checkActorCanChangeRole` helper

**Files:**
- Modify: `server/src/routes/helpers.ts` (add function after `checkActorCanManage`)
- Modify: `server/src/routes.ts:20-36` (re-export)
- Test: `server/src/routes/workspaceAccess.test.ts`

**Interfaces:**
- Consumes: `AuthCheck` type
- Produces: `checkActorCanChangeRole(role: string): AuthCheck`

- [ ] **Step 1: Write the failing test**

```ts
import {
	// ...existing imports
	checkActorCanChangeRole,
} from "../routes.js";

it("blocks non-owner from changing roles — returns 404", () => {
	expect(checkActorCanChangeRole("member")).toEqual({
		allowed: false,
		status: 404,
		error: "Not found",
	});
	expect(checkActorCanChangeRole("admin")).toEqual({
		allowed: false,
		status: 404,
		error: "Not found",
	});
});

it("allows owner to change roles", () => {
	expect(checkActorCanChangeRole("owner")).toEqual({ allowed: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- server/src/routes/workspaceAccess.test.ts`

Expected: FAIL — `checkActorCanChangeRole` not defined

- [ ] **Step 3: Write minimal implementation**

In `server/src/routes/helpers.ts`:

```ts
export function checkActorCanChangeRole(role: string): AuthCheck {
	if (role === "owner") return { allowed: true };
	return { allowed: false, status: 404, error: "Not found" };
}
```

In `server/src/routes.ts`, add to re-export block:

```ts
checkActorCanChangeRole,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- server/src/routes/workspaceAccess.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/helpers.ts server/src/routes.ts server/src/routes/workspaceAccess.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add owner-only role change authorization helper

EOF
)"
```

---

### Task 3: `updateMemberRole` on `workspaceAccessService`

**Files:**
- Modify: `server/src/routes/helpers.ts` (`WorkspaceAccessDeps`, `createWorkspaceAccessService`, default deps)
- Test: `server/src/routes/workspaceAccess.test.ts`

**Interfaces:**
- Consumes: `checkActorCanChangeRole`, `lookupMembership` pattern via deps
- Produces:
  ```ts
  updateMemberRole(args: {
    actorId: number;
    workspaceId: number;
    userId: number;
    role: "admin" | "member";
  }): Promise<
    | { status: 200; member: { userId: number; username: string; displayName: string; role: string } }
    | { status: 400; error: string }
    | { status: 403; error: string }
    | { status: 404; error: string }
  >
  ```

- [ ] **Step 1: Write the failing tests**

Add `describe("updateMemberRole")` to `workspaceAccess.test.ts`:

```ts
describe("updateMemberRole", () => {
	const baseMember = {
		userId: 4,
		username: "nina",
		displayName: "Nina",
		role: "member" as const,
	};

	it("returns 404 when actor is not owner", async () => {
		const service = createWorkspaceAccessService({
			getActorMembership: vi.fn(async () => ({ userId: 1, role: "admin" })),
			getWorkspace: vi.fn(),
			getTargetMembership: vi.fn(),
			updateMemberRole: vi.fn(),
			removeMember: vi.fn(),
			publishEvent: vi.fn(),
			clearPresence: vi.fn(),
		});
		const result = await service.updateMemberRole({
			actorId: 1,
			workspaceId: 8,
			userId: 4,
			role: "admin",
		});
		expect(result).toEqual({ status: 404, error: "Not found" });
	});

	it("returns 403 when target is owner", async () => {
		const service = createWorkspaceAccessService({
			getActorMembership: vi.fn(async () => ({ userId: 1, role: "owner" })),
			getWorkspace: vi.fn(),
			getTargetMembership: vi.fn(async () => ({ userId: 2, role: "owner" })),
			updateMemberRole: vi.fn(),
			removeMember: vi.fn(),
			publishEvent: vi.fn(),
			clearPresence: vi.fn(),
		});
		const result = await service.updateMemberRole({
			actorId: 1,
			workspaceId: 8,
			userId: 2,
			role: "admin",
		});
		expect(result).toEqual({
			status: 403,
			error: "Cannot change workspace owner role",
		});
	});

	it("promotes member to admin on happy path", async () => {
		const promotedMember = { ...baseMember, role: "admin" as const };
		const updateMemberRole = vi.fn(async (_ws, _uid, role) => ({
			...baseMember,
			role,
		}));
		const service = createWorkspaceAccessService({
			getActorMembership: vi.fn(async () => ({ userId: 1, role: "owner" })),
			getWorkspace: vi.fn(),
			getTargetMembership: vi.fn(async () => ({ userId: 4, role: "member" })),
			updateMemberRole,
			removeMember: vi.fn(),
			publishEvent: vi.fn(),
			clearPresence: vi.fn(),
		});
		const result = await service.updateMemberRole({
			actorId: 1,
			workspaceId: 8,
			userId: 4,
			role: "admin",
		});
		expect(result).toEqual({ status: 200, member: promotedMember });
		expect(updateMemberRole).toHaveBeenCalledWith(8, 4, "admin");
	});
});
```

Add to `describe("membership removal events")` in the same file (requires `updateMemberRole: vi.fn()` on every mock in that describe):

```ts
it("returns 403 when actor tries to remove themselves", async () => {
	const removeMember = vi.fn();
	const service = createWorkspaceAccessService({
		getActorMembership: vi.fn(async () => ({ userId: 5, role: "admin" })),
		getWorkspace: vi.fn(),
		getTargetMembership: vi.fn(async () => ({ userId: 5, role: "admin" })),
		updateMemberRole: vi.fn(),
		removeMember,
		publishEvent: vi.fn(),
		clearPresence: vi.fn(),
	});
	const result = await service.removeMember({
		actorId: 5,
		workspaceId: 8,
		userId: 5,
	});
	expect(result).toEqual({ status: 403, error: "Cannot remove yourself" });
	expect(removeMember).not.toHaveBeenCalled();
});
```

Update existing `createWorkspaceAccessService` mock setups in the same file to include `updateMemberRole: vi.fn()` in deps (TypeScript will require it once the type is added).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- server/src/routes/workspaceAccess.test.ts`

Expected: FAIL — `updateMemberRole` not on service / missing dep type

- [ ] **Step 3: Write minimal implementation**

Add to `WorkspaceAccessDeps`:

```ts
updateMemberRole: (
	workspaceId: number,
	userId: number,
	role: "admin" | "member",
) => Promise<{
	userId: number;
	username: string;
	displayName: string;
	role: string;
} | null>;
```

Add method to `createWorkspaceAccessService`:

```ts
async updateMemberRole({
	actorId,
	workspaceId,
	userId,
	role,
}: {
	actorId: number;
	workspaceId: number;
	userId: number;
	role: "admin" | "member";
}) {
	const actorMembership = await deps.getActorMembership(workspaceId, actorId);
	if (!actorMembership) return { status: 404 as const, error: "Not found" };

	const canChange = checkActorCanChangeRole(actorMembership.role);
	if (!canChange.allowed) {
		return { status: canChange.status, error: canChange.error };
	}

	if (role !== "admin" && role !== "member") {
		return { status: 400 as const, error: 'role must be "admin" or "member"' };
	}

	const targetMembership = await deps.getTargetMembership(workspaceId, userId);
	if (!targetMembership) return { status: 404 as const, error: "Not found" };

	if (targetMembership.role === "owner") {
		return {
			status: 403 as const,
			error: "Cannot change workspace owner role",
		};
	}

	const member = await deps.updateMemberRole(workspaceId, userId, role);
	if (!member) return { status: 404 as const, error: "Not found" };

	return { status: 200 as const, member };
},
```

Add default dep on `workspaceAccessService` (match `workspaces.ts` transaction + join select — no Kysely `updateTable...from` in this codebase):

```ts
updateMemberRole: async (workspaceId, userId, role) => {
	return db.transaction().execute(async (trx) => {
		const updated = await trx
			.updateTable("workspace_members")
			.set({ role })
			.where("workspace_id", "=", workspaceId)
			.where("user_id", "=", userId)
			.returning("user_id")
			.executeTakeFirst();
		if (!updated) return null;

		const row = await trx
			.selectFrom("workspace_members as wm")
			.innerJoin("users as u", "u.id", "wm.user_id")
			.select([
				"wm.user_id as user_id",
				"u.username as username",
				"u.display_name as display_name",
				"wm.role as role",
			])
			.where("wm.workspace_id", "=", workspaceId)
			.where("wm.user_id", "=", userId)
			.executeTakeFirst();

		if (!row) return null;
		return {
			userId: row.user_id,
			username: row.username as string,
			displayName: row.display_name as string,
			role: row.role as string,
		};
	});
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- server/src/routes/workspaceAccess.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/helpers.ts server/src/routes/workspaceAccess.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add updateMemberRole to workspace access service

EOF
)"
```

---

### Task 4: `PATCH` and `DELETE /members/:userId` routes

**Files:**
- Create: `server/src/routes/members.mutations.test.ts`
- Modify: `server/src/routes/members.ts` (add PATCH handler after GET, before DELETE)
- Create (optional): `server/src/routes/members-role.patch.integration.test.ts`
- Test: `server/src/routes/members.mutations.test.ts`

**Interfaces:**
- Consumes: `workspaceAccessService.updateMemberRole`, `workspaceAccessService.removeMember`
- Produces: HTTP `PATCH /api/workspaces/:workspaceId/members/:userId`, HTTP `DELETE` (existing route — add HTTP-level tests)

- [ ] **Step 1: Write the failing tests**

Create `server/src/routes/members.mutations.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateMemberRole = vi.fn();
const mockRemoveMember = vi.fn();

vi.mock("./helpers.js", () => ({
	workspaceAccessService: {
		updateMemberRole: (...args: unknown[]) => mockUpdateMemberRole(...args),
		removeMember: (...args: unknown[]) => mockRemoveMember(...args),
	},
	checkActorCanManage: vi.fn(),
	checkInviteeCap: vi.fn(),
	countUserMemberships: vi.fn(),
	lookupMembership: vi.fn(),
}));

import { membersRouter } from "./members.js";

function createApp(userId = 1) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: userId };
		next();
	});
	app.use("/workspaces/:workspaceId", membersRouter);
	return app;
}

describe("PATCH /members/:userId", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns 400 when role is invalid", async () => {
		const res = await request(createApp())
			.patch("/workspaces/7/members/3")
			.send({ role: "owner" });
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: 'role must be "admin" or "member"' });
		expect(mockUpdateMemberRole).not.toHaveBeenCalled();
	});

	it("returns 200 with member body on success", async () => {
		mockUpdateMemberRole.mockResolvedValue({
			status: 200,
			member: {
				userId: 3,
				username: "nina",
				displayName: "Nina",
				role: "admin",
			},
		});
		const res = await request(createApp())
			.patch("/workspaces/7/members/3")
			.send({ role: "admin" });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			userId: 3,
			username: "nina",
			displayName: "Nina",
			role: "admin",
		});
		expect(mockUpdateMemberRole).toHaveBeenCalledWith({
			actorId: 1,
			workspaceId: 7,
			userId: 3,
			role: "admin",
		});
	});

	it("maps service errors to HTTP status", async () => {
		mockUpdateMemberRole.mockResolvedValue({
			status: 404,
			error: "Not found",
		});
		const res = await request(createApp())
			.patch("/workspaces/7/members/3")
			.send({ role: "member" });
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "Not found" });
	});
});

describe("DELETE /members/:userId", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns 403 when actor tries to remove themselves", async () => {
		mockRemoveMember.mockResolvedValue({
			status: 403,
			error: "Cannot remove yourself",
		});
		const res = await request(createApp(5))
			.delete("/workspaces/7/members/5");
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: "Cannot remove yourself" });
		expect(mockRemoveMember).toHaveBeenCalledWith({
			actorId: 5,
			workspaceId: 7,
			userId: 5,
		});
	});

	it("returns 204 on successful removal", async () => {
		mockRemoveMember.mockResolvedValue({ status: 204 });
		const res = await request(createApp())
			.delete("/workspaces/7/members/3");
		expect(res.status).toBe(204);
		expect(mockRemoveMember).toHaveBeenCalledWith({
			actorId: 1,
			workspaceId: 7,
			userId: 3,
		});
	});

	it("maps service errors to HTTP status", async () => {
		mockRemoveMember.mockResolvedValue({
			status: 404,
			error: "Not found",
		});
		const res = await request(createApp())
			.delete("/workspaces/7/members/99");
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "Not found" });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- server/src/routes/members.mutations.test.ts`

Expected: FAIL — PATCH route not registered (404 or handler missing); DELETE tests may pass against existing route but self-removal 403 depends on Task 1 service changes.

- [ ] **Step 3: Write minimal implementation**

In `server/src/routes/members.ts`:

```ts
membersRouter.patch("/members/:userId", async (req, res) => {
	const { workspaceId: wsId, userId: uid } = req.params as {
		workspaceId: string;
		userId: string;
	};
	const workspaceId = Number(wsId);
	const targetUserId = Number(uid);
	if (!Number.isInteger(workspaceId) || !Number.isInteger(targetUserId)) {
		return res
			.status(400)
			.json({ error: "workspaceId and userId must be integers" });
	}

	const { role } = req.body ?? {};
	if (role !== "admin" && role !== "member") {
		return res.status(400).json({ error: 'role must be "admin" or "member"' });
	}

	const result = await workspaceAccessService.updateMemberRole({
		actorId: req.user!.id,
		workspaceId,
		userId: targetUserId,
		role,
	});

	if (result.status !== 200) {
		return res.status(result.status).json({ error: result.error });
	}

	const { member } = result;
	res.json({
		userId: member.userId,
		username: member.username,
		displayName: member.displayName,
		role: member.role,
	});
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- server/src/routes/members.mutations.test.ts`

Expected: PASS

- [ ] **Step 5: Run workspace access tests (no regressions)**

Run: `npm run test -- server/src/routes/workspaceAccess.test.ts`

Expected: PASS

- [ ] **Step 6 (optional): Integration test against real DB**

Create `server/src/routes/members-role.patch.integration.test.ts` gated behind `RUN_INTEGRATION=1`, following `members.notification.test.ts` setup (real DB fixtures, `membersRouter` mounted at `/workspaces/:workspaceId`).

Tests:
1. Owner promotes member → `200` + `workspace_members.role` is `admin` in DB (query via `db.selectFrom("workspace_members")...`)
2. Admin actor → `404`
3. Owner attempts self-removal via `DELETE` → `403`

Run: `RUN_INTEGRATION=1 npm run test -- server/src/routes/members-role.patch.integration.test.ts`

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/members.ts server/src/routes/members.mutations.test.ts
# include integration test file if Step 6 was done
git commit -m "$(cat <<'EOF'
feat(server): add PATCH endpoint and HTTP tests for member mutations

EOF
)"
```

---

### Task 5: Client API methods

**Files:**
- Modify: `client/src/api.ts` (after `addWorkspaceMember`)
- Modify: `client/src/api.test.ts:236-294`

**Interfaces:**
- Produces:
  ```ts
  removeWorkspaceMember(workspaceId: number, userId: number): Promise<void>
  updateWorkspaceMemberRole(
    workspaceId: number,
    userId: number,
    body: { role: "admin" | "member" },
  ): Promise<WorkspaceMember>
  ```

- [ ] **Step 1: Write the failing test**

In `describe("workspace API methods")`, after `addWorkspaceMember` call add:

```ts
await api.removeWorkspaceMember(7, 3);
await api.updateWorkspaceMemberRole(7, 3, { role: "admin" });
```

Add expectations:

```ts
expect(mockFetch).toHaveBeenCalledWith(
	"/api/workspaces/7/members/3",
	expect.objectContaining({ method: "DELETE" }),
);
expect(mockFetch).toHaveBeenCalledWith(
	"/api/workspaces/7/members/3",
	expect.objectContaining({ method: "PATCH" }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- client/src/api.test.ts`

Expected: FAIL — methods not defined

- [ ] **Step 3: Write minimal implementation**

In `client/src/api.ts`:

```ts
removeWorkspaceMember: (workspaceId: number, userId: number) =>
	request<void>(`/workspaces/${workspaceId}/members/${userId}`, {
		method: "DELETE",
	}),

updateWorkspaceMemberRole: (
	workspaceId: number,
	userId: number,
	body: { role: "admin" | "member" },
) =>
	request<WorkspaceMember>(`/workspaces/${workspaceId}/members/${userId}`, {
		method: "PATCH",
		body: JSON.stringify(body),
	}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- client/src/api.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/api.ts client/src/api.test.ts
git commit -m "$(cat <<'EOF'
feat(client): add workspace member remove and role update API methods

EOF
)"
```

---

### Task 6: `ManageMembersSection` tests (test-first)

**Files:**
- Create: `client/src/components/settings/ManageMembersSection.test.tsx`
- Test: `client/src/components/settings/ManageMembersSection.test.tsx`

**Interfaces:**
- Consumes: mocked `api.getWorkspaceMembers`, `api.removeWorkspaceMember`, `api.updateWorkspaceMemberRole`
- Component under test does not exist yet — import will fail until Task 7.

> **Do not commit after this task.** Tests will be red until Task 7 implements the component. Commit tests + component together in Task 7 Step 7 so `npm run test` stays green on every commit.

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/settings/ManageMembersSection.test.tsx`:

```tsx
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceMember } from "../../types";

const getWorkspaceMembers = vi.fn();
const removeWorkspaceMember = vi.fn();
const updateWorkspaceMemberRole = vi.fn();

vi.mock("../../api", () => ({
	api: {
		getWorkspaceMembers: (...a: unknown[]) => getWorkspaceMembers(...a),
		removeWorkspaceMember: (...a: unknown[]) => removeWorkspaceMember(...a),
		updateWorkspaceMemberRole: (...a: unknown[]) =>
			updateWorkspaceMemberRole(...a),
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
	},
}));

import ManageMembersSection from "./ManageMembersSection";
import { ApiError } from "../../api";

const owner: WorkspaceMember = {
	userId: 1,
	username: "owner",
	displayName: "Owner User",
	role: "owner",
};
const admin: WorkspaceMember = {
	userId: 2,
	username: "admin",
	displayName: "Admin User",
	role: "admin",
};
const member: WorkspaceMember = {
	userId: 3,
	username: "member",
	displayName: "Member User",
	role: "member",
};

const showToast = vi.fn();

function renderSection(role: "owner" | "admin" | "member", userId = 99) {
	render(
		<ManageMembersSection
			workspaceId={7}
			currentUserId={userId}
			currentUserRole={role}
			showToast={showToast}
		/>,
	);
}

beforeEach(() => {
	getWorkspaceMembers.mockResolvedValue({
		members: [owner, admin, member],
	});
	removeWorkspaceMember.mockResolvedValue(undefined);
	updateWorkspaceMemberRole.mockImplementation(
		async (_ws: number, userId: number, body: { role: string }) => ({
			...(userId === 3 ? member : admin),
			role: body.role,
		}),
	);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ManageMembersSection permissions", () => {
	it("member viewer sees badges only, no Remove buttons", async () => {
		renderSection("member");
		await waitFor(() => {
			expect(screen.getByText("Admin User")).toBeTruthy();
		});
		expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
	});

	it("admin viewer sees Remove for non-owner rows but no role dropdown", async () => {
		renderSection("admin", 2);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		const removeButtons = screen.getAllByRole("button", { name: "Remove" });
		expect(removeButtons.length).toBe(1);
		expect(screen.queryByRole("combobox")).toBeNull();
	});

	it("owner viewer sees role dropdowns and Remove for non-owner rows", async () => {
		renderSection("owner", 1);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		expect(screen.getAllByRole("combobox").length).toBe(2);
		expect(screen.getAllByRole("button", { name: "Remove" }).length).toBe(2);
	});
});

describe("ManageMembersSection interactions", () => {
	it("confirms remove and calls API", async () => {
		renderSection("admin", 2);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		const dialog = screen.getByRole("dialog", { name: "Confirm remove member" });
		expect(within(dialog).getByText(/Remove Member User\?/)).toBeTruthy();
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Confirm remove" }),
		);
		await waitFor(() => {
			expect(removeWorkspaceMember).toHaveBeenCalledWith(7, 3);
		});
	});

	it("calls PATCH on role change", async () => {
		renderSection("owner", 1);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		fireEvent.change(
			screen.getByLabelText("Role for Member User"),
			{ target: { value: "admin" } },
		);
		await waitFor(() => {
			expect(updateWorkspaceMemberRole).toHaveBeenCalledWith(7, 3, {
				role: "admin",
			});
		});
	});

	it("shows error toast when role update fails", async () => {
		updateWorkspaceMemberRole.mockRejectedValueOnce(
			new ApiError("Not found", 404),
		);
		renderSection("owner", 1);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		fireEvent.change(
			screen.getByLabelText("Role for Member User"),
			{ target: { value: "admin" } },
		);
		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith("Not found", "error");
		});
	});

	it("shows error toast when remove fails", async () => {
		removeWorkspaceMember.mockRejectedValueOnce(
			new ApiError("Cannot remove yourself", 403),
		);
		renderSection("admin", 2);
		await waitFor(() => {
			expect(screen.getByText("Member User")).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		fireEvent.click(
			within(
				screen.getByRole("dialog", { name: "Confirm remove member" }),
			).getByRole("button", { name: "Confirm remove" }),
		);
		await waitFor(() => {
			expect(showToast).toHaveBeenCalledWith(
				"Cannot remove yourself",
				"error",
			);
		});
	});

	it("shows retry UI when member list fails to load", async () => {
		getWorkspaceMembers.mockRejectedValueOnce(new Error("network"));
		renderSection("member");
		await waitFor(() => {
			expect(screen.getByText("Couldn't load members.")).toBeTruthy();
		});
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(showToast).toHaveBeenCalledWith(
			"Couldn't load members. Try again.",
			"error",
		);
	});

	it("re-fetches when refreshKey changes", async () => {
		const { rerender } = render(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				refreshKey={0}
				showToast={showToast}
			/>,
		);
		await waitFor(() => expect(getWorkspaceMembers).toHaveBeenCalledTimes(1));
		rerender(
			<ManageMembersSection
				workspaceId={7}
				currentUserId={1}
				currentUserRole="owner"
				refreshKey={1}
				showToast={showToast}
			/>,
		);
		await waitFor(() => expect(getWorkspaceMembers).toHaveBeenCalledTimes(2));
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- client/src/components/settings/ManageMembersSection.test.tsx`

Expected: FAIL — `ManageMembersSection` module not found

- [ ] **Step 3: Proceed to Task 7** (no commit — keep changes uncommitted or staged until Task 7 passes)

---

### Task 7: `ManageMembersSection` component + SettingsPage wiring

**Files:**
- Create: `client/src/components/settings/ManageMembersSection.tsx`
- Modify: `client/src/pages/SettingsPage.tsx`
- Test: `client/src/components/settings/ManageMembersSection.test.tsx`

**Interfaces:**
- Consumes: `api.getWorkspaceMembers`, `api.removeWorkspaceMember`, `api.updateWorkspaceMemberRole`, `initials` from `TrackerGlyphs`
- Props:
  ```ts
  interface ManageMembersSectionProps {
    workspaceId: number;
    currentUserId: number;
    currentUserRole: WorkspaceRole;
    refreshKey?: number;
    onMembersChanged?: () => void;
    showToast: (msg: string, type?: ToastType) => void;
  }
  ```

> **Note:** `SettingsSection` stays local to `SettingsPage.tsx` for now. Extract it only if more settings sub-components accumulate. Role `<select>` uses the same focus/hover classes as the Invite Member role picker in `SettingsPage.tsx` (lines 430–436).

- [ ] **Step 1: Create component**

Create `client/src/components/settings/ManageMembersSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../api";
import { initials } from "../tracker/TrackerGlyphs";
import type { ToastType } from "../../context/BoardContext";
import type { WorkspaceMember, WorkspaceRole } from "../../types";

function roleLabel(role: WorkspaceRole): string {
	if (role === "owner") return "Owner";
	if (role === "admin") return "Admin";
	return "Member";
}

export interface ManageMembersSectionProps {
	workspaceId: number;
	currentUserId: number;
	currentUserRole: WorkspaceRole;
	refreshKey?: number;
	onMembersChanged?: () => void;
	showToast: (msg: string, type?: ToastType) => void;
}

export default function ManageMembersSection({
	workspaceId,
	currentUserId,
	currentUserRole,
	refreshKey = 0,
	onMembersChanged,
	showToast,
}: ManageMembersSectionProps) {
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	const [pendingRemove, setPendingRemove] = useState<WorkspaceMember | null>(
		null,
	);
	const [removing, setRemoving] = useState(false);
	const [roleUpdatingId, setRoleUpdatingId] = useState<number | null>(null);

	const canRemove =
		currentUserRole === "admin" || currentUserRole === "owner";
	const canChangeRole = currentUserRole === "owner";

	const loadMembers = useCallback(async () => {
		setLoading(true);
		setLoadError(false);
		try {
			const { members: rows } = await api.getWorkspaceMembers(workspaceId);
			setMembers(rows);
		} catch {
			setLoadError(true);
			showToast("Couldn't load members. Try again.", "error");
		} finally {
			setLoading(false);
		}
	}, [workspaceId, showToast]);

	useEffect(() => {
		void loadMembers();
	}, [loadMembers, refreshKey]);

	async function handleRoleChange(member: WorkspaceMember, role: "admin" | "member") {
		if (role === member.role) return;
		setRoleUpdatingId(member.userId);
		try {
			const updated = await api.updateWorkspaceMemberRole(
				workspaceId,
				member.userId,
				{ role },
			);
			setMembers((prev) =>
				prev.map((m) => (m.userId === updated.userId ? updated : m)),
			);
			showToast("Role updated", "success");
		} catch (err: unknown) {
			const msg =
				err instanceof ApiError ? err.message : "Couldn't update role. Try again.";
			showToast(msg, "error");
		} finally {
			setRoleUpdatingId(null);
		}
	}

	async function handleConfirmRemove() {
		if (!pendingRemove) return;
		setRemoving(true);
		try {
			await api.removeWorkspaceMember(workspaceId, pendingRemove.userId);
			setMembers((prev) =>
				prev.filter((m) => m.userId !== pendingRemove.userId),
			);
			showToast("Member removed", "success");
			onMembersChanged?.();
		} catch (err: unknown) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Couldn't remove member. Try again.";
			showToast(msg, "error");
			if (err instanceof ApiError && err.status === 404) {
				void loadMembers();
			}
		} finally {
			setRemoving(false);
			setPendingRemove(null);
		}
	}

	if (loading) {
		return (
			<div className="space-y-3" aria-busy="true">
				{[1, 2, 3].map((n) => (
					<div
						key={n}
						className="h-12 animate-pulse rounded-md bg-neutral-100"
					/>
				))}
			</div>
		);
	}

	if (loadError) {
		return (
			<div className="text-sm text-neutral-600">
				<p>Couldn't load members.</p>
				<button
					type="button"
					onClick={() => void loadMembers()}
					className="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
				>
					Retry
				</button>
			</div>
		);
	}

	if (members.length === 0) {
		return <p className="text-sm text-neutral-600">No members yet</p>;
	}

	return (
		<>
			<ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
				{members.map((member) => {
					const isSelf = member.userId === currentUserId;
					const isOwnerRow = member.role === "owner";
					const showRemove =
						canRemove && !isSelf && !isOwnerRow;
					const showRoleDropdown =
						canChangeRole && !isOwnerRow;

					return (
						<li
							key={member.userId}
							className="flex items-center gap-3 px-3 py-2.5"
						>
							<div
								className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-800"
								aria-hidden="true"
							>
								{initials(member.displayName)}
							</div>
							<div className="min-w-0 flex-1">
								<div className="truncate text-sm font-medium text-neutral-900">
									{member.displayName}
								</div>
								<div className="truncate text-xs text-neutral-500">
									@{member.username}
								</div>
							</div>
							{showRoleDropdown ? (
								<select
									value={member.role}
									disabled={roleUpdatingId === member.userId}
									onChange={(e) =>
										void handleRoleChange(
											member,
											e.target.value as "admin" | "member",
										)
									}
									className="appearance-none rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 shadow-sm hover:border-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/15 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
									aria-label={`Role for ${member.displayName}`}
								>
									<option value="member">Member</option>
									<option value="admin">Admin</option>
								</select>
							) : (
								<span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
									{roleLabel(member.role)}
								</span>
							)}
							{showRemove && (
								<button
									type="button"
									onClick={() => setPendingRemove(member)}
									className="shrink-0 rounded-md border border-error-500 px-2.5 py-1 text-xs font-medium text-error-700 hover:bg-error-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-500"
								>
									Remove
								</button>
							)}
						</li>
					);
				})}
			</ul>

			{pendingRemove && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
					role="dialog"
					aria-modal="true"
					aria-label="Confirm remove member"
				>
					<div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
						<p className="font-medium text-neutral-800">
							Remove {pendingRemove.displayName}?
						</p>
						<p className="mt-1 text-sm text-neutral-500">
							They will lose access to this workspace and its boards.
						</p>
						<div className="mt-4 flex gap-2">
							<button
								type="button"
								onClick={() => setPendingRemove(null)}
								className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void handleConfirmRemove()}
								disabled={removing}
								aria-label="Confirm remove"
								className="flex-1 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
							>
								{removing ? "Removing..." : "Remove"}
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
```

- [ ] **Step 2: Wire into SettingsPage**

In `client/src/pages/SettingsPage.tsx`:

1. Import component:
   ```ts
   import ManageMembersSection from "../components/settings/ManageMembersSection";
   ```

2. Add state after invite state:
   ```ts
   const [membersRefreshKey, setMembersRefreshKey] = useState(0);
   ```

3. In `handleInviteMember` success block, after `setInviteUsername("")`:
   ```ts
   setMembersRefreshKey((k) => k + 1);
   void reloadWorkspaces();
   ```

4. Insert between Invite Member and Identity sections (visible to all members, not gated by `canEdit`):
   ```tsx
   <SettingsSection title="Manage Members">
     <ManageMembersSection
       workspaceId={activeWorkspaceId}
       currentUserId={user!.id}
       currentUserRole={activeWorkspace.role}
       refreshKey={membersRefreshKey}
       onMembersChanged={() => void reloadWorkspaces()}
       showToast={showToast}
     />
   </SettingsSection>
   ```

- [ ] **Step 3: Run component tests to verify they pass**

Run: `npm run test -- client/src/components/settings/ManageMembersSection.test.tsx`

Expected: PASS

- [ ] **Step 4: Typecheck client**

Run: `npm run typecheck --workspace=client`

Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm run test`

Expected: PASS

- [ ] **Step 6: Lint**

Run: `npm run lint`

Expected: PASS

- [ ] **Step 7: Commit** (tests from Task 6 + component + SettingsPage — single commit, all green)

```bash
git add client/src/components/settings/ManageMembersSection.tsx \
  client/src/components/settings/ManageMembersSection.test.tsx \
  client/src/pages/SettingsPage.tsx
git commit -m "$(cat <<'EOF'
feat(client): add Manage Members section to workspace settings

EOF
)"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| View list — all members | Task 7 (SettingsPage renders for all) |
| Remove — admin + owner | Task 1 (self guard) + Task 7 (UI) |
| Role change — owner only | Task 2–4 (backend) + Task 7 (dropdown) |
| Self-removal blocked | Task 1 (helper) + Task 3 (service) + Task 4 (DELETE HTTP) |
| Owner row protected | Task 3 + Task 7 |
| Separate card between Invite & Identity | Task 7 |
| Component extraction | Task 7 |
| `refreshKey` after invite | Task 7 |
| `onMembersChanged` → reload workspaces | Task 7 |
| Client API methods | Task 5 |
| PATCH endpoint + HTTP tests | Task 4 |
| DELETE self-removal HTTP test | Task 4 |
| Error handling / retry | Task 6–7 (load retry, ApiError toasts) |
| No SSE for role change (v1) | Global Constraints |
| Tests per spec | Tasks 1, 3, 4, 6, 7 |

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-08-05-manage-members.md` (local only, not committed).

**Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
