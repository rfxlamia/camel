import { Kysely, PostgresDialect } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../../db/types.js";
import { createMyWorkService } from "./my-work.js";
import {
	ALICE,
	ATLAS,
	boardRow,
	type CapturedQuery,
	NEBULA,
	NOW,
	ORBIT,
	trackerRow,
} from "./my-work-test-support.js";

vi.mock("../../db/kysely.js", () => ({ db: {} }));

type MappingColumn = {
	id: number;
	workspace_id: number;
	board_id: number | null;
	position: number;
	is_done: boolean;
};

type MappingStatus = {
	id: number;
	workspace_id: number;
	kind: string;
	slot: "backlog" | "todo" | "in_progress" | "done" | "canceled" | null;
	position: number;
};

type MappingFixtures = {
	columns: MappingColumn[];
	statuses: MappingStatus[];
};

type FakeClient = {
	query: <R>(
		sqlText: string,
		parameters?: readonly unknown[],
	) => Promise<{ rows: R[] }>;
	release: () => void;
};

type FakePool = ConstructorParameters<typeof PostgresDialect>[0]["pool"];

function mappingDb(fixtures: MappingFixtures) {
	const queries: CapturedQuery[] = [];
	const client: FakeClient = {
		async query<R>(sqlText, parameters = []) {
			queries.push({ sql: sqlText, parameters });
			if (sqlText.includes('from "columns"')) {
				return { rows: fixtures.columns as R[] };
			}
			if (sqlText.includes('from "tracker_vocabularies"')) {
				return { rows: fixtures.statuses as R[] };
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
	} as unknown as FakePool;
	return {
		executor: new Kysely<DB>({ dialect: new PostgresDialect({ pool }) }),
		queries,
	};
}

function serviceFor(
	rows: {
		tracker: ReturnType<typeof trackerRow>[];
		board: ReturnType<typeof boardRow>[];
	},
	fixtures: MappingFixtures,
	workspaces = [ATLAS, ORBIT, NEBULA],
) {
	const { executor, queries } = mappingDb(fixtures);
	const service = createMyWorkService({
		executor,
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
	});
	return { service, queries };
}

const atlasColumns: MappingColumn[] = [
	{
		id: 11,
		workspace_id: ATLAS.id,
		board_id: null,
		position: 1,
		is_done: false,
	},
	{
		id: 12,
		workspace_id: ATLAS.id,
		board_id: null,
		position: 2,
		is_done: true,
	},
];

const atlasStatuses: MappingStatus[] = [
	{
		id: 101,
		workspace_id: ATLAS.id,
		kind: "status",
		slot: "in_progress",
		position: 1,
	},
	{
		id: 102,
		workspace_id: ATLAS.id,
		kind: "status",
		slot: "done",
		position: 2,
	},
];

describe("My Work Mark done capability boundary", () => {
	beforeEach(() => vi.clearAllMocks());

	it("serializes valid and missing Board/Tracker mappings from one batched input set", async () => {
		const validBoard = boardRow({
			id: 201,
			workspace_id: ATLAS.id,
			column_id: 11,
		});
		const missingBoard = boardRow({
			id: 202,
			workspace_id: NEBULA.id,
			column_id: 31,
		});
		const validTracker = trackerRow({ id: 203, workspace_id: ORBIT.id });
		const missingTracker = trackerRow({ id: 204, workspace_id: NEBULA.id });
		const { service, queries } = serviceFor(
			{
				board: [validBoard, missingBoard],
				tracker: [validTracker, missingTracker],
			},
			{
				columns: [
					...atlasColumns,
					{
						id: 31,
						workspace_id: NEBULA.id,
						board_id: null,
						position: 1,
						is_done: false,
					},
				],
				statuses: [
					...atlasStatuses,
					{
						id: 201,
						workspace_id: ORBIT.id,
						kind: "status",
						slot: "done",
						position: 3,
					},
				],
			},
		);

		const result = await service.list({
			userId: ALICE.id,
			scope: "all",
			now: NOW,
		});
		const capabilityById = new Map(
			result.items.map((item) => [
				item.id,
				[item.canMarkDone, item.markDoneReason],
			]),
		);

		expect(capabilityById.get(validBoard.id)).toEqual([true, null]);
		expect(capabilityById.get(validTracker.id)).toEqual([true, null]);
		expect(capabilityById.get(missingBoard.id)).toEqual([
			false,
			"missing_done_mapping",
		]);
		expect(capabilityById.get(missingTracker.id)).toEqual([
			false,
			"missing_done_mapping",
		]);
		expect(
			queries.filter(
				(entry) =>
					entry.sql.includes('from "columns"') ||
					entry.sql.includes('from "tracker_vocabularies"'),
			),
		).toHaveLength(2);
	});

	it("keeps terminal precedence over missing mappings and does not invent pending", async () => {
		const terminal = trackerRow({
			id: 301,
			workspace_id: NEBULA.id,
			status_category: "completed",
			status_slot: "done",
		});
		const nullCategoryTerminal = trackerRow({
			id: 302,
			workspace_id: NEBULA.id,
			key_number: 5,
			status_category: null,
			status_slot: "done",
		});
		const { service } = serviceFor(
			{ board: [], tracker: [terminal, nullCategoryTerminal] },
			{ columns: [], statuses: [] },
		);

		const result = await service.list({
			userId: ALICE.id,
			scope: "all",
			now: NOW,
		});
		expect(result.items).toHaveLength(2);
		for (const item of result.items) {
			expect(item.canMarkDone).toBe(false);
			expect(item.markDoneReason).toBe("terminal");
			expect(item.markDoneReason).not.toBe("pending");
		}
	});

	it("uses identical capability computation for list and reauthorized detail", async () => {
		const row = boardRow({ id: 401, workspace_id: ATLAS.id, column_id: 11 });
		const { service } = serviceFor(
			{ board: [row], tracker: [] },
			{ columns: atlasColumns, statuses: atlasStatuses },
			[ATLAS],
		);

		const list = await service.list({
			userId: ALICE.id,
			scope: "all",
			now: NOW,
		});
		const detail = await service.getDetail({
			userId: ALICE.id,
			workspaceId: ATLAS.id,
			source: "board",
			key: "AT-17",
			keyNumber: row.key_number,
		});

		expect(list.items[0]).toMatchObject({
			id: row.id,
			canMarkDone: true,
			markDoneReason: null,
		});
		expect(detail).toMatchObject({
			id: row.id,
			canMarkDone: true,
			markDoneReason: null,
		});
		expect([detail?.canMarkDone, detail?.markDoneReason]).toEqual([
			list.items[0]?.canMarkDone,
			list.items[0]?.markDoneReason,
		]);
	});

	it("hydrates mapping once per source set rather than once per row", async () => {
		const boardRows = Array.from({ length: 12 }, (_, index) =>
			boardRow({
				id: 500 + index,
				workspace_id: ATLAS.id,
				column_id: 11,
				key_number: index + 1,
			}),
		);
		const trackerRows = Array.from({ length: 12 }, (_, index) =>
			trackerRow({
				id: 600 + index,
				workspace_id: ORBIT.id,
				key_number: index + 1,
			}),
		);
		const { service, queries } = serviceFor(
			{ board: boardRows, tracker: trackerRows },
			{
				columns: atlasColumns,
				statuses: [
					...atlasStatuses,
					{
						id: 202,
						workspace_id: ORBIT.id,
						kind: "status",
						slot: "done",
						position: 1,
					},
				],
			},
			[ATLAS, ORBIT],
		);

		const result = await service.list({
			userId: ALICE.id,
			scope: "all",
			now: NOW,
		});
		const mappingQueries = queries.filter(
			(entry) =>
				entry.sql.includes('from "columns"') ||
				entry.sql.includes('from "tracker_vocabularies"'),
		);
		expect(result.items).toHaveLength(24);
		expect(mappingQueries).toHaveLength(2);
		expect(
			mappingQueries.some((entry) =>
				entry.parameters.some((value) => value === ORBIT.id),
			),
		).toBe(true);
	});
});
