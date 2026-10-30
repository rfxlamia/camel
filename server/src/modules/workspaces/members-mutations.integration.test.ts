// Integration test for POST /members: concurrent requests inviting the same
// username must not crash — the invite insert (guarded by the UNIQUE
// (workspace_id, username) constraint) is the authoritative check, so a
// losing request gets a clean 409 ("Invite already pending") via the 23505
// race handler instead of a raw unique-index 500.
//
// NOTE: POST /members never inserts a membership row directly anymore —
// every target gets a pending invite, and membership is only created when
// the invite is accepted (POST /invites/:inviteId/accept), which is also
// the only place MEMBER_JOINED is emitted.
//
// Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npx vitest run src/modules/workspaces/members-mutations.integration.test.ts
import "dotenv/config";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { mockPublishEvent, mockTestUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn(),
	mockTestUser: { id: 1, username: "testuser", displayName: "Test User" },
}));

vi.mock("../../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

vi.mock("../../realtime.js", () => ({
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

vi.mock("../../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../auth.js")>();
	return {
		...actual,
		requireAuth: (req: any, _res: any, next: any) => {
			req.user = mockTestUser;
			next();
		},
	};
});

import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { db } from "../../db/kysely.js";
import { pool } from "../../db/pool.js";
import { createErrorHandler } from "../../middleware/error-handler.js";
import { api } from "../../routes.js";

/** Isolated from other integration test workspace IDs used this session
 * (1, 96, 97, 99). */
const WORKSPACE_ID = 95;
const TARGET_USERNAME = `members-race-target-${Date.now()}`;
let targetUserId: number;

function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

const app = createTestApp();

async function cleanup() {
	// Invites must go first (they reference the workspace and users), then
	// memberships — the owner row from setupFixtures must survive so the
	// actor stays a member across tests.
	await pool.query("DELETE FROM workspace_invites WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query(
		"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id <> $2",
		[WORKSPACE_ID, mockTestUser.id],
	);
}

async function setupFixtures() {
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
		[
			mockTestUser.id,
			mockTestUser.username,
			mockTestUser.displayName,
			"hashed",
		],
	);
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal)
     VALUES ($1, 'Members Race Test WS', $2, false) ON CONFLICT (id) DO NOTHING`,
		[WORKSPACE_ID, mockTestUser.id],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		[WORKSPACE_ID, mockTestUser.id],
	);
	const target = await pool.query(
		`INSERT INTO users (username, display_name, password_hash)
     VALUES ($1, 'Race Target', 'hashed')
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
		[TARGET_USERNAME],
	);
	targetUserId = target.rows[0].id;
}

beforeEach(async () => {
	await setupFixtures();
	await cleanup();
	vi.clearAllMocks();
});

afterEach(async () => {
	await cleanup();
});

afterAll(async () => {
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [
		mockTestUser.id,
		targetUserId,
	]);
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"POST /api/workspaces/:wid/members — concurrent invite race",
	() => {
		it("only lets one of N concurrent invites of the same username succeed, rest get 409 not 500", async () => {
			// Delay every insertInto call so all N requests' earlier
			// lookupMembership reads (the pre-insert "already a member?"
			// check) land before any single request's write commits —
			// reproducing the real race window instead of relying on
			// natural request timing, which alone doesn't trigger it.
			// Kysely builders are immutable, so wrap the whole chain in a
			// Proxy that re-wraps every call until it hits execute().
			function delayExecute(builder: any, delayMs: number): any {
				return new Proxy(builder, {
					get(target, prop, receiver) {
						const value = Reflect.get(target, prop, receiver);
						if (typeof value !== "function") return value;
						if (
							prop === "execute" ||
							prop === "executeTakeFirst" ||
							prop === "executeTakeFirstOrThrow"
						) {
							return async (...args: unknown[]) => {
								await new Promise((r) => setTimeout(r, delayMs));
								return value.apply(target, args);
							};
						}
						return (...args: unknown[]) => {
							const result = value.apply(target, args);
							return result && typeof result === "object"
								? delayExecute(result, delayMs)
								: result;
						};
					},
				});
			}
			const originalInsertInto = db.insertInto.bind(db);
			const spy = vi
				.spyOn(db, "insertInto")
				.mockImplementation((...args: any[]) =>
					delayExecute((originalInsertInto as any)(...args), 100),
				);

			const N = 8;
			let results: Awaited<ReturnType<typeof request>>[];
			try {
				results = await Promise.all(
					Array.from({ length: N }, () =>
						request(app)
							.post(`/api/workspaces/${WORKSPACE_ID}/members`)
							.send({ username: TARGET_USERNAME }),
					),
				);
			} finally {
				spy.mockRestore();
			}
			const statuses = results.map((r) => r.status).sort((a, b) => a - b);
			const created = results.filter((r) => r.status === 201);
			const conflicted = statuses.filter((s) => s === 409).length;
			const crashed = statuses.filter((s) => s >= 500).length;

			expect(crashed).toBe(0);
			// Exactly one invite row wins the race; every loser gets a clean
			// 409 ("Invite already pending"), not a raw unique-index 500.
			expect(created).toHaveLength(1);
			expect(conflicted).toBe(N - 1);
			expect(created[0].body.pending).toBe(true);
			for (const r of results.filter((x) => x.status === 409)) {
				expect(r.body.error).toBe("Invite already pending for this username");
			}

			// No membership row may be created at invite time — joining
			// requires the user to accept the invite.
			const members = await pool.query(
				"SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
				[WORKSPACE_ID, targetUserId],
			);
			expect(members.rows[0].n).toBe(0);

			const invites = await pool.query(
				"SELECT count(*)::int AS n FROM workspace_invites WHERE workspace_id = $1 AND username = $2",
				[WORKSPACE_ID, TARGET_USERNAME],
			);
			expect(invites.rows[0].n).toBe(1);
		});
	},
);
