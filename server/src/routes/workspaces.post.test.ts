import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./helpers.js", () => ({
	lookupMembership: vi.fn(),
	serializeWorkspaceList: vi.fn(),
}));

vi.mock("../core/tracker-vocabulary-seed.js", () => ({
	seedTrackerVocabulary: vi.fn().mockResolvedValue(undefined),
}));

const mockInsertWorkspace = vi.fn();
const mockInsertMember = vi.fn();

vi.mock("../db/kysely.js", () => ({
	db: {
		transaction: vi.fn(() => ({
			execute: async (cb: (trx: unknown) => Promise<unknown>) => {
				const trx = {
					insertInto: vi.fn((table: string) => {
						if (table === "workspaces") {
							return {
								values: vi.fn(() => ({
									returning: vi.fn(() => ({
										executeTakeFirstOrThrow: mockInsertWorkspace,
									})),
								})),
							};
						}
						return {
							values: vi.fn(() => ({
								execute: mockInsertMember,
							})),
						};
					}),
				};
				return cb(trx);
			},
		})),
	},
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

describe("POST /workspaces", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInsertWorkspace.mockResolvedValue({
			id: 42,
			name: "Eleventh Workspace",
			is_personal: false,
		});
		mockInsertMember.mockResolvedValue(undefined);
	});

	// Regression guard: workspacesRouter.post("/") must not import or call a
	// membership-count/cap check (helpers.js is mocked here without
	// countUserMemberships/getWorkspaceCapacity — if either were reintroduced,
	// this route would throw rather than reach a 201). Not a real-DB proof of
	// "the 11th workspace succeeds"; see invites.notification.test.ts for the
	// RUN_INTEGRATION-gated real-DB pattern this could graduate to.
	it("creates a workspace without importing a membership-count cap check", async () => {
		const res = await request(createApp())
			.post("/workspaces")
			.send({ name: "Eleventh Workspace" });

		expect(res.status).toBe(201);
		expect(res.body).toEqual({
			id: 42,
			name: "Eleventh Workspace",
			role: "owner",
			isPersonal: false,
			memberCount: 1,
		});
	});
});
