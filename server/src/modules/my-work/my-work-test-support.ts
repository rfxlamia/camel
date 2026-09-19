import express from "express";
import { Kysely, PostgresDialect } from "kysely";
import { vi } from "vitest";
import type { AuthUser } from "../../auth.js";
import type { DB } from "../../db/types.js";
import { createMyWorkRouter, type MyWorkDataSource } from "./my-work.js";
import {
	type MyWorkBoardRow,
	type MyWorkTrackerRow,
	type MyWorkWorkspace,
	serializeMyWorkCandidate,
} from "./my-work-response.js";
import type { MyWorkCandidate, MyWorkSerializedItem } from "./my-work-types.js";

export const ATLAS: MyWorkWorkspace = {
	id: 7,
	name: "Atlas",
	timezone: "Asia/Jakarta",
};
export const ORBIT: MyWorkWorkspace = {
	id: 12,
	name: "Orbit",
	timezone: "UTC",
};
export const NEBULA: MyWorkWorkspace = {
	id: 19,
	name: "Nebula",
	timezone: "UTC",
};
export const NOW = new Date("2026-09-11T06:00:00.000Z");

export function trackerRow(
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

export function boardRow(
	overrides: Partial<MyWorkBoardRow> = {},
): MyWorkBoardRow {
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

export type MyWorkServiceDepsForTest = Partial<MyWorkDataSource>;

export function sourceDeps(
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

export function duplicateJoinRows() {
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
	return {
		atlasTracker,
		orbitTracker,
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
	};
}

export const ALICE: AuthUser = {
	id: 42,
	username: "alice",
	displayName: "Alice",
	email: "alice@example.com",
	emailVerified: true,
	needsUsername: false,
};

export function testApp(router: ReturnType<typeof createMyWorkRouter>) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = ALICE;
		next();
	});
	app.use("/my-work", router);
	return app;
}

export type CapturedQuery = {
	sql: string;
	parameters: readonly unknown[];
};

type FakePostgresPool = ConstructorParameters<
	typeof PostgresDialect
>[0]["pool"];

export function capturedDb() {
	const queries: CapturedQuery[] = [];
	const client = {
		async query<R>(sqlText: string, parameters: readonly unknown[] = []) {
			queries.push({ sql: sqlText, parameters });
			return { rows: [] as R[] };
		},
		release() {
			// The fake client has no resources to release.
		},
	};
	const pool = {
		options: {},
		async connect() {
			return client;
		},
		async end() {
			// The fake pool has no resources to close.
		},
	} as unknown as FakePostgresPool;
	const executor = new Kysely<DB>({
		dialect: new PostgresDialect({ pool }),
	});
	return { executor, queries };
}

export function hydrateRows(
	candidates: readonly MyWorkCandidate[],
	workspaces: ReadonlyMap<number, MyWorkWorkspace>,
): Promise<MyWorkSerializedItem[]> {
	return Promise.resolve(
		candidates.flatMap((candidate) => {
			const workspace = workspaces.get(candidate.row.workspace_id);
			return workspace ? [serializeMyWorkCandidate(candidate, workspace)] : [];
		}),
	);
}
