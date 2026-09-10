import type { DBExecutor } from "../db/kysely.js";
import type {
	AttachmentPair,
	AttachmentStorage,
} from "../lib/attachment-storage.js";

type AttachmentPathRow = {
	thumbnail_path: string;
	original_path: string;
};

function toAttachmentPairs(
	rows: readonly AttachmentPathRow[],
): AttachmentPair[] {
	return rows.map(({ thumbnail_path, original_path }) => ({
		thumbnailPath: thumbnail_path,
		originalPath: original_path,
	}));
}

export async function loadAttachmentPairsForWorkspace(
	dbExec: DBExecutor,
	workspaceId: number,
): Promise<AttachmentPair[]> {
	const rows = await dbExec
		.selectFrom("attachments as a")
		.innerJoin("cards as c", "c.id", "a.card_id")
		.select(["a.thumbnail_path", "a.original_path"])
		.where("c.workspace_id", "=", workspaceId)
		.execute();
	return toAttachmentPairs(rows);
}

export async function loadAttachmentPairsForColumn(
	dbExec: DBExecutor,
	workspaceId: number,
	columnId: number,
): Promise<AttachmentPair[]> {
	const rows = await dbExec
		.selectFrom("attachments as a")
		.innerJoin("cards as c", "c.id", "a.card_id")
		.select(["a.thumbnail_path", "a.original_path"])
		.where("c.workspace_id", "=", workspaceId)
		.where("c.column_id", "=", columnId)
		.execute();
	return toAttachmentPairs(rows);
}

export async function loadAttachmentPairsForAgentBoard(
	dbExec: DBExecutor,
	boardId: number,
): Promise<AttachmentPair[]> {
	const rows = await dbExec
		.selectFrom("attachments as a")
		.innerJoin("cards as c", "c.id", "a.card_id")
		.innerJoin("columns as col", "col.id", "c.column_id")
		.select(["a.thumbnail_path", "a.original_path"])
		.where("col.board_id", "=", boardId)
		.execute();
	return toAttachmentPairs(rows);
}

/** Removes committed attachment files without turning a successful mutation into a failure. */
export async function removeAttachmentPairsBestEffort(
	storage: AttachmentStorage,
	pairs: Iterable<AttachmentPair>,
): Promise<void> {
	const results = await Promise.allSettled(
		[...pairs].map((pair) => storage.removePair(pair)),
	);
	for (const result of results) {
		if (result.status === "rejected") {
			console.error("Failed to clean up attachment files", result.reason);
		}
	}
}
