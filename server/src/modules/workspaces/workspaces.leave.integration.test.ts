// Route + DB integration test for POST /workspaces/:id/leave.
//
// Proves the full leave flow against a real PostgreSQL: the leaver's
// workspace_members / card_assignees / columns.signable_assignee_id rows are
// cleaned up, non-members get 404, the owner is refused, and the removal dep
// never deletes an owner row (the service-level owner check runs outside the
// locked transaction, so the DELETE itself must guard the role).
//
// Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npx vitest run src/modules/workspaces/workspaces.leave.integration.test.ts
import "dotenv/config";
import {
	afterAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { mockPublishEvent, authUser } = vi.hoisted(() => ({
	// Async implementations: finalizeRemoval calls `.catch()` on these.
	mockPublishEvent: vi.fn(async () => undefined),
	authUser: {
		current: null as {
			id: number;
			username: string;
			displayName: string;
			email: string | null;
			emailVerified: boolean;
			needsUsername: boolean;
		} | null,
	},
}));

vi.mock("../../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

vi.mock("../../realtime.js", () => ({
	publishEvent: mockPublishEvent,
	clearPresence: vi.fn(async () => undefined),
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
			req.user = authUser.current;
			next();
		},
	};
});

import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import type { AuthUser } from "../../auth.js";
import { pool } from "../../db/pool.js";
import type { RecordActivityFn } from "../../lib/workspace-access-deps.js";
import { createErrorHandler } from "../../middleware/error-handler.js";
import { api } from "../../routes.js";

/** Isolated from other integration test workspace IDs used this session
 * (1, 95, 96, 97, 99). */
const WORKSPACE_ID = 94;
const RUN = Date.now();

let ownerUserId: number;
let leaverUserId: number;
let outsiderUserId: number;
let columnId: number;
let cardId: number;

function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

const app = createTestApp();

async function upsertUser(
	username: string,
	displayName: string,
): Promise<number> {
	const row = await pool.query(
		`INSERT INTO users (username, display_name, password_hash)
     VALUES ($1, $2, 'hashed')
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
		[username, displayName],
	);
	return row.rows[0].id;
}

async function countMembers(userId: number): Promise<number> {
	const row = await pool.query(
		"SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
		[WORKSPACE_ID, userId],
	);
	return row.rows[0].n;
}

beforeEach(async () => {
	// Fresh workspace fixture per test — cascades wipe members, columns,
	// cards, and card_assignees from the previous one.
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);

	ownerUserId = await upsertUser(`leave-owner-${RUN}`, "Leave Owner");
	leaverUserId = await upsertUser(`leave-member-${RUN}`, "Leave Member");
	outsiderUserId = await upsertUser(`leave-outsider-${RUN}`, "Leave Outsider");

	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal)
     VALUES ($1, 'Leave Test WS', $2, false)`,
		[WORKSPACE_ID, ownerUserId],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
		[WORKSPACE_ID, ownerUserId, leaverUserId],
	);

	const column = await pool.query(
		`INSERT INTO columns (title, position, workspace_id, signable_assignee_id)
     VALUES ('To do', 1000, $1, $2) RETURNING id`,
		[WORKSPACE_ID, leaverUserId],
	);
	columnId = column.rows[0].id;
	// cards.status_id is NOT NULL and references the tracker vocabulary
	// (board-tracker dual-table shim, issue #103).
	const status = await pool.query(
		`INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, category, slot)
     VALUES ($1, 'status', 'Todo', 1024, 'blue', 'backlog', 'todo') RETURNING id`,
		[WORKSPACE_ID],
	);
	const card = await pool.query(
		`INSERT INTO cards (column_id, title, position, workspace_id, status_id)
     VALUES ($1, 'Card A', 1000, $2, $3) RETURNING id`,
		[columnId, WORKSPACE_ID, status.rows[0].id],
	);
	cardId = card.rows[0].id;
	await pool.query(
		"INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2)",
		[cardId, leaverUserId],
	);

	vi.clearAllMocks();
});

afterAll(async () => {
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM users WHERE id IN ($1, $2, $3)", [
		ownerUserId,
		leaverUserId,
		outsiderUserId,
	]);
	await pool.end();
});

function asAuthUser(id: number, username: string, displayName: string) {
	return {
		id,
		username,
		displayName,
		email: null,
		emailVerified: true,
		needsUsername: false,
	};
}

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"POST /api/workspaces/:workspaceId/leave",
	() => {
		it("removes the leaver's membership, card assignees, and column signable assignment", async () => {
			authUser.current = asAuthUser(
				leaverUserId,
				`leave-member-${RUN}`,
				"Leave Member",
			);

			const res = await request(app).post(
				`/api/workspaces/${WORKSPACE_ID}/leave`,
			);

			expect(res.status).toBe(204);
			expect(await countMembers(leaverUserId)).toBe(0);

			const assignees = await pool.query(
				"SELECT count(*)::int AS n FROM card_assignees WHERE card_id = $1 AND user_id = $2",
				[cardId, leaverUserId],
			);
			expect(assignees.rows[0].n).toBe(0);

			const signable = await pool.query(
				"SELECT signable_assignee_id FROM columns WHERE id = $1",
				[columnId],
			);
			expect(signable.rows[0].signable_assignee_id).toBeNull();

			expect(mockPublishEvent).toHaveBeenCalledWith(
				WORKSPACE_ID,
				expect.objectContaining({
					type: "membership.removed",
					userId: leaverUserId,
					reason: "left",
				}),
			);
		});

		it("returns 404 for a non-member without publishing anything", async () => {
			authUser.current = asAuthUser(
				outsiderUserId,
				`leave-outsider-${RUN}`,
				"Leave Outsider",
			);

			const res = await request(app).post(
				`/api/workspaces/${WORKSPACE_ID}/leave`,
			);

			expect(res.status).toBe(404);
			expect(mockPublishEvent).not.toHaveBeenCalled();
			expect(await countMembers(leaverUserId)).toBe(1);
		});

		it("refuses the owner with 403 and keeps the membership row", async () => {
			authUser.current = asAuthUser(
				ownerUserId,
				`leave-owner-${RUN}`,
				"Leave Owner",
			);

			const res = await request(app).post(
				`/api/workspaces/${WORKSPACE_ID}/leave`,
			);

			expect(res.status).toBe(403);
			expect(res.body).toEqual({
				error: "Transfer ownership before leaving this workspace",
			});
			expect(await countMembers(ownerUserId)).toBe(1);
		});

		it("never deletes an owner row even when the pre-transaction check is bypassed", async () => {
			// Simulates the race the service-level check cannot close: the
			// member becomes owner after leaveMember's membership lookup but
			// before the locked DELETE. Calling the dep directly skips that
			// lookup; the role guard in the DELETE is the last line of defense.
			// Imported lazily: a top-level import changes module init order and
			// hits a TDZ cycle in helpers.ts' dep construction.
			const { buildDefaultWorkspaceAccessDeps } = await import(
				"../../lib/workspace-access-deps.js"
			);
			const deps = buildDefaultWorkspaceAccessDeps(
				vi.fn() as unknown as RecordActivityFn,
			);
			const ownerActor: AuthUser = {
				id: ownerUserId,
				username: "leave-owner",
				displayName: "Leave Owner",
				email: null,
				emailVerified: true,
				needsUsername: false,
			};

			const removed = await deps.removeMember(
				WORKSPACE_ID,
				ownerUserId,
				ownerActor,
			);

			expect(removed).toBeNull();
			expect(await countMembers(ownerUserId)).toBe(1);
			expect(mockPublishEvent).not.toHaveBeenCalled();
		});
	},
);
