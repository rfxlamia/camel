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
