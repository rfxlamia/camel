import express from "express";
import { Kysely, PostgresDialect } from "kysely";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../auth.js";
import type { DB } from "../db/types.js";
import {
	createMyWorkDataSource,
	createMyWorkRouter,
	createMyWorkService,
	type MyWorkDataSource,
} from "./my-work.js";
import {
	type MyWorkBoardRow,
	type MyWorkTrackerRow,
	type MyWorkWorkspace,
	mergeMyWorkRows,
} from "./my-work-response.js";

// The service tests use injected source loaders. Keep the module import from
// requiring a configured PostgreSQL environment.
vi.mock("../db/kysely.js", () => ({ db: {} }));

const ATLAS: MyWorkWorkspace = {
	id: 7,
	name: "Atlas",
	timezone: "Asia/Jakarta",
};
const ORBIT: MyWorkWorkspace = {
	id: 12,
	name: "Orbit",
	timezone: "UTC",
};
const NEBULA: MyWorkWorkspace = {
	id: 19,
	name: "Nebula",
	timezone: "UTC",
};
const NOW = new Date("2026-09-11T06:00:00.000Z");

function trackerRow(
	overrides: Partial<MyWorkTrackerRow> = {},
): MyWorkTrackerRow {
	return {
		id: 100,
		workspace_id: 12,
		key_number: 4,
		title: "Tracker item",
		description: "Tracker description",
		version: 1,
		created_at: new Date("2026-09-09T00:00:00.000Z"),
		updated_at: new Date("2026-09-10T00:00:00.000Z"),
		status_id: 2,
		status_name: "In Progress",
		status_kind: "status",
		status_position: 2,
		status_colour: "#2563eb",
		status_category: "started",
		status_slot: "in_progress",
		priority_id: null,
		priority_name: null,
		priority_kind: null,
		priority_position: null,
		priority_colour: null,
		project_id: null,
		phase_id: null,
		start_date: null,
		end_date: null,
		completed_at: null,
		position: 1,
		assignees: [{ id: 42, username: "alice", displayName: "Alice" }],
		labels: [],
		...overrides,
	};
}

function boardRow(overrides: Partial<MyWorkBoardRow> = {}): MyWorkBoardRow {
	return {
		id: 200,
		workspace_id: 7,
		key_number: 17,
		title: "Board card",
		description: "Board description",
		version: 1,
		created_at: new Date("2026-09-09T00:00:00.000Z"),
		started_at: null,
		done_at: null,
		due_date: null,
		column_id: 3,
		column_name: "In Progress",
		position: 1,
		status_id: 3,
		status_name: "In Progress",
		status_kind: "status",
		status_position: 2,
		status_colour: "#2563eb",
		status_category: "started",
		status_slot: "in_progress",
		priority_id: null,
		priority_name: null,
		priority_kind: null,
		priority_position: null,
		priority_colour: null,
		project_id: null,
		phase_id: null,
		assignees: [{ id: 42, username: "alice", displayName: "Alice" }],
		labels: [],
		...overrides,
	};
}

type SourceRows = {
	tracker: MyWorkTrackerRow[];
	board: MyWorkBoardRow[];
};

function sourceDeps(
	rows: SourceRows,
	workspaces: MyWorkWorkspace[] = [ATLAS, ORBIT],
): MyWorkServiceDepsForTest {
	return {
		listAuthorizedWorkspaces: vi.fn(async () => workspaces),
		listTrackerRows: vi.fn(async (input) =>
			rows.tracker.filter((row) =>
				input.workspaceIds.includes(row.workspace_id),
			),
		),
		listBoardRows: vi.fn(async (input) =>
			rows.board.filter((row) => input.workspaceIds.includes(row.workspace_id)),
		),
		getTrackerRow: vi.fn(
			async (input) =>
				rows.tracker.find(
					(row) =>
						row.workspace_id === input.workspaceId &&
						row.key_number === input.keyNumber,
				) ?? null,
		),
		getBoardRow: vi.fn(
			async (input) =>
				rows.board.find(
					(row) =>
						row.workspace_id === input.workspaceId &&
						row.key_number === input.keyNumber,
				) ?? null,
		),
	};
}

type MyWorkServiceDepsForTest = Partial<MyWorkDataSource>;

const ALICE: AuthUser = {
	id: 42,
	username: "alice",
	displayName: "Alice",
	email: "alice@example.com",
	emailVerified: true,
	needsUsername: false,
};

function testApp(router: ReturnType<typeof createMyWorkRouter>) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = ALICE;
		next();
	});
	app.use("/my-work", router);
	return app;
}

type CapturedQuery = {
	sql: string;
	parameters: readonly unknown[];
};

type FakePostgresPool = ConstructorParameters<
	typeof PostgresDialect
>[0]["pool"];

function capturedDb() {
	const queries: CapturedQuery[] = [];
	const client = {
		async query<R>(sqlText: string, parameters: readonly unknown[] = []) {
			queries.push({ sql: sqlText, parameters });
			return { rows: [] as R[] };
		},
		release() {},
	};
	const pool = {
		options: {},
		async connect() {
			return client;
		},
		async end() {},
	} as unknown as FakePostgresPool;
	const executor = new Kysely<DB>({
		dialect: new PostgresDialect({ pool }),
	});
	return { executor, queries };
}

describe("My Work personal read boundary", () => {
	beforeEach(() => vi.clearAllMocks());

	it("RED 1: returns assigned Board/Tracker rows with workspace and source identity", async () => {
		const deps = sourceDeps({
			tracker: [trackerRow({ id: 101, workspace_id: ORBIT.id, key_number: 4 })],
			board: [boardRow({ id: 201, workspace_id: ATLAS.id, key_number: 17 })],
		});
		const service = createMyWorkService(deps);

		const result = await service.list({
			userId: ALICE.id,
			scope: "active",
			now: NOW,
		});

		expect(result.items).toHaveLength(2);
		expect(result.items.map((item) => item.identity)).toEqual(
			expect.arrayContaining([
				{ workspaceId: 7, source: "board", key: "AT-17" },
				{ workspaceId: 12, source: "tracker", key: "OR-4" },
			]),
		);
		expect(result.items.every((item) => item.workspace?.name)).toBe(true);
		expect(deps.listTrackerRows).toHaveBeenCalledWith(
			expect.objectContaining({ userId: ALICE.id, workspaceIds: [7, 12] }),
		);
	});

	it("RED 2: deduplicates duplicate joins and applies tracker-wins per workspace", async () => {
		const atlasTracker = trackerRow({
			id: 102,
			workspace_id: ATLAS.id,
			key_number: 17,
			title: "Atlas tracker winner",
		});
		const orbitTracker = trackerRow({
			id: 103,
			workspace_id: ORBIT.id,
			key_number: 17,
			title: "Orbit tracker",
		});
		const result = await createMyWorkService(
			sourceDeps({
				tracker: [atlasTracker, { ...atlasTracker }, orbitTracker],
				board: [
					boardRow({
						id: 202,
						workspace_id: ATLAS.id,
						key_number: 17,
						title: "Atlas board shadow",
					}),
					boardRow({
						id: 203,
						workspace_id: ORBIT.id,
						key_number: 17,
						title: "Orbit board",
					}),
				],
			}),
		).list({ userId: ALICE.id, scope: "all", now: NOW });

		expect(result.items).toHaveLength(2);
		expect(
			result.items.map((item) => [item.workspaceId, item.source, item.key]),
		).toEqual(
			expect.arrayContaining([
				[7, "tracker", "AT-17"],
				[12, "tracker", "OR-17"],
			]),
		);
		expect(
			result.items.some((item) => item.title === "Atlas board shadow"),
		).toBe(false);

		const merged = mergeMyWorkRows(
			[atlasTracker, { ...atlasTracker }, orbitTracker],
			[],
		);
		expect(merged).toHaveLength(2);
	});

	it("RED 3: excludes an assigned row from a workspace without current membership", async () => {
		const deps = sourceDeps(
			{
				tracker: [
					trackerRow({
						id: 104,
						workspace_id: NEBULA.id,
						key_number: 9,
						title: "Nebula secret",
					}),
				],
				board: [],
			},
			[ATLAS, ORBIT],
		);
		const result = await createMyWorkService(deps).list({
			userId: ALICE.id,
			scope: "all",
			now: NOW,
		});

		expect(result.items).toEqual([]);
		expect(JSON.stringify(result)).not.toContain("Nebula");
	});

	it("RED 4: filters terminal Active rows and keeps unknown categories as Other in All", async () => {
		const rows = [
			trackerRow({
				id: 105,
				key_number: 1,
				status_category: "backlog",
				status_slot: "backlog",
			}),
			trackerRow({
				id: 106,
				key_number: 2,
				status_category: "started",
				status_slot: "in_progress",
			}),
			trackerRow({
				id: 107,
				key_number: 3,
				status_category: "completed",
				status_slot: "done",
			}),
			trackerRow({
				id: 108,
				key_number: 4,
				status_category: "canceled",
				status_slot: "canceled",
			}),
			trackerRow({
				id: 109,
				key_number: 5,
				status_category: "mystery",
				status_slot: null,
			}),
		];
		const deps = sourceDeps({ tracker: rows, board: [] });
		const service = createMyWorkService(deps);

		const active = await service.list({
			userId: ALICE.id,
			scope: "active",
			now: NOW,
		});
		const all = await service.list({
			userId: ALICE.id,
			scope: "all",
			now: NOW,
		});

		expect(active.items.map((item) => item.id)).toEqual([105, 106, 109]);
		expect(all.items.map((item) => item.id)).toEqual(
			expect.arrayContaining([105, 106, 107, 108, 109]),
		);
		expect(
			all.items.find((item) => item.id === 109)?.statusCategory,
		).toBeNull();
	});

	it("RED 5: reauthorizes detail and maps revoked access to HTTP 404 Not found", async () => {
		let revoked = false;
		const row = boardRow({ id: 210, workspace_id: ATLAS.id, key_number: 17 });
		const deps = sourceDeps({ tracker: [], board: [row] }, [ATLAS]);
		deps.listAuthorizedWorkspaces = vi.fn(async () => (revoked ? [] : [ATLAS]));
		const router = createMyWorkRouter({ deps });
		const app = testApp(router);

		const before = await request(app).get("/my-work/7/board/AT-17");
		expect(before.status).toBe(200);
		revoked = true;
		const after = await request(app).get("/my-work/7/board/AT-17");
		expect(after.status).toBe(404);
		expect(after.body).toEqual({ error: "Not found" });
		expect(JSON.stringify(after.body)).not.toContain("Board card");
	});

	it("RED 5b: assignment revocation after source read returns 404 without cached content", async () => {
		const row = boardRow({ id: 211, workspace_id: ATLAS.id, key_number: 17 });
		const deps = sourceDeps({ tracker: [], board: [row] }, [ATLAS]);
		let sourceReads = 0;
		deps.getBoardRow = vi.fn(async () => {
			sourceReads += 1;
			// The first source read represents the row that was visible in the
			// list. The assignment is revoked before the final reauthorization.
			return sourceReads === 1 ? row : null;
		});

		const response = await request(testApp(createMyWorkRouter({ deps }))).get(
			"/my-work/7/board/AT-17",
		);

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "Not found" });
		expect(JSON.stringify(response.body)).not.toContain("Board card");
		expect(deps.getBoardRow).toHaveBeenCalledTimes(2);
	});

	it("RED 6: searches All candidates across active, terminal, and Other categories", async () => {
		const deps = sourceDeps({
			tracker: [
				trackerRow({
					id: 111,
					key_number: 11,
					title: "Active matching intent",
				}),
				trackerRow({
					id: 112,
					key_number: 12,
					title: "Completed matching intent",
					status_category: "completed",
					status_slot: "done",
				}),
				trackerRow({
					id: 113,
					key_number: 13,
					title: "Other matching intent",
					status_category: "unknown",
					status_slot: null,
				}),
			],
			board: [],
		});
		const result = await createMyWorkService(deps).list({
			userId: ALICE.id,
			scope: "all",
			q: "matching intent",
			now: NOW,
		});

		expect(result.items.map((item) => item.id)).toEqual([111, 112, 113]);
	});

	it("RED 6b: All-scope canonical key search finds AT-17", async () => {
		const result = await createMyWorkService(
			sourceDeps({
				tracker: [],
				board: [
					boardRow({
						id: 215,
						workspace_id: ATLAS.id,
						key_number: 17,
						title: "Canonical key match",
					}),
					boardRow({
						id: 216,
						workspace_id: ORBIT.id,
						key_number: 17,
						title: "Same number, different workspace",
					}),
				],
			}),
		).list({
			userId: ALICE.id,
			scope: "all",
			q: "AT-17",
			now: NOW,
		});

		expect(result.items.map((item) => item.identity)).toEqual([
			{ workspaceId: ATLAS.id, source: "board", key: "AT-17" },
		]);
	});

	it("RED 7: applies workspace and source filters before returning rows", async () => {
		const deps = sourceDeps({
			tracker: [
				trackerRow({ id: 114, workspace_id: ORBIT.id, key_number: 14 }),
			],
			board: [boardRow({ id: 214, workspace_id: ATLAS.id, key_number: 14 })],
		});
		const service = createMyWorkService(deps);

		const boardOnly = await service.list({
			userId: ALICE.id,
			scope: "all",
			workspaceId: ATLAS.id,
			source: "board",
			now: NOW,
		});
		const trackerOnly = await service.list({
			userId: ALICE.id,
			scope: "all",
			workspaceId: ORBIT.id,
			source: "tracker",
			now: NOW,
		});

		expect(boardOnly.items.map((item) => item.identity)).toEqual([
			{ workspaceId: 7, source: "board", key: "AT-14" },
		]);
		expect(trackerOnly.items.map((item) => item.identity)).toEqual([
			{ workspaceId: 12, source: "tracker", key: "OR-14" },
		]);
		expect(deps.listTrackerRows).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceIds: [12] }),
		);
		expect(deps.listBoardRows).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceIds: [7] }),
		);
	});

	it("RED 8: returns deterministic cursor pages without duplicates or gaps", async () => {
		const rows = Array.from({ length: 5 }, (_, index) =>
			trackerRow({
				id: 120 + index,
				workspace_id: ORBIT.id,
				key_number: 20 + index,
				title: `Page item ${index}`,
				updated_at: new Date(
					`2026-09-${String(10 - index).padStart(2, "0")}T00:00:00.000Z`,
				),
			}),
		);
		const service = createMyWorkService(
			sourceDeps({ tracker: rows, board: [] }),
		);
		const first = await service.list({
			userId: ALICE.id,
			scope: "all",
			limit: 2,
			now: NOW,
		});
		const second = await service.list({
			userId: ALICE.id,
			scope: "all",
			limit: 2,
			cursor: first.nextCursor,
			now: NOW,
		});
		const third = await service.list({
			userId: ALICE.id,
			scope: "all",
			limit: 2,
			cursor: second.nextCursor,
			now: NOW,
		});

		const ids = [...first.items, ...second.items, ...third.items].map(
			(item) => item.id,
		);
		expect(ids).toHaveLength(5);
		expect(new Set(ids).size).toBe(5);
		expect(third.nextCursor).toBeNull();
		expect(first.nextCursor).toBe(
			(
				await service.list({
					userId: ALICE.id,
					scope: "all",
					limit: 2,
					now: NOW,
				})
			).nextCursor,
		);
	});

	it("RED 6 query: captures canonical All-scope key predicates", async () => {
		const { executor, queries } = capturedDb();
		const source = createMyWorkDataSource(executor);
		await source.listTrackerRows({
			userId: ALICE.id,
			workspaceIds: [ATLAS.id, ORBIT.id],
			q: "AT-17",
			scope: "all",
			limit: 2,
			workspacePrefixes: new Map([
				[ATLAS.id, "AT"],
				[ORBIT.id, "OR"],
			]),
			workspaceLocalDates: new Map([
				[ATLAS.id, "2026-09-11"],
				[ORBIT.id, "2026-09-11"],
			]),
		});

		const query = queries.find((entry) =>
			entry.sql.includes('from "tracker_items"'),
		);
		expect(query).toBeDefined();
		expect(query?.sql).toContain('"ti"."key_number"');
		expect(query?.sql).toContain('"ti"."workspace_id"');
		expect(query?.parameters).toContain("%AT-17%");
		expect(query?.parameters).toContain(17);
		expect(query?.parameters).toContain(7);
		await executor.destroy();
	});

	it("RED 7 query: captures workspace/source filters at the DB boundary", async () => {
		const { executor, queries } = capturedDb();
		const service = createMyWorkService({
			executor,
			listAuthorizedWorkspaces: vi.fn(async () => [ATLAS, ORBIT]),
		});

		await service.list({
			userId: ALICE.id,
			scope: "all",
			workspaceId: ATLAS.id,
			source: "board",
			limit: 3,
			now: NOW,
		});

		const boardQuery = queries.find((entry) =>
			entry.sql.includes('from "cards"'),
		);
		expect(boardQuery).toBeDefined();
		expect(boardQuery?.sql).toContain('"c"."workspace_id" in');
		expect(boardQuery?.sql).toContain('"c"."workspace_id" =');
		expect(boardQuery?.sql).toContain('"c"."deleted_at" is null');
		expect(boardQuery?.sql).toContain('"card_assignees"');
		expect(boardQuery?.parameters).toContain(ATLAS.id);
		expect(boardQuery?.parameters).toContain(4);
		expect(
			queries.some((entry) => entry.sql.includes('from "tracker_items"')),
		).toBe(false);
		await executor.destroy();
	});

	it("RED 8 query: captures deterministic cursor predicates and bounded limits", async () => {
		const { executor, queries } = capturedDb();
		const source = createMyWorkDataSource(executor);
		await source.listTrackerRows({
			userId: ALICE.id,
			workspaceIds: [ORBIT.id],
			scope: "all",
			q: "",
			limit: 2,
			cursor: {
				group: 1,
				overdue: false,
				dueDate: null,
				updatedAt: "2026-09-10T00:00:00.000Z",
				workspaceId: ORBIT.id,
				source: "tracker",
				key: "OR-4",
				id: 100,
			},
			workspaceLocalDates: new Map([[ORBIT.id, "2026-09-11"]]),
		});

		const query = queries.find((entry) =>
			entry.sql.includes('from "tracker_items"'),
		);
		expect(query).toBeDefined();
		expect(query?.sql).toContain('"ti"."updated_at"');
		expect(query?.sql).toContain('"ti"."id" asc');
		expect(query?.sql).toMatch(/limit \$\d+/i);
		expect(query?.parameters).toContain(3);
		expect(query?.parameters).toContain("2026-09-10T00:00:00.000Z");
		expect(query?.parameters).toContain(100);
		await executor.destroy();
	});

	it("RED 9: maps an injected transient query failure to a retryable response without partial data", async () => {
		const deps = sourceDeps({
			tracker: [trackerRow({ id: 130, workspace_id: ORBIT.id })],
			board: [],
		});
		deps.listBoardRows = vi.fn(async () => {
			throw new Error("ETIMEDOUT while querying board rows");
		});
		const response = await request(testApp(createMyWorkRouter({ deps }))).get(
			"/my-work?scope=all",
		);

		expect(response.status).toBe(503);
		expect(response.body).toEqual({
			error: "Unable to load My Work",
			code: "my_work_unavailable",
			retryable: true,
		});
		expect(response.body.items).toBeUndefined();
	});
});
