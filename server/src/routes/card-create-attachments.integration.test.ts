import "dotenv/config";
import type { NextFunction, Request, Response } from "express";
import { afterAll, afterEach, beforeEach, describe, vi } from "vitest";
import { registerCleanupScenarios } from "./card-create-attachments.cleanup.js";
import { registerCreationScenarios } from "./card-create-attachments.creation.js";
import {
	cleanup,
	domainBus,
	initializeFixtures,
	initializeStorageRoot,
	LocalAttachmentStorage,
	pool,
	setAttachmentStorageForTests,
	storageRoot,
} from "./card-create-attachments.test-support.js";
import { registerValidationScenarios } from "./card-create-attachments.validation.js";

const { mockPublishEvent, currentUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
	currentUser: {
		id: 1,
		username: "card-create-attachment-owner",
		displayName: "Owner",
	},
}));

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));
vi.mock("../realtime.js", () => ({
	publishEvent: mockPublishEvent,
	clearPresence: vi.fn(),
	heartbeat: vi.fn(),
	onlineUsers: vi.fn().mockResolvedValue([]),
	sseHandler: vi.fn(),
	createRealtimeHub: vi.fn(),
	initRealtime: vi.fn(),
	workspaceEventChannel: vi.fn(),
	workspacePresenceKey: vi.fn(),
	workspacePresencePattern: vi.fn(),
}));
vi.mock("../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../auth.js")>();
	return {
		...actual,
		requireAuth: (req: Request, _res: Response, next: NextFunction) => {
			req.user = currentUser;
			next();
		},
	};
});

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

integration("POST /cards — atomic staged attachment create", () => {
	beforeEach(async () => {
		mockPublishEvent.mockReset().mockResolvedValue(undefined);
		domainBus.removeAllListeners();
		await initializeFixtures(currentUser);
		await initializeStorageRoot();
		setAttachmentStorageForTests(new LocalAttachmentStorage(storageRoot!));
	});
	afterEach(async () => {
		domainBus.removeAllListeners();
		setAttachmentStorageForTests(null);
		await cleanup();
	});
	afterAll(async () => {
		await pool.end();
	});

	registerCreationScenarios(mockPublishEvent);
	registerValidationScenarios(mockPublishEvent);
	registerCleanupScenarios(mockPublishEvent);
});
