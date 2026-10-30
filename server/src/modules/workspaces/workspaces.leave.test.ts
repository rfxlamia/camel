import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	leaveMember: vi.fn(),
}));

vi.mock("../../db/kysely.js", () => ({
	db: {
		selectFrom: vi.fn(),
		transaction: () => ({ execute: vi.fn() }),
	},
}));
vi.mock("../../lib/helpers.js", () => ({
	lookupMembership: vi.fn(),
	serializeWorkspaceList: vi.fn(),
	workspaceAccessService: {
		leaveMember: mocks.leaveMember,
	},
}));
vi.mock("../../lib/workspace-mutation-lock.js", () => ({
	lockWorkspaceMutation: vi.fn(),
}));
vi.mock("../board/index.js", () => ({
	loadAttachmentPairsForWorkspace: vi.fn(),
	removeAttachmentPairsBestEffort: vi.fn(),
}));
vi.mock("../../lib/attachment-storage.js", () => ({
	getAttachmentStorage: vi.fn(),
}));
vi.mock("../../core/tracker-vocabulary-seed.js", () => ({
	seedTrackerVocabulary: vi.fn(),
}));
vi.mock("../settings/index.js", () => ({
	checkCanEditSettings: vi.fn(),
}));

import { workspacesRouter } from "./workspaces.js";

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = {
			id: 4,
			username: "nina",
			displayName: "Nina",
			email: null,
			emailVerified: true,
			needsUsername: false,
		};
		next();
	});
	app.use("/workspaces", workspacesRouter);
	return app;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("POST /workspaces/:workspaceId/leave", () => {
	it("maps a successful leave to 204", async () => {
		mocks.leaveMember.mockResolvedValue({ status: 204 });

		const res = await request(createApp()).post("/workspaces/7/leave");

		expect(res.status).toBe(204);
		expect(mocks.leaveMember).toHaveBeenCalledWith({
			userId: 4,
			actor: expect.objectContaining({ id: 4, username: "nina" }),
			workspaceId: 7,
		});
	});

	it("maps a service rejection to its status and error", async () => {
		mocks.leaveMember.mockResolvedValue({
			status: 403,
			error: "Transfer ownership before leaving this workspace",
		});

		const res = await request(createApp()).post("/workspaces/7/leave");

		expect(res.status).toBe(403);
		expect(res.body).toEqual({
			error: "Transfer ownership before leaving this workspace",
		});
	});

	it("rejects a non-integer workspaceId with 400", async () => {
		const res = await request(createApp()).post("/workspaces/abc/leave");

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "workspaceId must be an integer" });
		expect(mocks.leaveMember).not.toHaveBeenCalled();
	});
});
