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
		expect(plan.consumedInviteIds).toEqual([]);
	});

	it("keeps pending invites unconsumed on signup", () => {
		const plan = createSignupWorkspacePlan({
			user: { id: 5, username: "eve", displayName: "Eve" },
			pendingInvites: [
				{ id: 99, workspaceId: 7, username: "eve", role: "member" },
			],
		});

		expect(plan.personalWorkspace.name).toBe("Eve's Workspace");
		expect(plan.memberships).toEqual([
			{ userId: 5, role: "owner", personal: true },
		]);
		expect(plan.pendingInvites).toEqual([
			{ id: 99, workspaceId: 7, username: "eve", role: "member" },
		]);
		expect(plan.consumedInviteIds).toEqual([]);
	});
});
