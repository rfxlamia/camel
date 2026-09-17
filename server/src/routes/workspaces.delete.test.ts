import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentPair } from "../lib/attachment-storage.js";

const mocks = vi.hoisted(() => ({
	lookupMembership: vi.fn(),
	dbSelectFrom: vi.fn(),
	transactionExecute: vi.fn(),
	lockWorkspaceMutation: vi.fn(),
	loadAttachmentPairsForWorkspace: vi.fn(),
	removeAttachmentPairsBestEffort: vi.fn(),
	getAttachmentStorage: vi.fn(),
	deleteExecute: vi.fn(),
	publishEvent: vi.fn(),
	recordActivity: vi.fn(),
}));

vi.mock("../db/kysely.js", () => ({
	db: {
		selectFrom: mocks.dbSelectFrom,
		transaction: () => ({ execute: mocks.transactionExecute }),
	},
}));
vi.mock("../lib/helpers.js", () => ({
	lookupMembership: mocks.lookupMembership,
	serializeWorkspaceList: vi.fn(),
	recordActivity: mocks.recordActivity,
}));
vi.mock("./workspace-mutation-lock.js", () => ({
	lockWorkspaceMutation: mocks.lockWorkspaceMutation,
}));
vi.mock("./card-attachment-cleanup.js", () => ({
	loadAttachmentPairsForWorkspace: mocks.loadAttachmentPairsForWorkspace,
	removeAttachmentPairsBestEffort: mocks.removeAttachmentPairsBestEffort,
}));
vi.mock("../lib/attachment-storage.js", () => ({
	getAttachmentStorage: mocks.getAttachmentStorage,
}));
vi.mock("../core/tracker-vocabulary-seed.js", () => ({
	seedTrackerVocabulary: vi.fn(),
}));
vi.mock("./settings.js", () => ({
	checkCanEditSettings: vi.fn(),
}));
vi.mock("../middleware/workspace.js", () => ({
	requireWorkspaceMember: vi.fn(),
}));
vi.mock("../realtime.js", () => ({
	publishEvent: mocks.publishEvent,
}));

import { workspacesRouter } from "./workspaces.js";

function query(result: unknown) {
	const chain = {
		innerJoin: vi.fn(() => chain),
		select: vi.fn(() => chain),
		where: vi.fn(() => chain),
		whereRef: vi.fn(() => chain),
		forUpdate: vi.fn(() => chain),
		executeTakeFirst: vi.fn().mockResolvedValue(result),
		executeTakeFirstOrThrow: vi.fn().mockResolvedValue(result),
		execute: mocks.deleteExecute,
	};
	return chain;
}

function createApp() {
	const app = express();
	app.use((req, _res, next) => {
		req.user = {
			id: 1,
			username: "alice",
			displayName: "Alice",
			email: null,
			emailVerified: true,
			needsUsername: false,
		};
		req.workspace = { workspaceId: 7, role: "owner" };
		next();
	});
	app.use("/workspaces", workspacesRouter);
	return app;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.lookupMembership.mockResolvedValue("owner");
	mocks.dbSelectFrom.mockImplementation((table: string) =>
		query(table === "workspaces" ? { is_personal: false } : { n: 1 }),
	);
	mocks.transactionExecute.mockImplementation(
		(callback: (trx: unknown) => Promise<unknown>) => {
			const trx = {
				selectFrom: vi.fn((table: string) =>
					query(
						table.includes("workspaces")
							? { owner_user_id: 1, is_personal: false, role: "member" }
							: { n: 1 },
					),
				),
				deleteFrom: vi.fn(() => query(undefined)),
			};
			return callback(trx);
		},
	);
	mocks.lockWorkspaceMutation.mockResolvedValue({ id: 7 });
	mocks.loadAttachmentPairsForWorkspace.mockResolvedValue([
		{
			thumbnailPath: "pair/thumbnail",
			originalPath: "pair/original",
		} satisfies AttachmentPair,
	]);
	mocks.getAttachmentStorage.mockReturnValue({});
	mocks.removeAttachmentPairsBestEffort.mockResolvedValue(undefined);
	mocks.recordActivity.mockResolvedValue(undefined);
	mocks.publishEvent.mockResolvedValue(undefined);
});

describe("DELETE /workspaces/:workspaceId", () => {
	it("rechecks ownership after locking before deleting", async () => {
		const response = await request(createApp()).delete("/workspaces/7");

		expect(response.status).toBe(404);
		expect(mocks.deleteExecute).not.toHaveBeenCalled();
		expect(mocks.loadAttachmentPairsForWorkspace).not.toHaveBeenCalled();
		expect(mocks.removeAttachmentPairsBestEffort).not.toHaveBeenCalled();
	});
});
