import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	transactionExecute: vi.fn(),
	publishEvent: vi.fn(),
	removeAttachmentPairsBestEffort: vi.fn(),
	getAttachmentStorage: vi.fn(),
	recordActivity: vi.fn(),
	deleteExecute: vi.fn(),
}));

vi.mock("../db/kysely.js", () => ({
	db: {
		transaction: () => ({ execute: mocks.transactionExecute }),
	},
}));
vi.mock("../lib/attachment-storage.js", () => ({
	getAttachmentStorage: mocks.getAttachmentStorage,
}));
vi.mock("../realtime.js", () => ({
	publishEvent: mocks.publishEvent,
}));
vi.mock("./helpers.js", () => ({
	recordActivity: mocks.recordActivity,
}));
vi.mock("./card-attachment-cleanup.js", () => ({
	removeAttachmentPairsBestEffort: mocks.removeAttachmentPairsBestEffort,
}));
vi.mock("./card-attachment-delivery.js", () => ({
	attachmentOwnershipGuard: (_req: unknown, _res: unknown, next: () => void) =>
		next(),
	createAttachmentOwnershipGuard:
		() => (_req: unknown, _res: unknown, next: () => void) =>
			next(),
	deliverAttachment: vi.fn(),
}));
vi.mock("./card-attachment-upload.js", () => ({
	existingCardMultipartMiddleware: (
		_req: unknown,
		_res: unknown,
		next: () => void,
	) => next(),
	uploadExistingCardAttachments: vi.fn(),
}));

import { cardAttachmentsRouter } from "./card-attachments.js";

function query(result: unknown) {
	const chain = {
		select: vi.fn(() => chain),
		where: vi.fn(() => chain),
		forUpdate: vi.fn(() => chain),
		executeTakeFirst: vi.fn().mockResolvedValue(result),
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
	app.use(cardAttachmentsRouter);
	return app;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.transactionExecute.mockImplementation(
		(callback: (trx: unknown) => Promise<unknown>) => {
			let selectCount = 0;
			const trx = {
				selectFrom: vi.fn(() => {
					selectCount += 1;
					return selectCount === 1
						? query({ id: 42, column_id: 5 })
						: query({
								id: 9,
								mime_type: "image/png",
								created_at: "2026-09-05T10:00:00.000Z",
								thumbnail_path: "pair/thumbnail",
								original_path: "pair/original",
							});
				}),
				deleteFrom: vi.fn(() => query(undefined)),
			};
			return callback(trx);
		},
	);
	mocks.deleteExecute.mockResolvedValue(undefined);
	mocks.recordActivity.mockResolvedValue(undefined);
	mocks.removeAttachmentPairsBestEffort.mockResolvedValue(undefined);
	mocks.getAttachmentStorage.mockReturnValue({});
	mocks.publishEvent.mockRejectedValue(new Error("publisher unavailable"));
});

describe("DELETE /cards/:cardId/attachments/:attachmentId", () => {
	it("keeps a committed deletion successful when event publication fails", async () => {
		const response = await request(createApp()).delete(
			"/cards/42/attachments/9",
		);

		expect(response.status).toBe(204);
		expect(mocks.deleteExecute).toHaveBeenCalledTimes(1);
		expect(mocks.removeAttachmentPairsBestEffort).toHaveBeenCalledTimes(1);
		expect(mocks.publishEvent).toHaveBeenCalledWith(
			7,
			expect.objectContaining({
				type: "attachment.removed",
				cardId: 42,
				workspaceId: 7,
				payload: {
					attachmentId: 9,
					mimeType: "image/png",
					createdAt: "2026-09-05T10:00:00.000Z",
				},
			}),
		);
	});
});
