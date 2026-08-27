import { describe, expect, it, vi } from "vitest";
import {
	checkActorCanChangeRole,
	checkActorCanManage,
	checkCanRemoveUser,
	createScopedBoardService,
	createWorkspaceAccessService,
	createWorkspaceIntegrationHarness,
	legacyWorkspaceRouteMatrix,
	type WorkspaceAccessDeps,
} from "../routes.js";

describe("workspace authorization rules", () => {
	it("blocks member from managing — returns 404", () => {
		expect(checkActorCanManage("member")).toEqual({
			allowed: false,
			status: 404,
			error: "Not found",
		});
	});

	it("allows admin and owner to manage", () => {
		expect(checkActorCanManage("admin")).toEqual({ allowed: true });
		expect(checkActorCanManage("owner")).toEqual({ allowed: true });
	});

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

	it("blocks removal of owner — returns 403", () => {
		expect(checkCanRemoveUser(1, 2, "owner")).toEqual({
			allowed: false,
			status: 403,
			error: "Cannot remove workspace owner",
		});
		expect(checkCanRemoveUser(1, 2, "member")).toEqual({ allowed: true });
	});

	it("blocks self-removal — returns 403", () => {
		expect(checkCanRemoveUser(5, 5, "admin")).toEqual({
			allowed: false,
			status: 403,
			error: "Cannot remove yourself",
		});
	});
});

describe("scoped board service", () => {
	it("returns 404 for non-member card reads", async () => {
		const service = createScopedBoardService({
			getMembership: vi.fn(async (_workspaceId, userId) =>
				userId === 1 ? null : { role: "member" },
			),
			getCardById: vi.fn(async () => ({
				id: 42,
				workspaceId: 2,
				title: "Hidden",
			})),
			getBoardRows: vi.fn(),
			getActivityRows: vi.fn(),
		});

		await expect(
			service.getCard({ userId: 1, workspaceId: 2, cardId: 42 }),
		).resolves.toEqual({ status: 404, error: "Not found" });
	});

	it("filters board rows to the requested workspace", async () => {
		const service = createScopedBoardService({
			getMembership: vi.fn(async () => ({ role: "member" })),
			getCardById: vi.fn(),
			getBoardRows: vi.fn(async (workspaceId) => [
				{
					id: 10,
					workspaceId,
					title: "WS-A column",
					cards: [{ id: 100, workspaceId, title: "Keep" }],
				},
			]),
			getActivityRows: vi.fn(async (workspaceId) => [
				{ id: 200, workspaceId, cardTitle: "Keep activity" },
			]),
		});

		const board = await service.getBoard({ userId: 1, workspaceId: 1 });
		expect(board).toMatchObject({
			columns: [
				{ id: 10, workspaceId: 1, cards: [{ id: 100, workspaceId: 1 }] },
			],
			activity: [{ id: 200, workspaceId: 1 }],
		});
		expect(JSON.stringify(board)).not.toContain("WS-B");
	});
});

describe("membership removal events", () => {
	it("publishes membership.removed only to the removed workspace", async () => {
		const publishEvent = vi.fn(async () => undefined);
		const clearPresence = vi.fn(async () => undefined);
		const service = createWorkspaceAccessService({
			getActorMembership: vi.fn(async () => ({ userId: 1, role: "admin" })),
			getWorkspace: vi.fn(async () => ({ id: 8, name: "WS-R" })),
			getTargetMembership: vi.fn(async () => ({ userId: 4, role: "member" })),
			updateMemberRole: vi.fn(),
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

	it("returns 404 (not a thrown error) when a concurrent request already removed the member", async () => {
		const publishEvent = vi.fn(async () => undefined);
		const clearPresence = vi.fn(async () => undefined);
		const service = createWorkspaceAccessService({
			getActorMembership: vi.fn(async () => ({ userId: 1, role: "admin" })),
			getWorkspace: vi.fn(async () => ({ id: 8, name: "WS-R" })),
			// Target membership still existed when checked...
			getTargetMembership: vi.fn(async () => ({ userId: 4, role: "member" })),
			// ...but a concurrent request already deleted the row by the time
			// the actual DELETE runs.
			updateMemberRole: vi.fn(),
			removeMember: vi.fn(async () => null),
			publishEvent,
			clearPresence,
		});

		const result = await service.removeMember({
			actorId: 1,
			workspaceId: 8,
			userId: 4,
		});

		expect(result).toEqual({ status: 404, error: "Not found" });
		expect(publishEvent).not.toHaveBeenCalled();
		expect(clearPresence).not.toHaveBeenCalled();
	});

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
});

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
		const updateMemberRole: WorkspaceAccessDeps["updateMemberRole"] = vi.fn(
			async (_ws, _uid, role) => ({
				...baseMember,
				role,
			}),
		);
		const publishEvent = vi.fn(async () => undefined);
		const service = createWorkspaceAccessService({
			getActorMembership: vi.fn(async () => ({ userId: 1, role: "owner" })),
			getWorkspace: vi.fn(),
			getTargetMembership: vi.fn(async () => ({ userId: 4, role: "member" })),
			updateMemberRole,
			removeMember: vi.fn(),
			publishEvent,
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
		expect(publishEvent).toHaveBeenCalledWith(8, {
			type: "membership.role_changed",
			userId: 4,
			workspaceId: 8,
			role: "admin",
		});
	});

	it("returns 404 when updateMemberRole dep returns null", async () => {
		const service = createWorkspaceAccessService({
			getActorMembership: vi.fn(async () => ({ userId: 1, role: "owner" })),
			getWorkspace: vi.fn(),
			getTargetMembership: vi.fn(async () => ({ userId: 4, role: "member" })),
			updateMemberRole: vi.fn(async () => null),
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

	it("does not publish when role is unchanged", async () => {
		const publishEvent = vi.fn(async () => undefined);
		const updateMemberRole = vi.fn(async () => ({
			...baseMember,
			role: "member" as const,
		}));
		const service = createWorkspaceAccessService({
			getActorMembership: vi.fn(async () => ({ userId: 1, role: "owner" })),
			getWorkspace: vi.fn(),
			getTargetMembership: vi.fn(async () => ({ userId: 4, role: "member" })),
			updateMemberRole,
			removeMember: vi.fn(),
			publishEvent,
			clearPresence: vi.fn(),
		});
		const result = await service.updateMemberRole({
			actorId: 1,
			workspaceId: 8,
			userId: 4,
			role: "member",
		});
		expect(result).toEqual({ status: 200, member: baseMember });
		expect(publishEvent).not.toHaveBeenCalled();
	});
});

describe("workspace isolation and legacy route cleanup", () => {
	it("keeps cards and activity isolated through a create and switch flow", async () => {
		const app = createWorkspaceIntegrationHarness();
		const alice = await app.signIn("alice");
		const wsA = await app.createWorkspace(alice, "WS-A");
		const wsB = await app.createWorkspace(alice, "WS-B");
		const card = await app.createCard(alice, wsA.id, { title: "Only in A" });

		await expect(app.getCard(alice, wsB.id, card.id)).resolves.toEqual({
			status: 404,
		});
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
