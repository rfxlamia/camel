import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	lookupMembership: vi.fn(),
	checkActorCanManage: vi.fn(),
	inviteRows: vi.fn<unknown[]>(),
	memberRows: vi.fn<unknown[]>(),
	deletedRows: vi.fn<bigint>(),
}));

vi.mock("../../db/kysely.js", () => ({
	db: {
		selectFrom: vi.fn((table: string) => {
			const chain = {
				innerJoin: vi.fn(() => chain),
				select: vi.fn(() => chain),
				where: vi.fn(() => chain),
				orderBy: vi.fn(() => chain),
				execute: vi.fn(() =>
					table.includes("workspace_invites")
						? Promise.resolve(mocks.inviteRows())
						: Promise.resolve(mocks.memberRows()),
				),
			};
			return chain;
		}),
		deleteFrom: vi.fn(() => {
			const chain = {
				where: vi.fn(() => chain),
				executeTakeFirst: vi.fn(() =>
					Promise.resolve({ numDeletedRows: mocks.deletedRows() }),
				),
			};
			return chain;
		}),
	},
}));

vi.mock("../../lib/helpers.js", () => ({
	lookupMembership: mocks.lookupMembership,
	checkActorCanManage: mocks.checkActorCanManage,
	workspaceAccessService: {
		updateMemberRole: vi.fn(),
		removeMember: vi.fn(),
	},
}));

import { invitesRouter } from "./invites.js";
import { membersRouter } from "./members.js";

function createMembersApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 1, username: "alice" } as never;
		next();
	});
	app.use("/workspaces/:workspaceId", membersRouter);
	return app;
}

function createInvitesApp(username: string) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 1, username } as never;
		next();
	});
	app.use("/workspaces/:workspaceId", invitesRouter);
	return app;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.deletedRows.mockReturnValue(1n);
});

describe("GET /members pending invites exposure", () => {
	it("includes pending invites for a manage-capable requester", async () => {
		mocks.lookupMembership.mockResolvedValue("owner");
		mocks.checkActorCanManage.mockReturnValue({ allowed: true });
		mocks.memberRows.mockReturnValue([
			{
				user_id: 1,
				username: "alice",
				display_name: "Alice",
				role: "owner",
			},
		]);
		mocks.inviteRows.mockReturnValue([
			{ id: 3, username: "bob", role: "member" },
		]);

		const res = await request(createMembersApp()).get("/workspaces/7/members");

		expect(res.status).toBe(200);
		expect(res.body.members).toHaveLength(1);
		expect(res.body.invites).toEqual([
			{ id: 3, username: "bob", role: "member" },
		]);
	});

	it("omits invites for a plain member", async () => {
		mocks.lookupMembership.mockResolvedValue("member");
		mocks.checkActorCanManage.mockReturnValue({
			allowed: false,
			status: 404,
			error: "Not found",
		});
		mocks.memberRows.mockReturnValue([
			{
				user_id: 1,
				username: "alice",
				display_name: "Alice",
				role: "member",
			},
		]);

		const res = await request(createMembersApp()).get("/workspaces/7/members");

		expect(res.status).toBe(200);
		expect(res.body.members).toHaveLength(1);
		expect(res.body.invites).toBeUndefined();
	});
});

describe("DELETE /invites/:inviteId actor semantics", () => {
	it("lets the invited user decline their own invite (unchanged)", async () => {
		mocks.deletedRows.mockReturnValueOnce(1n);

		const res = await request(createInvitesApp("bob")).delete(
			"/workspaces/7/invites/3",
		);

		expect(res.status).toBe(204);
	});

	it("lets an owner/admin cancel any pending invite", async () => {
		mocks.deletedRows.mockReturnValueOnce(0n).mockReturnValueOnce(1n);
		mocks.lookupMembership.mockResolvedValue("admin");
		mocks.checkActorCanManage.mockReturnValue({ allowed: true });

		const res = await request(createInvitesApp("alice")).delete(
			"/workspaces/7/invites/3",
		);

		expect(res.status).toBe(204);
	});

	it("returns 404 for a plain member who is not the invitee", async () => {
		mocks.deletedRows.mockReturnValueOnce(0n);
		mocks.lookupMembership.mockResolvedValue("member");
		mocks.checkActorCanManage.mockReturnValue({
			allowed: false,
			status: 404,
			error: "Not found",
		});

		const res = await request(createInvitesApp("mallory")).delete(
			"/workspaces/7/invites/3",
		);

		expect(res.status).toBe(404);
	});

	it("returns 404 when the invite is already gone", async () => {
		mocks.deletedRows.mockReturnValueOnce(0n).mockReturnValueOnce(0n);
		mocks.lookupMembership.mockResolvedValue("owner");
		mocks.checkActorCanManage.mockReturnValue({ allowed: true });

		const res = await request(createInvitesApp("alice")).delete(
			"/workspaces/7/invites/3",
		);

		expect(res.status).toBe(404);
	});
});
