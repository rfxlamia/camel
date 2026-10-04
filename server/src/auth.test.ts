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
		expect(plan.memberships).toEqual([
			{ userId: 4, role: "owner", personal: true },
		]);
		expect(plan.pendingInvites).toEqual([]);
		expect(plan.consumedInviteIds).toEqual([]);
	});

	it("includes pending invites in the plan", () => {
		const plan = createSignupWorkspacePlan({
			user: { id: 1, username: "alice", displayName: "Alice" },
			pendingInvites: [
				{ id: 10, workspaceId: 100, username: "alice", role: "member" },
			],
		});
		expect(plan.pendingInvites).toHaveLength(1);
		expect(plan.pendingInvites[0].workspaceId).toBe(100);
	});
});
