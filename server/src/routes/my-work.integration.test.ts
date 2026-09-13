// Requires PostgreSQL. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts
import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, vi } from "vitest";

const { mockPublishEvent, mockCurrentUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
	mockCurrentUser: {
		id: 47001,
		username: "my-work-alice",
		displayName: "Alice",
		email: "alice@example.test",
		emailVerified: true,
		needsUsername: false,
	},
}));

// Redis/realtime are outside this integration boundary. Keep the HTTP, route,
// authorization, Kysely, and PostgreSQL paths real.
vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

vi.mock("../realtime.js", () => ({
	publishEvent: mockPublishEvent,
	clearPresence: vi.fn().mockResolvedValue(undefined),
	heartbeat: vi.fn(),
	onlineUsers: vi.fn().mockResolvedValue([]),
	sseHandler: vi.fn(),
	createRealtimeHub: vi.fn(),
	initRealtime: vi.fn(),
	workspaceEventChannel: vi.fn(),
	workspacePresenceKey: vi.fn(),
	workspacePresencePattern: vi.fn(),
}));

// Only the session seam is stubbed. Membership and item assignment queries
// continue to execute against the real database in every request.
vi.mock("../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../auth.js")>();
	return {
		...actual,
		requireAuth: (req: any, _res: any, next: any) => {
			req.user = mockCurrentUser;
			next();
		},
	};
});

import { registerAuthorizationScenarios } from "./my-work.integration.authorization.js";
import { setupFixtures } from "./my-work.integration.fixtures.js";
import { registerMutationScenarios } from "./my-work.integration.mutations.js";
import { registerRollupScenarios } from "./my-work.integration.rollup.js";
import { cleanupAll, pool, testState } from "./my-work.integration.shared.js";

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

integration("My Work server acceptance boundary", () => {
	beforeEach(async () => {
		testState.fixtures = await setupFixtures();
		mockPublishEvent.mockClear();
	});

	afterEach(async () => {
		testState.fixtures = null;
		await cleanupAll();
	});

	afterAll(async () => {
		testState.fixtures = null;
		await cleanupAll();
		await pool.end();
	});

	registerRollupScenarios();
	registerMutationScenarios();
	registerAuthorizationScenarios();
});
