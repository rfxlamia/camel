import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../auth.js";
import type { WorkspaceAccessDeps } from "./workspace-access-service.js";
import { createWorkspaceAccessService } from "./workspace-access-service.js";

const MEMBER_ACTOR: AuthUser = {
	id: 4,
	username: "nina",
	displayName: "Nina",
	email: null,
	emailVerified: true,
	needsUsername: false,
};

function createDeps(
	overrides: Partial<WorkspaceAccessDeps> = {},
): WorkspaceAccessDeps {
	return {
		getActorMembership: vi.fn(async () => ({ userId: 4, role: "member" })),
		getWorkspace: vi.fn(async () => ({ id: 8, name: "WS-R" })),
		getTargetMembership: vi.fn(),
		updateMemberRole: vi.fn(),
		removeMember: vi.fn(async () => ({
			userId: 4,
			username: "nina",
			focusSessionFinished: false,
		})),
		publishEvent: vi.fn(async () => undefined),
		clearPresence: vi.fn(async () => undefined),
		...overrides,
	};
}

describe("leaveMember", () => {
	it("rejects the workspace owner — 403 with transfer hint", async () => {
		const removeMember = vi.fn();
		const deps = createDeps({
			getActorMembership: vi.fn(async () => ({ userId: 1, role: "owner" })),
			removeMember,
		});
		const service = createWorkspaceAccessService(deps);

		const result = await service.leaveMember({
			userId: 1,
			actor: MEMBER_ACTOR,
			workspaceId: 8,
		});

		expect(result).toEqual({
			status: 403,
			error: "Transfer ownership before leaving this workspace",
		});
		expect(removeMember).not.toHaveBeenCalled();
	});

	it("returns 404 when the user is not a member", async () => {
		const removeMember = vi.fn();
		const deps = createDeps({
			getActorMembership: vi.fn(async () => null),
			removeMember,
		});
		const service = createWorkspaceAccessService(deps);

		const result = await service.leaveMember({
			userId: 4,
			actor: MEMBER_ACTOR,
			workspaceId: 8,
		});

		expect(result).toEqual({ status: 404, error: "Not found" });
		expect(removeMember).not.toHaveBeenCalled();
	});

	it("returns 404 when the workspace is missing", async () => {
		const removeMember = vi.fn();
		const deps = createDeps({
			getWorkspace: vi.fn(async () => null),
			removeMember,
		});
		const service = createWorkspaceAccessService(deps);

		const result = await service.leaveMember({
			userId: 4,
			actor: MEMBER_ACTOR,
			workspaceId: 8,
		});

		expect(result).toEqual({ status: 404, error: "Not found" });
		expect(removeMember).not.toHaveBeenCalled();
	});

	it("removes the leaver and publishes membership.removed", async () => {
		const publishEvent = vi.fn(async () => undefined);
		const clearPresence = vi.fn(async () => undefined);
		const removeMember = vi.fn(async () => ({
			userId: 4,
			username: "nina",
			focusSessionFinished: false,
		}));
		const deps = createDeps({ publishEvent, clearPresence, removeMember });
		const service = createWorkspaceAccessService(deps);

		const result = await service.leaveMember({
			userId: 4,
			actor: MEMBER_ACTOR,
			workspaceId: 8,
		});

		expect(result).toEqual({ status: 204 });
		expect(removeMember).toHaveBeenCalledWith(8, 4, MEMBER_ACTOR);
		expect(clearPresence).toHaveBeenCalledWith(8, 4);
		expect(publishEvent).toHaveBeenCalledTimes(1);
		expect(publishEvent).toHaveBeenCalledWith(8, {
			type: "membership.removed",
			userId: 4,
			workspaceId: 8,
			workspaceName: "WS-R",
		});
	});

	it("publishes focus_session.updated before membership.removed when a focus session finished", async () => {
		const publishEvent = vi.fn(async () => undefined);
		const deps = createDeps({
			publishEvent,
			removeMember: vi.fn(async () => ({
				userId: 4,
				username: "nina",
				focusSessionFinished: true,
			})),
		});
		const service = createWorkspaceAccessService(deps);

		await service.leaveMember({
			userId: 4,
			actor: MEMBER_ACTOR,
			workspaceId: 8,
		});

		expect(publishEvent).toHaveBeenCalledTimes(2);
		expect(publishEvent.mock.calls[0]).toEqual([
			8,
			{
				type: "focus_session.updated",
				userId: 4,
				workspaceId: 8,
				payload: { session: null },
			},
		]);
		expect(publishEvent.mock.calls[1]).toEqual([
			8,
			{
				type: "membership.removed",
				userId: 4,
				workspaceId: 8,
				workspaceName: "WS-R",
			},
		]);
	});

	it("returns 404 (not a thrown error) when a concurrent request already removed the member", async () => {
		const publishEvent = vi.fn(async () => undefined);
		const clearPresence = vi.fn(async () => undefined);
		const deps = createDeps({
			publishEvent,
			clearPresence,
			removeMember: vi.fn(async () => null),
		});
		const service = createWorkspaceAccessService(deps);

		const result = await service.leaveMember({
			userId: 4,
			actor: MEMBER_ACTOR,
			workspaceId: 8,
		});

		expect(result).toEqual({ status: 404, error: "Not found" });
		expect(publishEvent).not.toHaveBeenCalled();
		expect(clearPresence).not.toHaveBeenCalled();
	});
});
