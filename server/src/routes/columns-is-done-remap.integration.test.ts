// Integration coverage for transactional column is_done remapping.
// Scenario suites are imported so this remains the required test entrypoint.
import "dotenv/config";
import { afterAll, vi } from "vitest";

const { mockPublishEvent, mockTestUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
	mockTestUser: { id: 1, username: "testuser", displayName: "Test User" },
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
		requireAuth: (req: any, _res: any, next: any) => {
			req.user = mockTestUser;
			next();
		},
	};
});

import { destroyWorkspace } from "./columns-is-done-remap.test-support.js";

// The scenario modules install per-test setup and cleanup hooks.
import "./columns-is-done-remap.basic.test.js";
import "./columns-is-done-remap.edge.test.js";
import "./columns-is-done-remap.failure.test.js";

// Keep teardown after every imported scenario suite has completed.
afterAll(destroyWorkspace);
