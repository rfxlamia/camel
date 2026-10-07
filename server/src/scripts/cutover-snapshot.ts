import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { sql } from "kysely";
import { derivePrefix } from "../core/tracker-key.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { loadCardAssigneesForCards } from "../lib/card-assignees.js";
import { loadCardLabelsForCards } from "../lib/card-response.js";
import { getHumanColumns } from "../lib/helpers.js";
import {
	listMergedWorkItems,
	selectBoardWorkItemRows,
} from "../lib/work-item-response.js";
import {
	buildBoardResponse,
	loadCardAttachmentsForCards,
} from "../modules/board/index.js";

export type WorkspaceSnapshot = {
	workspaceId: number;
	keys: number[];
	trackerCount: number;
	boardCount: number;
	inProgressCount: number;
	doneCount: number;
};

export type CutoverSnapshot = {
	version: 1;
	workspaces: WorkspaceSnapshot[];
};

type SnapshotMetrics = Omit<WorkspaceSnapshot, "workspaceId">;
type MetricKey = keyof SnapshotMetrics;
type MetricValue = number | number[] | null;

type MetricDifferences = Partial<
	Record<MetricKey, { expected: MetricValue; actual: MetricValue }>
>;

export type WorkspaceComparison = {
	workspaceId: number;
	matches: boolean;
	differences: MetricDifferences;
};

export type VerificationReport = {
	matches: boolean;
	workspaces: WorkspaceComparison[];
	mismatches: WorkspaceComparison[];
};

type SnapshotRow = {
	workspace_id: number;
	keys: number[];
	tracker_count: number;
	board_count: number;
	in_progress_count: number;
	done_count: number;
};

type Workspace = { id: number; name: string };

function parseKeyNumber(key: unknown): number {
	if (typeof key !== "string") throw new Error("Merged work item has no key");
	const match = /-([0-9]+)$/.exec(key);
	if (!match) throw new Error("Merged work item key is invalid");
	return Number(match[1]);
}

/** Capture the old two-table view. This function only reads database state. */
export async function takeSnapshot(
	dbExec: DBExecutor,
): Promise<CutoverSnapshot> {
	const { rows } = await sql<SnapshotRow>`
		WITH visible_board AS (
			SELECT c.workspace_id, c.key_number, c.started_at, c.done_at
			FROM cards c
			JOIN columns col ON col.id = c.column_id
			WHERE c.deleted_at IS NULL AND col.board_id IS NULL
		), visible_tracker AS (
			SELECT ti.workspace_id, ti.key_number
			FROM tracker_items ti
			WHERE ti.deleted_at IS NULL AND ti.migrated_to_id IS NULL
			  AND ti.key_number IS NOT NULL
		)
		SELECT w.id AS workspace_id,
			COALESCE((
				SELECT array_agg(item_key ORDER BY item_key)
				FROM (
					SELECT b.key_number AS item_key
					FROM visible_board b
					WHERE b.workspace_id = w.id AND b.key_number IS NOT NULL
					UNION ALL
					SELECT t.key_number
					FROM visible_tracker t
					WHERE t.workspace_id = w.id
				) visible_keys
			), ARRAY[]::integer[]) AS keys,
			(SELECT count(*)::integer FROM visible_tracker t
				WHERE t.workspace_id = w.id) AS tracker_count,
			(SELECT count(*)::integer FROM visible_board b
				WHERE b.workspace_id = w.id) AS board_count,
			(SELECT count(*)::integer FROM visible_board b
				WHERE b.workspace_id = w.id AND b.started_at IS NOT NULL
				  AND b.done_at IS NULL) AS in_progress_count,
			(SELECT count(*)::integer FROM visible_board b
				WHERE b.workspace_id = w.id AND b.done_at IS NOT NULL) AS done_count
		FROM workspaces w
		ORDER BY w.id
	`.execute(dbExec);

	return {
		version: 1,
		workspaces: rows.map((row) => ({
			workspaceId: Number(row.workspace_id),
			keys: row.keys.map(Number),
			trackerCount: Number(row.tracker_count),
			boardCount: Number(row.board_count),
			inProgressCount: Number(row.in_progress_count),
			doneCount: Number(row.done_count),
		})),
	};
}

async function readMergedWorkspace(
	dbExec: DBExecutor,
	workspace: Workspace,
): Promise<SnapshotMetrics> {
	const prefix = derivePrefix(workspace.name);
	const [items, columns, boardRows] = await Promise.all([
		listMergedWorkItems(dbExec, workspace.id, prefix, ""),
		getHumanColumns(dbExec, workspace.id),
		selectBoardWorkItemRows(dbExec)
			.innerJoin("workspaces as w", "w.id", "c.workspace_id")
			.select(["c.workspace_id", "w.name as workspace_name"])
			.where("c.workspace_id", "=", workspace.id)
			.where("c.deleted_at", "is", null)
			.where("c.column_id", "is not", null)
			.orderBy("c.position")
			.execute(),
	]);

	const cardIds = boardRows.map((row) => row.id);
	const [assignees, labels, attachments] = await Promise.all([
		loadCardAssigneesForCards(dbExec, cardIds),
		loadCardLabelsForCards(dbExec, cardIds),
		loadCardAttachmentsForCards(dbExec, workspace.id, cardIds),
	]);
	const board = buildBoardResponse(
		columns,
		boardRows,
		assignees,
		labels,
		attachments,
	);
	const boardCards = board.columns.flatMap((column) => column.cards);
	const numbers = items
		.map((item) => parseKeyNumber(item.key))
		.sort((a, b) => a - b);

	return {
		keys: numbers,
		trackerCount: items.filter((item) => item.source === "tracker").length,
		boardCount: boardCards.length,
		inProgressCount: boardCards.filter((card) => !card.doneAt && card.startedAt)
			.length,
		doneCount: boardCards.filter((card) => card.doneAt).length,
	};
}

function compareMetrics(
	expected: SnapshotMetrics | null,
	actual: SnapshotMetrics | null,
): MetricDifferences {
	const differences: MetricDifferences = {};
	const metrics: MetricKey[] = [
		"keys",
		"trackerCount",
		"boardCount",
		"inProgressCount",
		"doneCount",
	];
	for (const metric of metrics) {
		const expectedValue = expected?.[metric] ?? null;
		const actualValue = actual?.[metric] ?? null;
		const equal =
			expectedValue !== null &&
			actualValue !== null &&
			(metric === "keys"
				? JSON.stringify(expectedValue) === JSON.stringify(actualValue)
				: expectedValue === actualValue);
		if (!equal)
			differences[metric] = { expected: expectedValue, actual: actualValue };
	}
	return differences;
}

/** Compare the snapshot with merged list and board response production readers. */
export async function verifySnapshot(
	dbExec: DBExecutor,
	snapshot: CutoverSnapshot,
): Promise<VerificationReport> {
	const current = await dbExec
		.selectFrom("workspaces")
		.select(["id", "name"])
		.orderBy("id")
		.execute();
	const expectedById = new Map(
		snapshot.workspaces.map((workspace) => [workspace.workspaceId, workspace]),
	);
	const currentById = new Map(
		current.map((workspace) => [workspace.id, workspace]),
	);
	const workspaceIds = [
		...new Set([...expectedById.keys(), ...currentById.keys()]),
	].sort((a, b) => a - b);
	const workspaces: WorkspaceComparison[] = [];

	for (const workspaceId of workspaceIds) {
		const expectedSnapshot = expectedById.get(workspaceId);
		const currentWorkspace = currentById.get(workspaceId);
		const actual = currentWorkspace
			? await readMergedWorkspace(dbExec, currentWorkspace)
			: null;
		const differences = compareMetrics(expectedSnapshot ?? null, actual);
		workspaces.push({
			workspaceId,
			matches: Object.keys(differences).length === 0,
			differences,
		});
	}

	const mismatches = workspaces.filter((workspace) => !workspace.matches);
	return { matches: mismatches.length === 0, workspaces, mismatches };
}

export async function main(argv: string[]): Promise<number> {
	const [mode, file, ...extra] = argv;
	if (!file || extra.length > 0 || (mode !== "snapshot" && mode !== "verify")) {
		console.error("Usage: cutover-snapshot <snapshot|verify> <file>");
		return 2;
	}

	try {
		if (mode === "snapshot") {
			const snapshot = await takeSnapshot(db);
			await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`, {
				mode: 0o600,
			});
			console.log(
				JSON.stringify({
					event: "cutover_snapshot",
					workspaces: snapshot.workspaces.length,
				}),
			);
			return 0;
		}

		const snapshot = JSON.parse(
			await readFile(file, "utf8"),
		) as CutoverSnapshot;
		const report = await verifySnapshot(db, snapshot);
		for (const mismatch of report.mismatches) {
			console.error(
				JSON.stringify({
					event: "cutover_verify_mismatch",
					workspaceId: mismatch.workspaceId,
					differences: mismatch.differences,
				}),
			);
		}
		console.log(
			JSON.stringify({
				event: "cutover_verify",
				matches: report.matches,
				mismatchCount: report.mismatches.length,
			}),
		);
		return report.matches ? 0 : 1;
	} catch (error) {
		console.error("Cutover snapshot operation failed:", error);
		return 1;
	}
}

if (/(^|[\\/])cutover-snapshot\.(?:js|ts)$/.test(process.argv[1] ?? "")) {
	process.exit(await main(process.argv.slice(2)));
}
