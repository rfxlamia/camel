import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	userRow: vi.fn<unknown>(),
	existingMembership: vi.fn<unknown>(),
	existingInvite: vi.fn<unknown>(),
	insertedInvite: vi.fn<unknown>(),
	inviteInsertError: vi.fn<Error | null>(),
	memberInsertExecute: vi.fn(),
	emit: vi.fn(),
	lookupMembership: vi.fn<unknown>(),
}));

vi.mock("../../db/kysely.js", () => ({
	db: {
		selectFrom: vi.fn((table: string) => {
			const chain = {
				select: vi.fn(() => chain),
				where: vi.fn(() => chain),
				executeTakeFirst: vi.fn(() => {
					if (table === "users") return Promise.resolve(mocks.userRow());
					if (table === "workspace_invites")
						return Promise.resolve(mocks.existingInvite());
					return Promise.resolve(mocks.existingMembership());
				}),
			};
			return chain;
		}),
		insertInto: vi.fn((table: string) => {
			const chain = {
				values: vi.fn(() => chain),
				onConflict: vi.fn(() => chain),
				returning: vi.fn(() => chain),
				executeTakeFirstOrThrow: vi.fn(() => {
					if (mocks.inviteInsertError()) throw mocks.inviteInsertError();
					return Promise.resolve(mocks.insertedInvite());
				}),
				execute: mocks.memberInsertExecute,
			};
			return chain;
		}),
	},
}));

vi.mock("../../events.js", () => ({
	domainBus: { emit: mocks.emit },
	EVENTS: { MEMBER_JOINED: "member.joined" },
}));

vi.mock("../../lib/helpers.js", () => ({
	lookupMembership: mocks.lookupMembership,
	workspaceAccessService: {
		updateMemberRole: vi.fn(),
		removeMember: vi.fn(),
	},
	checkActorCanManage: vi.fn(() => ({ allowed: true })),
}));

import { membersRouter } from "./members.js";

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 1, username: "alice" } as never;
		next();
	});
	app.use("/workspaces/:workspaceId", membersRouter);
	return app;
}

beforeEach(() => {
	vi.clearAllMocks();
	// Actor (id 1) is a member; targets are not unless a test overrides it.
	mocks.lookupMembership.mockImplementation(async (userId: number) =>
		userId === 1 ? "owner" : undefined,
	);
	mocks.inviteInsertError.mockReturnValue(null);
	mocks.insertedInvite.mockReturnValue({
		id: 9,
		workspace_id: 7,
		username: "bob",
		role: "member",
	});
});

describe("POST /members always invites", () => {
	it("creates a pending invite for an existing user instead of adding them directly", async () => {
		mocks.userRow.mockReturnValue({
			id: 2,
			username: "bob",
			display_name: "Bob",
		});
		mocks.existingMembership.mockReturnValue(undefined);

		const res = await request(createApp())
			.post("/workspaces/7/members")
			.send({ username: "bob" });

		expect(res.status).toBe(201);
		expect(res.body).toEqual({
			id: 9,
			workspaceId: 7,
			username: "bob",
			role: "member",
			pending: true,
		});
		expect(mocks.memberInsertExecute).not.toHaveBeenCalled();
		expect(mocks.emit).not.toHaveBeenCalled();
	});

	it("returns 409 when the existing user is already a member", async () => {
		mocks.userRow.mockReturnValue({
			id: 2,
			username: "bob",
			display_name: "Bob",
		});
		mocks.lookupMembership.mockImplementation(async (userId: number) =>
			userId === 1 ? "owner" : "member",
		);

		const res = await request(createApp())
			.post("/workspaces/7/members")
			.send({ username: "bob" });

		expect(res.status).toBe(409);
		expect(res.body).toEqual({
			error: "User is already a member of this workspace",
		});
	});

	it("still invites a user that does not exist yet", async () => {
		mocks.userRow.mockReturnValue(undefined);

		const res = await request(createApp())
			.post("/workspaces/7/members")
			.send({ username: "carol" });

		expect(res.status).toBe(201);
		expect(res.body.pending).toBe(true);
	});

	it("returns 409 when an invite is already pending for the username", async () => {
		mocks.userRow.mockReturnValue(undefined);
		mocks.existingInvite.mockReturnValue({ id: 5 });

		const res = await request(createApp())
			.post("/workspaces/7/members")
			.send({ username: "bob" });

		expect(res.status).toBe(409);
		expect(res.body).toEqual({
			error: "Invite already pending for this username",
		});
	});

	it("maps a unique-constraint race on the invite insert to 409", async () => {
		mocks.userRow.mockReturnValue(undefined);
		mocks.inviteInsertError.mockReturnValue(
			Object.assign(new Error("duplicate key"), { code: "23505" }),
		);

		const res = await request(createApp())
			.post("/workspaces/7/members")
			.send({ username: "bob" });

		expect(res.status).toBe(409);
		expect(res.body).toEqual({
			error: "Invite already pending for this username",
		});
	});
});
