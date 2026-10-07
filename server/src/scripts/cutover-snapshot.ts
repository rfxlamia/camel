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
import { loadCardAttachmentsForCards } from "../modules/board/attachment-response.js";
import { buildBoardResponse } from "../modules/board/board.js";

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
		SELECT w.id AS workspace_id,
			COALESCE((
				SELECT array_agg(item_key ORDER BY item_key)
				FROM (
					SELECT c.key_number AS item_key
					FROM cards c
					LEFT JOIN columns col ON col.id = c.column_id
					WHERE c.workspace_id = w.id AND c.deleted_at IS NULL
					  AND col.board_id IS NULL AND c.key_number IS NOT NULL
					UNION ALL
					SELECT ti.key_number
					FROM tracker_items ti
					WHERE ti.workspace_id = w.id AND ti.deleted_at IS NULL
					  AND ti.key_number IS NOT NULL
				) visible_keys
			), ARRAY[]::integer[]) AS keys,
			(SELECT count(*)::integer FROM tracker_items ti
				WHERE ti.workspace_id = w.id AND ti.deleted_at IS NULL
				  AND ti.key_number IS NOT NULL) AS tracker_count,
			(SELECT count(*)::integer FROM cards c
				LEFT JOIN columns col ON col.id = c.column_id
				WHERE c.workspace_id = w.id AND c.deleted_at IS NULL
				  AND col.board_id IS NULL) AS board_count,
			(SELECT count(*)::integer FROM cards c
				LEFT JOIN columns col ON col.id = c.column_id
				WHERE c.workspace_id = w.id AND c.deleted_at IS NULL
				  AND col.board_id IS NULL AND c.started_at IS NOT NULL
				  AND c.done_at IS NULL) AS in_progress_count,
			(SELECT count(*)::integer FROM cards c
				LEFT JOIN columns col ON col.id = c.column_id
				WHERE c.workspace_id = w.id AND c.deleted_at IS NULL
				  AND col.board_id IS NULL AND c.done_at IS NOT NULL) AS done_count
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

async function readMergedWorkspace(dbExec: DBExecutor, workspace: Workspace) {
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

/** Compare the snapshot with merged list and board response production readers. */
export async function verifySnapshot(
	dbExec: DBExecutor,
	snapshot: CutoverSnapshot,
): Promise<boolean> {
	const current = await dbExec
		.selectFrom("workspaces")
		.select(["id", "name"])
		.orderBy("id")
		.execute();
	if (current.length !== snapshot.workspaces.length) return false;

	const expectedById = new Map(
		snapshot.workspaces.map((workspace) => [workspace.workspaceId, workspace]),
	);
	for (const workspace of current) {
		const expected = expectedById.get(workspace.id);
		if (!expected) return false;
		const actual = await readMergedWorkspace(dbExec, workspace);
		if (
			JSON.stringify(actual.keys) !== JSON.stringify(expected.keys) ||
			actual.trackerCount !== expected.trackerCount ||
			actual.boardCount !== expected.boardCount ||
			actual.inProgressCount !== expected.inProgressCount ||
			actual.doneCount !== expected.doneCount
		) {
			return false;
		}
	}
	return true;
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
		const matches = await verifySnapshot(db, snapshot);
		console.log(JSON.stringify({ event: "cutover_verify", matches }));
		return matches ? 0 : 1;
	} catch (error) {
		console.error("Cutover snapshot operation failed:", error);
		return 1;
	}
}

if (/(^|[\\/])cutover-snapshot\.(?:js|ts)$/.test(process.argv[1] ?? "")) {
	process.exit(await main(process.argv.slice(2)));
}
