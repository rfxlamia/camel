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
	decodeMyWorkCursor,
	isMyWorkItemOverdue,
	type MyWorkBoardRow,
	type MyWorkTrackerRow,
	type MyWorkWorkspace,
	mergeMyWorkRows,
	serializeMyWorkCandidate,
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

function pagedTrackerDb(
	firstPage: MyWorkTrackerRow[],
	secondPage: MyWorkTrackerRow[],
) {
	const queries: CapturedQuery[] = [];
	let trackerQueryCount = 0;
	const client = {
		async query<R>(sqlText: string, parameters: readonly unknown[] = []) {
			queries.push({ sql: sqlText, parameters });
			if (sqlText.includes('from "tracker_items"')) {
				const rows = trackerQueryCount++ === 0 ? firstPage : secondPage;
				return { rows: rows as R[] };
			}
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

function multiPageTrackerDb(rows: MyWorkTrackerRow[]) {
	const queries: CapturedQuery[] = [];
	const client = {
		async query<R>(sqlText: string, parameters: readonly unknown[] = []) {
			queries.push({ sql: sqlText, parameters });
			if (sqlText.includes('from "tracker_items"')) {
				const cursorId = parameters.find(
					(parameter): parameter is number =>
						typeof parameter === "number" &&
						rows.some((row) => row.id === parameter),
				);
				const cursorIndex =
					cursorId === undefined
						? -1
						: rows.findIndex((row) => row.id === cursorId);
				const offset = cursorIndex + 1;
				return { rows: rows.slice(offset, offset + 51) as R[] };
			}
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

type RawTimestampTrackerRow = {
	row: MyWorkTrackerRow;
	updatedAt: string;
};

function timestampMicros(value: string): number {
	const match = /^(.*)\.(\d{1,6})Z$/.exec(value);
	if (!match) throw new Error(`Unsupported timestamp fixture: ${value}`);
	const fraction = match[2]!.padEnd(6, "0");
	const millisecondValue = `${match[1]}.${fraction.slice(0, 3)}Z`;
	return Date.parse(millisecondValue) * 1_000 + Number(fraction.slice(3));
}

function subMillisecondTrackerDb(rows: readonly RawTimestampTrackerRow[]) {
	const queries: CapturedQuery[] = [];
	const client = {
		async query<R>(sqlText: string, parameters: readonly unknown[] = []) {
			queries.push({ sql: sqlText, parameters });
			if (!sqlText.includes('from "tracker_items"')) {
				return { rows: [] as R[] };
			}

			const cursorId = parameters.find(
				(parameter): parameter is number =>
					typeof parameter === "number" &&
					rows.some(({ row }) => row.id === parameter),
			);
			const cursorUpdatedAt = parameters.find(
				(parameter): parameter is string =>
					typeof parameter === "string" &&
					/^\d{4}-\d{2}-\d{2}T.*Z$/.test(parameter),
			);
			const usesMillisecondPrecision = sqlText.includes(
				"date_trunc('milliseconds'",
			);
			const cursorTime =
				cursorUpdatedAt === undefined
					? undefined
					: timestampMicros(cursorUpdatedAt);
			const eligible = rows.filter(({ row, updatedAt }) => {
				if (cursorId === undefined) return true;
				if (cursorTime === undefined) {
					throw new Error("Cursor timestamp was not captured");
				}
				const rowTime = timestampMicros(updatedAt);
				const rowOrderTime = usesMillisecondPrecision
					? Math.trunc(rowTime / 1_000)
					: rowTime;
				const cursorOrderTime = usesMillisecondPrecision
					? Math.trunc(cursorTime / 1_000)
					: cursorTime;
				if (rowOrderTime < cursorOrderTime) return true;
				if (rowOrderTime > cursorOrderTime) return false;
				return row.id > cursorId;
			});
			const ordered = [...eligible].sort((a, b) => {
				const aTime = timestampMicros(a.updatedAt);
				const bTime = timestampMicros(b.updatedAt);
				const aOrderTime = usesMillisecondPrecision
					? Math.trunc(aTime / 1_000)
					: aTime;
				const bOrderTime = usesMillisecondPrecision
					? Math.trunc(bTime / 1_000)
					: bTime;
				return bOrderTime - aOrderTime || a.row.id - b.row.id;
			});
			const queryLimit = parameters.at(-1);
			const pageRows = ordered.slice(
				0,
				typeof queryLimit === "number" ? queryLimit : 0,
			);
			return {
				rows: pageRows.map(({ row, updatedAt }) => ({
					...row,
					updated_at: new Date(Math.trunc(timestampMicros(updatedAt) / 1_000)),
				})) as R[],
			};
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

	it("keeps unknown non-null categories in Other despite terminal slots", async () => {
		const started = trackerRow({
			id: 110,
			key_number: 10,
			status_category: "started",
			status_slot: "in_progress",
		});
		const unknownTerminal = trackerRow({
			id: 111,
			key_number: 11,
			title: "Unknown terminal category",
			status_category: "mystery",
			status_slot: "done",
		});
		const nullTerminal = trackerRow({
			id: 112,
			key_number: 12,
			title: "Null category terminal slot",
			status_category: null,
			status_slot: "done",
		});
		const service = createMyWorkService(
			sourceDeps({ tracker: [started, unknownTerminal, nullTerminal], board: [] }),
		);

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

		expect(active.items.map((item) => item.id)).toEqual([
			started.id,
			unknownTerminal.id,
		]);
		const activeUnknown = active.items.find(
			(item) => item.id === unknownTerminal.id,
		);
		expect(activeUnknown?.statusCategory).toBeNull();
		expect(activeUnknown?.status.category).toBe("mystery");
		expect(activeUnknown?.status.slot).toBe("done");

		expect(all.items.map((item) => item.id)).toEqual([
			started.id,
			nullTerminal.id,
			unknownTerminal.id,
		]);
		expect(
			all.items.find((item) => item.id === unknownTerminal.id)?.statusCategory,
		).toBeNull();
		expect(
			all.items.find((item) => item.id === nullTerminal.id)?.statusCategory,
		).toBe("completed");
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

	it("keeps numeric key ordering across SQL, cursor, and response pages", async () => {
		const keyTwo = trackerRow({
			id: 302,
			workspace_id: ORBIT.id,
			key_number: 2,
			title: "Numeric key two",
			updated_at: NOW,
		});
		const keyTen = trackerRow({
			id: 310,
			workspace_id: ORBIT.id,
			key_number: 10,
			title: "Numeric key ten",
			updated_at: NOW,
		});
		const { executor, queries } = pagedTrackerDb([keyTwo, keyTen], [keyTen]);
		const source = createMyWorkDataSource(executor);
		const service = createMyWorkService({
			executor,
			listAuthorizedWorkspaces: vi.fn(async () => [ORBIT]),
			listTrackerRows: source.listTrackerRows,
			listBoardRows: vi.fn(async () => []),
			hydrateRows: async (candidates, workspaces) =>
				candidates.flatMap((candidate) => {
					const workspace = workspaces.get(candidate.row.workspace_id);
					return workspace
						? [serializeMyWorkCandidate(candidate, workspace)]
						: [];
				}),
		});

		const first = await service.list({
			userId: ALICE.id,
			scope: "all",
			limit: 1,
			now: NOW,
		});
		const second = await service.list({
			userId: ALICE.id,
			scope: "all",
			limit: 1,
			cursor: first.nextCursor,
			now: NOW,
		});

		const keys = [...first.items, ...second.items].map((item) => item.key);
		expect(keys).toEqual(["OR-2", "OR-10"]);
		expect(new Set(keys).size).toBe(2);
		expect(first.nextCursor).not.toBeNull();
		expect(second.nextCursor).toBeNull();

		const trackerQueries = queries.filter((entry) =>
			entry.sql.includes('from "tracker_items"'),
		);
		expect(trackerQueries).toHaveLength(2);
		expect(trackerQueries[0]?.sql).toContain('"ti"."key_number" asc');
		expect(trackerQueries[1]?.sql).toContain('"ti"."key_number" =');
		expect(trackerQueries[1]?.parameters).toContain(2);
		await executor.destroy();
	});

	it("paginates overdue Other rows across bounded query and response pages", async () => {
		const otherRows = Array.from({ length: 70 }, (_, index) => {
			const keyNumber = index + 1;
			const endDate =
				index < 55
					? "2026-09-10"
					: index < 60
						? "2026-09-11"
						: index < 65
							? "2026-09-12"
							: null;
			return trackerRow({
				id: 4000 + index,
				workspace_id: ORBIT.id,
				key_number: keyNumber,
				title: `Other item ${keyNumber}`,
				status_category: "mystery",
				status_slot: "done",
				end_date: endDate,
				updated_at: NOW,
			});
		});
		const undefinedCategory = trackerRow({
			id: 4071,
			workspace_id: ORBIT.id,
			key_number: 71,
			title: "Undefined category control",
			status_category: null,
			status_slot: "in_progress",
			end_date: "2026-09-10",
			updated_at: NOW,
		});
		delete (undefinedCategory as unknown as { status_category?: string | null })
			.status_category;
		const nullCategoryTerminal = trackerRow({
			id: 4072,
			workspace_id: ORBIT.id,
			key_number: 72,
			title: "Null category terminal control",
			status_category: null,
			status_slot: "done",
			end_date: "2026-09-10",
			updated_at: NOW,
		});
		const canceled = trackerRow({
			id: 4073,
			workspace_id: ORBIT.id,
			key_number: 73,
			title: "Canceled control",
			status_category: "canceled",
			status_slot: "in_progress",
			end_date: "2026-09-10",
			updated_at: NOW,
		});
		const rows = [
			undefinedCategory,
			nullCategoryTerminal,
			canceled,
			...otherRows,
		];
		const { executor, queries } = multiPageTrackerDb(rows);
		const service = createMyWorkService({
			executor,
			listAuthorizedWorkspaces: vi.fn(async () => [ORBIT]),
			hydrateRows: async (candidates, workspaces) =>
				candidates.flatMap((candidate) => {
					const workspace = workspaces.get(candidate.row.workspace_id);
					return workspace
						? [serializeMyWorkCandidate(candidate, workspace)]
						: [];
				}),
		});

		const pages = [] as Awaited<ReturnType<typeof service.list>>[];
		let cursor: string | null = null;
		for (;;) {
			const page = await service.list({
				userId: ALICE.id,
				scope: "all",
				limit: 50,
				cursor,
				now: NOW,
			});
			pages.push(page);
			if (page.nextCursor === null) break;
			cursor = page.nextCursor;
			expect(pages.length).toBeLessThan(3);
		}

		expect(pages).toHaveLength(2);
		expect(pages[0]?.items).toHaveLength(50);
		expect(pages[1]?.items).toHaveLength(23);
		expect(pages[0]?.nextCursor).not.toBeNull();
		expect(pages[1]?.nextCursor).toBeNull();

		const firstCursor = decodeMyWorkCursor(pages[0]?.nextCursor ?? "");
		expect(firstCursor).toMatchObject({
			group: 4,
			overdue: true,
			dueDate: "2026-09-10",
			workspaceId: ORBIT.id,
			source: "tracker",
			key: "OR-47",
			keyNumber: 47,
			id: 4046,
		});

		const items = pages.flatMap((page) => page.items);
		const expectedIdentities = rows.map((row) => ({
			workspaceId: ORBIT.id,
			source: "tracker" as const,
			key: `OR-${row.key_number}`,
		}));
		expect(items.map((item) => item.identity)).toEqual(expectedIdentities);
		const identityStrings = items.map((item) => JSON.stringify(item.identity));
		expect(new Set(identityStrings).size).toBe(73);
		expect(items).toHaveLength(73);

		const numericKeys = items
			.filter((item) => item.key === "OR-2" || item.key === "OR-10")
			.map((item) => item.key);
		expect(numericKeys).toEqual(["OR-2", "OR-10"]);

		const unknownDone = items.find((item) => item.key === "OR-2");
		expect(unknownDone).toMatchObject({
			statusCategory: null,
			status: { category: "mystery", slot: "done" },
		});
		expect(isMyWorkItemOverdue(unknownDone!, NOW)).toBe(true);
		const dueToday = items.find((item) => item.key === "OR-56");
		expect(isMyWorkItemOverdue(dueToday!, NOW)).toBe(false);
		const undefinedControl = items.find((item) => item.key === "OR-71");
		expect(undefinedControl).toMatchObject({ statusCategory: "started" });
		expect(isMyWorkItemOverdue(undefinedControl!, NOW)).toBe(true);
		const nullControl = items.find((item) => item.key === "OR-72");
		expect(nullControl).toMatchObject({
			statusCategory: "completed",
			status: { category: null, slot: "done" },
		});
		expect(isMyWorkItemOverdue(nullControl!, NOW)).toBe(false);
		const canceledControl = items.find((item) => item.key === "OR-73");
		expect(isMyWorkItemOverdue(canceledControl!, NOW)).toBe(false);

		const trackerQueries = queries.filter((entry) =>
			entry.sql.includes('from "tracker_items"'),
		);
		expect(trackerQueries).toHaveLength(2);
		const firstQuery = trackerQueries[0]!;
		const secondQuery = trackerQueries[1]!;
		expect(firstQuery.sql).toContain("NOT IN (2, 3)");
		expect(firstQuery.sql).not.toContain(" < 2");
		expect(firstQuery.sql).toContain('"ti"."key_number" asc');
		expect(firstQuery.sql).toContain('"ti"."id" asc');
		expect(firstQuery.parameters).toContain("2026-09-11");
		expect(firstQuery.parameters).toContain(51);
		expect(secondQuery.sql).toContain('"ti"."key_number" =');
		expect(secondQuery.sql).toContain('"ti"."id" >');
		expect(secondQuery.parameters).toContain(firstCursor?.keyNumber);
		expect(secondQuery.parameters).toContain(firstCursor?.id);
		expect(secondQuery.parameters).toContain(51);
		await executor.destroy();
	});

	it("keeps unknown non-null categories active at the SQL boundary", async () => {
		const { executor, queries } = capturedDb();
		const source = createMyWorkDataSource(executor);
		await source.listTrackerRows({
			userId: ALICE.id,
			workspaceIds: [ORBIT.id],
			q: "",
			scope: "active",
			limit: 2,
			workspaceLocalDates: new Map([[ORBIT.id, "2026-09-11"]]),
		});

		const query = queries.find((entry) =>
			entry.sql.includes('from "tracker_items"'),
		);
		expect(query).toBeDefined();
		const sqlText = query?.sql ?? "";
		const fallbackGuard = sqlText.indexOf("st.category IS NULL");
		const slotFallback = sqlText.indexOf("st.slot IN");
		expect(fallbackGuard).toBeGreaterThanOrEqual(0);
		expect(slotFallback).toBeGreaterThan(fallbackGuard);
		expect(sqlText).toContain("st.category = 'completed'");
		expect(sqlText).toMatch(/CASE[\s\S]*st.category IS NULL[\s\S]*st.slot IN/);
		expect(sqlText).toMatch(/NOT IN \(2, 3\)/);
		await executor.destroy();
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

	it("normalizes SQL cursor timestamp precision across a sub-millisecond page boundary", async () => {
		const rows: RawTimestampTrackerRow[] = [
			{
				row: trackerRow({
					id: 5001,
					workspace_id: ORBIT.id,
					key_number: 1,
					status_category: "started",
				}),
				updatedAt: "2026-09-10T00:00:00.124900Z",
			},
			{
				row: trackerRow({
					id: 5002,
					workspace_id: ORBIT.id,
					key_number: 2,
					status_category: "started",
				}),
				updatedAt: "2026-09-10T00:00:00.124500Z",
			},
			{
				row: trackerRow({
					id: 5003,
					workspace_id: ORBIT.id,
					key_number: 3,
					status_category: "started",
				}),
				updatedAt: "2026-09-10T00:00:00.123900Z",
			},
		];
		const { executor, queries } = subMillisecondTrackerDb(rows);
		const source = createMyWorkDataSource(executor);
		const service = createMyWorkService({
			executor,
			listAuthorizedWorkspaces: vi.fn(async () => [ORBIT]),
			listTrackerRows: source.listTrackerRows,
			listBoardRows: vi.fn(async () => []),
			hydrateRows: async (candidates, workspaces) =>
				candidates.flatMap((candidate) => {
					const workspace = workspaces.get(candidate.row.workspace_id);
					return workspace
						? [serializeMyWorkCandidate(candidate, workspace)]
						: [];
				}),
		});

		const pages: Awaited<ReturnType<typeof service.list>>[] = [];
		let cursor: string | null = null;
		for (;;) {
			const page = await service.list({
				userId: ALICE.id,
				scope: "all",
				limit: 1,
				cursor,
				now: NOW,
			});
			pages.push(page);
			if (page.nextCursor === null) break;
			cursor = page.nextCursor;
			expect(pages.length).toBeLessThan(4);
		}

		expect(pages).toHaveLength(3);
		expect(pages.map((page) => page.items.map((item) => item.key))).toEqual([
			["OR-1"],
			["OR-2"],
			["OR-3"],
		]);
		expect(pages[0]?.nextCursor).not.toBeNull();
		expect(pages[1]?.nextCursor).not.toBeNull();
		expect(pages[2]?.nextCursor).toBeNull();

		const identities = pages.flatMap((page) => page.items.map((item) => item.identity));
		expect(identities).toEqual(
			rows.map(({ row }) => ({
				workspaceId: ORBIT.id,
				source: "tracker" as const,
				key: `OR-${row.key_number}`,
			})),
		);
		expect(new Set(identities.map((identity) => JSON.stringify(identity))).size).toBe(
			rows.length,
		);

		const firstCursor = decodeMyWorkCursor(pages[0]?.nextCursor ?? "");
		const secondCursor = decodeMyWorkCursor(pages[1]?.nextCursor ?? "");
		expect(firstCursor).toMatchObject({ key: "OR-1", id: 5001 });
		expect(secondCursor).toMatchObject({ key: "OR-2", id: 5002 });
		expect(firstCursor?.updatedAt).toBe("2026-09-10T00:00:00.124Z");
		expect(secondCursor?.updatedAt).toBe("2026-09-10T00:00:00.124Z");

		const trackerQueries = queries.filter((entry) =>
			entry.sql.includes('from "tracker_items"'),
		);
		expect(trackerQueries).toHaveLength(3);
		const updatedExpression = `date_trunc('milliseconds', "ti"."updated_at")`;
		expect(trackerQueries[0]?.sql).toContain(`${updatedExpression} desc`);
		for (const query of trackerQueries) {
			expect(query.sql).toContain(updatedExpression);
			expect(query.sql).not.toContain('"ti"."updated_at" desc');
		}
		for (const query of trackerQueries.slice(1)) {
			expect(query.sql).toContain(`${updatedExpression} <`);
			expect(query.sql).toContain(`${updatedExpression} =`);
			expect(query.sql).not.toContain('"ti"."updated_at" <');
			expect(query.sql).not.toContain('"ti"."updated_at" =');
		}
		expect(trackerQueries[1]?.parameters).toContain(
			"2026-09-10T00:00:00.124Z",
		);
		expect(trackerQueries[2]?.parameters).toContain(
			"2026-09-10T00:00:00.124Z",
		);
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
