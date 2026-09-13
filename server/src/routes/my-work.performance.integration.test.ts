// Requires PostgreSQL with the current schema applied. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.performance.integration.test.ts
import "dotenv/config";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { PERFORMANCE_USER_ID, PERFORMANCE_WORKSPACE_IDS, mockCurrentUser } =
	vi.hoisted(() => ({
		PERFORMANCE_USER_ID: 47111,
		PERFORMANCE_WORKSPACE_IDS: Array.from(
			{ length: 10 },
			(_, index) => 47111 + index,
		),
		mockCurrentUser: {
			id: 47111,
			username: "my-work-performance-user",
			displayName: "Performance User",
			email: "my-work-performance@example.test",
			emailVerified: true,
			needsUsername: false,
		},
	}));

// Keep the API, Express, authorization, Kysely, and PostgreSQL paths real.
// Only authentication session resolution and realtime side effects are outside
// this performance boundary, matching the existing integration conventions.
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

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

vi.mock("../realtime.js", () => ({
	publishEvent: vi.fn().mockResolvedValue(undefined),
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

import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { resetMyWorkObservabilityForTests } from "../core/my-work-observability.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";
import {
	getMyWorkObservabilityEvents,
	getMyWorkLatencySnapshot,
} from "../core/my-work-observability.js";

const app = express();
app.use(express.json());
app.use("/api", api);
app.use(createErrorHandler());

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

function databaseMetadata(rawUrl: string) {
	try {
		const parsed = new URL(rawUrl);
		return {
			host: parsed.hostname || null,
			port: parsed.port || null,
			database: parsed.pathname.replace(/^\//, "") || null,
			protocol: parsed.protocol,
		};
	} catch {
		return { host: null, port: null, database: null, protocol: null };
	}
}

async function environmentEvidence() {
	const [versionResult, schemaResult] = await Promise.all([
		pool.query<{ version: string }>("SELECT version()"),
		pool.query<{
			workspaces: string | null;
			workspace_members: string | null;
			tracker_items: string | null;
			tracker_item_assignees: string | null;
		}>(`SELECT
       to_regclass('public.workspaces') AS workspaces,
       to_regclass('public.workspace_members') AS workspace_members,
       to_regclass('public.tracker_items') AS tracker_items,
       to_regclass('public.tracker_item_assignees') AS tracker_item_assignees`),
	]);
	const tables = schemaResult.rows[0];
	const migrationState =
		tables?.workspaces &&
		tables.workspace_members &&
		tables.tracker_items &&
		tables.tracker_item_assignees
			? "required schema tables present"
			: "required schema tables missing";
	const runner =
		process.env.GITHUB_ACTIONS === "true"
			? "github-actions"
			: process.env.CI
				? "ci"
				: "local";
	const evidence = {
		migrationState,
		migrationSource: "schema.sql + agent-schema.sql + chat-schema.sql",
		node: process.version,
		postgres: versionResult.rows[0]?.version?.split(" on ")[0] ?? "unknown",
		ciRunner: runner,
		runnerPlatform: process.platform,
		database: databaseMetadata(config.DATABASE_URL),
	};
	// This metadata deliberately excludes DATABASE_URL credentials and is safe
	// to retain with the performance result for environment comparison.
	console.info(`[my-work-performance-environment] ${JSON.stringify(evidence)}`);
	return evidence;
}

async function cleanupPerformanceFixtures(): Promise<void> {
	await pool.query("DELETE FROM workspaces WHERE id = ANY($1::int[])", [
		PERFORMANCE_WORKSPACE_IDS,
	]);
	await pool.query("DELETE FROM users WHERE id = $1", [PERFORMANCE_USER_ID]);
}

async function setupPerformanceFixtures(): Promise<void> {
	await cleanupPerformanceFixtures();
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
     VALUES ($1, 'my-work-performance-user', 'Performance User', 'test')`,
		[PERFORMANCE_USER_ID],
	);

	for (const [index, workspaceId] of PERFORMANCE_WORKSPACE_IDS.entries()) {
		await pool.query(
			`INSERT INTO workspaces
         (id, name, owner_user_id, is_personal, tracker_key_counter)
       VALUES ($1, $2, $3, false, 100)`,
			[workspaceId, `Performance Workspace ${index + 1}`, PERFORMANCE_USER_ID],
		);
		await pool.query(
			`INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
			[workspaceId, PERFORMANCE_USER_ID],
		);
		const statusResult = await pool.query<{ id: number }>(
			`INSERT INTO tracker_vocabularies
         (workspace_id, kind, name, position, colour, category, slot)
       VALUES ($1, 'status', 'In Progress', 1024, 'blue', 'started', 'in_progress')
       RETURNING id`,
			[workspaceId],
		);
		const statusId = statusResult.rows[0]?.id;
		if (statusId === undefined)
			throw new Error("benchmark status insert failed");
		await pool.query(
			`WITH inserted AS (
         INSERT INTO tracker_items
           (workspace_id, key_number, title, description, status_id, position)
         SELECT $1, item_number, 'performance fixture item', '', $2,
           item_number::double precision
         FROM generate_series(1, 100) AS item_number
         RETURNING id
       )
       INSERT INTO tracker_item_assignees (tracker_item_id, user_id)
       SELECT id, $3 FROM inserted`,
			[workspaceId, statusId, PERFORMANCE_USER_ID],
		);
	}
}

function nearestRankPercentile(samples: readonly number[], percentile: number) {
	if (samples.length === 0) return 0;
	const sorted = [...samples].sort((a, b) => a - b);
	const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
	return sorted[rank - 1] ?? 0;
}

integration("My Work real-DB performance boundary", () => {
	beforeAll(async () => {
		await setupPerformanceFixtures();
		resetMyWorkObservabilityForTests();
	});

	afterAll(async () => {
		await cleanupPerformanceFixtures();
	});

	it("keeps the 10-workspace/1,000-item rollup under the nearest-rank p95 target", async () => {
		const evidence = await environmentEvidence();
		expect(evidence.migrationState).toBe("required schema tables present");
		expect(evidence.migrationSource).toBe(
			"schema.sql + agent-schema.sql + chat-schema.sql",
		);
		expect(evidence.node).toMatch(/^v\d+/);
		expect(evidence.postgres).not.toBe("unknown");
		expect(evidence.database).not.toHaveProperty("username");
		expect(evidence.database).not.toHaveProperty("password");

		const fixtureCount = await pool.query<{ count: string }>(
			`SELECT count(*)::text AS count
       FROM tracker_items ti
       INNER JOIN tracker_item_assignees tia ON tia.tracker_item_id = ti.id
       INNER JOIN workspace_members wm
         ON wm.workspace_id = ti.workspace_id AND wm.user_id = tia.user_id
       WHERE tia.user_id = $1
         AND ti.workspace_id = ANY($2::int[])
         AND ti.deleted_at IS NULL`,
			[PERFORMANCE_USER_ID, PERFORMANCE_WORKSPACE_IDS],
		);
		expect(fixtureCount.rows[0]?.count).toBe("1000");

		const path = "/api/my-work?scope=active&limit=50";
		for (let index = 0; index < 5; index += 1) {
			const response = await request(app).get(path);
			expect(response.status).toBe(200);
			expect(response.body.items).toHaveLength(50);
		}

		const samples: number[] = [];
		for (let index = 0; index < 30; index += 1) {
			const startedAt = performance.now();
			const response = await request(app).get(path);
			const elapsedMs = performance.now() - startedAt;
			expect(response.status).toBe(200);
			expect(response.body.items).toHaveLength(50);
			samples.push(elapsedMs);
		}

		expect(samples).toHaveLength(30);
		const p95 = nearestRankPercentile(samples, 95);
		expect(p95).toBeLessThan(100);

		const events = getMyWorkObservabilityEvents();
		expect(events).toHaveLength(35);
		for (const event of events) {
			expect(event).toEqual({
				event: "my_work_rollup",
				latencyMs: expect.any(Number),
				count: 50,
				errorClass: "none",
			});
		}
		const serializedTelemetry = JSON.stringify(events);
		expect(serializedTelemetry).not.toContain("performance fixture item");
		expect(serializedTelemetry).not.toContain(String(PERFORMANCE_USER_ID));
		expect(serializedTelemetry).not.toContain("DATABASE_URL");
		expect(serializedTelemetry).not.toContain(config.DATABASE_URL);

		const telemetrySnapshot = getMyWorkLatencySnapshot();
		expect(telemetrySnapshot.count).toBe(35);
		expect(telemetrySnapshot.p95).toBeLessThan(100);
	});
});
