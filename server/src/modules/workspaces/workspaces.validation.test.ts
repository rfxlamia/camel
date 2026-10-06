import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLookupMembership = vi.fn();
vi.mock("../../lib/helpers.js", () => ({
	lookupMembership: (...args: unknown[]) => mockLookupMembership(...args),
	serializeWorkspaceList: vi.fn(),
	checkActorCanManage: vi.fn(() => ({ allowed: true })),
	workspaceAccessService: { updateMemberRole: vi.fn(), removeMember: vi.fn() },
}));
vi.mock("../../db/kysely.js", () => ({ db: {} }));
vi.mock("../../auth.js", () => ({
	requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { invitesRouter } from "./invites.js";
import { membersRouter } from "./members.js";
import { workspacesRouter } from "./workspaces.js";

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 1, username: "alice" } as express.Request["user"];
		next();
	});
	app.use("/workspaces", workspacesRouter);
	app.use("/workspaces/:workspaceId", membersRouter);
	app.use("/workspaces/:workspaceId", invitesRouter);
	return app;
}

const MEMBER_MSG = "workspaceId and userId must be integers";
const INVITE_MSG = "workspaceId and inviteId must be integers";

describe("workspace route validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLookupMembership.mockResolvedValue("owner");
	});

	it.each([
		["/workspaces/abc/members/3", MEMBER_MSG],
		["/workspaces/7/members/abc", MEMBER_MSG],
		["/workspaces/7/members/0", MEMBER_MSG],
		["/workspaces/0/members/3", MEMBER_MSG],
		["/workspaces/7/members/-1", MEMBER_MSG],
		["/workspaces/7/members/1.5", MEMBER_MSG],
	])("PATCH and DELETE %s -> 400", async (path, error) => {
		const app = createApp();
		const patch = await request(app).patch(path).send({ role: "admin" });
		expect(patch.status).toBe(400);
		expect(patch.body).toEqual({ error });
		const del = await request(app).delete(path);
		expect(del.status).toBe(400);
		expect(del.body).toEqual({ error });
	});

	it("invites accept/delete reject bad ids with the combined message", async () => {
		const app = createApp();
		for (const path of [
			"/workspaces/x/invites/1",
			"/workspaces/7/invites/0",
			"/workspaces/7/invites/abc",
		]) {
			const del = await request(app).delete(path);
			expect(del.status).toBe(400);
			expect(del.body).toEqual({ error: INVITE_MSG });
			const accept = await request(app).post(`${path}/accept`);
			expect(accept.status).toBe(400);
			expect(accept.body).toEqual({ error: INVITE_MSG });
		}
	});

	it("POST /members requires a non-blank username", async () => {
		const app = createApp();
		for (const body of [{}, { username: "   " }, { username: 5 }]) {
			const res = await request(app).post("/workspaces/7/members").send(body);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "username is required" });
		}
	});

	it("rejects an invalid workspaceId on PATCH/DELETE/transfer", async () => {
		const app = createApp();
		const expected = { error: "workspaceId must be an integer" };
		for (const res of [
			await request(app).patch("/workspaces/abc").send({ name: "x" }),
			await request(app).delete("/workspaces/abc"),
			await request(app)
				.post("/workspaces/abc/transfer-ownership")
				.send({ newOwnerId: 2 }),
		]) {
			expect(res.status).toBe(400);
			expect(res.body).toEqual(expected);
		}
	});

	it("transfer-ownership rejects a missing/non-integer newOwnerId and self-transfer", async () => {
		const app = createApp();
		for (const body of [{}, { newOwnerId: "2" }, { newOwnerId: 1.5 }]) {
			const res = await request(app)
				.post("/workspaces/7/transfer-ownership")
				.send(body);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "newOwnerId is required" });
		}
		const self = await request(app)
			.post("/workspaces/7/transfer-ownership")
			.send({ newOwnerId: 1 });
		expect(self.status).toBe(400);
		expect(self.body).toEqual({
			error: "Cannot transfer ownership to yourself",
		});
	});

	it("POST /workspaces keeps name validation messages", async () => {
		const app = createApp();
		const cases: [unknown, string][] = [
			[undefined, "name must be a string"],
			["   ", "Name is required"],
			["x".repeat(101), "name must be 100 characters or less"],
		];
		for (const [name, error] of cases) {
			const res = await request(app).post("/workspaces").send({ name });
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error });
		}
	});
});
