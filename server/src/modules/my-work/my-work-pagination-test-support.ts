import { Kysely, PostgresDialect } from "kysely";
import type { DB } from "../../db/types.js";
import type { MyWorkTrackerRow } from "./my-work-response.js";
import {
	type CapturedQuery,
	NOW,
	ORBIT,
	trackerRow,
} from "./my-work-test-support.js";

export function pagedTrackerDb(
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
		release() {
			// The fake client has no resources to release.
		},
	};
	return { executor: createTestExecutor(client), queries };
}

export function multiPageTrackerDb(rows: MyWorkTrackerRow[]) {
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
				return {
					rows: rows.slice(cursorIndex + 1, cursorIndex + 52) as R[],
				};
			}
			return { rows: [] as R[] };
		},
		release() {
			// The fake client has no resources to release.
		},
	};
	return { executor: createTestExecutor(client), queries };
}

type FakePostgresPool = ConstructorParameters<
	typeof PostgresDialect
>[0]["pool"];

type TestQueryClient = {
	query: <R>(
		sqlText: string,
		parameters?: readonly unknown[],
	) => Promise<{ rows: R[] }>;
	release: () => void;
};

function createTestExecutor(client: TestQueryClient) {
	const pool = {
		options: {},
		async connect() {
			return client;
		},
		async end() {
			// The fake pool has no resources to close.
		},
	} as unknown as FakePostgresPool;
	return new Kysely<DB>({
		dialect: new PostgresDialect({ pool }),
	});
}

export type RawTimestampTrackerRow = {
	row: MyWorkTrackerRow;
	updatedAt: string;
};

export function timestampMicros(value: string): number {
	const match = /^(.*)\.(\d{1,6})Z$/.exec(value);
	if (!match) throw new Error(`Unsupported timestamp fixture: ${value}`);
	const fraction = match[2]!.padEnd(6, "0");
	const millisecondValue = `${match[1]}.${fraction.slice(0, 3)}Z`;
	return Date.parse(millisecondValue) * 1_000 + Number(fraction.slice(3));
}

function cursorTimestamp(parameters: readonly unknown[]): string | undefined {
	return parameters.find(
		(parameter): parameter is string =>
			typeof parameter === "string" &&
			/^\d{4}-\d{2}-\d{2}T.*Z$/.test(parameter),
	);
}

function cursorIdFor(
	rows: readonly RawTimestampTrackerRow[],
	parameters: readonly unknown[],
): number | undefined {
	return parameters.find(
		(parameter): parameter is number =>
			typeof parameter === "number" &&
			rows.some(({ row }) => row.id === parameter),
	);
}

function orderedTimestamp(
	value: string,
	millisecondPrecision: boolean,
): number {
	const micros = timestampMicros(value);
	return millisecondPrecision ? Math.trunc(micros / 1_000) : micros;
}

function isAfterTimestampCursor(
	row: RawTimestampTrackerRow,
	cursorId: number,
	cursorTime: number,
	millisecondPrecision: boolean,
): boolean {
	const rowTime = orderedTimestamp(row.updatedAt, millisecondPrecision);
	const cursorOrderTime = millisecondPrecision
		? Math.trunc(cursorTime / 1_000)
		: cursorTime;
	if (rowTime < cursorOrderTime) return true;
	if (rowTime > cursorOrderTime) return false;
	return row.row.id > cursorId;
}

function subMillisecondRows<R>(
	rows: readonly RawTimestampTrackerRow[],
	sqlText: string,
	parameters: readonly unknown[],
): R[] {
	if (!sqlText.includes('from "tracker_items"')) return [];
	const cursorId = cursorIdFor(rows, parameters);
	const cursorUpdatedAt = cursorTimestamp(parameters);
	const millisecondPrecision = sqlText.includes("date_trunc('milliseconds'");
	const cursorTime =
		cursorUpdatedAt === undefined
			? undefined
			: timestampMicros(cursorUpdatedAt);
	if (cursorId !== undefined && cursorTime === undefined) {
		throw new Error("Cursor timestamp was not captured");
	}
	const eligible = rows.filter((row) =>
		cursorId === undefined
			? true
			: isAfterTimestampCursor(
					row,
					cursorId,
					cursorTime!,
					millisecondPrecision,
				),
	);
	const ordered = [...eligible].sort(
		(a, b) =>
			orderedTimestamp(b.updatedAt, millisecondPrecision) -
				orderedTimestamp(a.updatedAt, millisecondPrecision) ||
			a.row.id - b.row.id,
	);
	const queryLimit = parameters.at(-1);
	const pageRows = ordered.slice(
		0,
		typeof queryLimit === "number" ? queryLimit : 0,
	);
	return pageRows.map(({ row, updatedAt }) => ({
		...row,
		updated_at: new Date(Math.trunc(timestampMicros(updatedAt) / 1_000)),
	})) as R[];
}

export function subMillisecondTrackerDb(
	rows: readonly RawTimestampTrackerRow[],
) {
	const queries: CapturedQuery[] = [];
	const client = {
		async query<R>(sqlText: string, parameters: readonly unknown[] = []) {
			queries.push({ sql: sqlText, parameters });
			return { rows: subMillisecondRows<R>(rows, sqlText, parameters) };
		},
		release() {
			// The fake client has no resources to release.
		},
	};
	return { executor: createTestExecutor(client), queries };
}

export function overdueOtherRows(): MyWorkTrackerRow[] {
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
	return [...overdueControlRows(), ...otherRows];
}

function overdueControlRows(): MyWorkTrackerRow[] {
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
	return [undefinedCategory, nullCategoryTerminal, canceled];
}

export function precisionRows(): RawTimestampTrackerRow[] {
	return [
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
}
