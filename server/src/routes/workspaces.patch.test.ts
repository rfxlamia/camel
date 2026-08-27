import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLookupMembership = vi.fn();
vi.mock("./helpers.js", () => ({
	lookupMembership: (...args: unknown[]) => mockLookupMembership(...args),
	serializeWorkspaceList: vi.fn(),
}));

const mockExecuteTakeFirst = vi.fn();
const mockExecuteTakeFirstOrThrow = vi.fn();

vi.mock("../db/kysely.js", () => ({
	db: {
		updateTable: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn(() => ({
						executeTakeFirst: mockExecuteTakeFirst,
					})),
				})),
			})),
		})),
		selectFrom: vi.fn(() => ({
			select: vi.fn(() => ({
				where: vi.fn(() => ({
					executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
				})),
			})),
		})),
	},
}));

vi.mock("../auth.js", () => ({
	requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { workspacesRouter } from "./workspaces.js";

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 1, username: "alice", emailVerified: true };
		next();
	});
	app.use("/workspaces", workspacesRouter);
	return app;
}

describe("PATCH /workspaces/:workspaceId", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecuteTakeFirst.mockResolvedValue({
			id: 7,
			name: "Renamed",
			is_personal: false,
		});
		mockExecuteTakeFirstOrThrow.mockResolvedValue({ n: 3 });
	});

	it("returns 200 for owner with updated workspace", async () => {
		mockLookupMembership.mockResolvedValue("owner");

		const res = await request(createApp())
			.patch("/workspaces/7")
			.send({ name: "Renamed" });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			id: 7,
			name: "Renamed",
			role: "owner",
			isPersonal: false,
			memberCount: 3,
		});
	});

	it("returns 200 for admin", async () => {
		mockLookupMembership.mockResolvedValue("admin");

		const res = await request(createApp())
			.patch("/workspaces/7")
			.send({ name: "Renamed" });

		expect(res.status).toBe(200);
		expect(res.body.role).toBe("admin");
	});

	it("returns 403 for member", async () => {
		mockLookupMembership.mockResolvedValue("member");

		const res = await request(createApp())
			.patch("/workspaces/7")
			.send({ name: "Renamed" });

		expect(res.status).toBe(403);
		expect(res.body.error).toBe("Forbidden");
	});

	it("returns 404 when user is not a member", async () => {
		mockLookupMembership.mockResolvedValue(undefined);

		const res = await request(createApp())
			.patch("/workspaces/7")
			.send({ name: "Renamed" });

		expect(res.status).toBe(404);
	});

	it("returns 400 for empty name", async () => {
		mockLookupMembership.mockResolvedValue("owner");

		const res = await request(createApp())
			.patch("/workspaces/7")
			.send({ name: "   " });

		expect(res.status).toBe(400);
		expect(res.body.error).toBe("Name is required");
	});
});
