import { sql } from "kysely";
import { type DBExecutor, db } from "../../db/kysely.js";
import { getAttachmentStorage } from "../../lib/attachment-storage.js";
import { lockWorkspaceMutation } from "../../lib/workspace-mutation-lock.js";
import {
	loadAttachmentPairsForAgentBoard,
	removeAttachmentPairsBestEffort,
} from "../board/index.js";
import { mergeToolTraceRows } from "./tools/trace.js";

// ---------------------------------------------------------------------------
// Trace replay helper — read-only, never executes tools
// ---------------------------------------------------------------------------

export interface ToolTraceItem {
	columnSlug: string;
	toolName: string;
	query?: string;
	resultCount?: number;
	errorCode?: string;
	attempt?: number;
	createdAt?: string;
	reasoningText?: string;
}

export async function getToolTrace(
	dbExec: DBExecutor,
	boardId: number,
): Promise<ToolTraceItem[]> {
	const rows = await dbExec
		.selectFrom("agent_tool_calls")
		.select([
			"column_slug",
			"tool_name",
			"input",
			"result",
			"error_code",
			"attempt",
			"created_at",
		])
		.where("board_id", "=", boardId)
		.orderBy("created_at")
		.orderBy("id")
		.execute();

	return mergeToolTraceRows(
		rows.map((r) => ({
			column_slug: r.column_slug,
			tool_name: r.tool_name,
			input: r.input,
			result: r.result,
			error_code: r.error_code,
			attempt: r.attempt,
			created_at: r.created_at ? r.created_at.toISOString() : null,
		})),
	);
}

// ---------------------------------------------------------------------------
// Exported helper for insertColumns — testable without a live pool
// ---------------------------------------------------------------------------

export async function runInsertColumns(
	dbExec: DBExecutor,
	data: {
		boardId: number;
		workspaceId: number;
		columns: Array<Record<string, unknown>>;
	},
): Promise<void> {
	for (const col of data.columns) {
		const tools = col.tools as string[] | undefined;
		const toolBudget = col.tool_budget as number | undefined;
		await dbExec
			.insertInto("columns")
			.values({
				title: col.name as string,
				position: col.position as number,
				board_id: data.boardId,
				slug: col.slug as string,
				reasoning: col.reasoning as boolean,
				system_prompt: col.system_prompt as string,
				workspace_id: data.workspaceId,
				tools: tools ?? [],
				tool_budget: toolBudget ?? null,
			})
			.execute();
	}
}

// ---------------------------------------------------------------------------
// Conversation / regenerate DB helpers — exported for unit tests
// ---------------------------------------------------------------------------

export async function selectConversationHistory(
	dbExec: DBExecutor,
	boardId: number,
): Promise<Array<{ role: string; content: string }>> {
	const rows = await dbExec
		.selectFrom("agent_conversations")
		.select(["role", "content"])
		.where("board_id", "=", boardId)
		.orderBy("created_at")
		.orderBy("id")
		.execute();
	return rows;
}

export async function deleteOutputsForBoard(
	dbExec: DBExecutor,
	boardId: number,
): Promise<void> {
	await dbExec
		.deleteFrom("agent_card_outputs")
		.where("board_id", "=", boardId)
		.execute();
}

export async function deleteCardsForBoard(
	dbExec: typeof db,
	boardId: number,
): Promise<void> {
	const attachmentPairs = await dbExec.transaction().execute(async (trx) => {
		const board = await trx
			.selectFrom("agent_boards")
			.select("workspace_id")
			.where("id", "=", boardId)
			.executeTakeFirst();
		if (!board) return [];

		await lockWorkspaceMutation(trx, board.workspace_id);
		const pairs = await loadAttachmentPairsForAgentBoard(trx, boardId);
		await trx
			.deleteFrom("cards")
			.where("column_id", "in", (eb) =>
				eb.selectFrom("columns").select("id").where("board_id", "=", boardId),
			)
			.execute();
		return pairs;
	});
	await removeAttachmentPairsBestEffort(
		getAttachmentStorage(),
		attachmentPairs,
	);
}

// ---------------------------------------------------------------------------
// Board column allowlist — exported for unit tests
// ---------------------------------------------------------------------------

const ALLOWED_BOARD_COLUMNS = new Set([
	"status",
	"execution_status",
	"original_intent",
]);

export function validateBoardColumns(keys: string[]): void {
	for (const key of keys) {
		if (!ALLOWED_BOARD_COLUMNS.has(key)) {
			throw new Error(`updateBoard: illegal column "${key}"`);
		}
	}
}

export async function loadAgentBoardColumns(
	dbExec: DBExecutor,
	boardId: number,
	workspaceId: number,
) {
	const colRows = await dbExec
		.selectFrom("columns")
		.select(["id", "title", "position", "slug", "reasoning", "system_prompt"])
		.where("board_id", "=", boardId)
		.where("workspace_id", "=", workspaceId)
		.orderBy("position")
		.orderBy("id")
		.execute();

	const cardRows = await dbExec
		.selectFrom("cards as c")
		.innerJoin("columns as col", "col.id", "c.column_id")
		.select(["c.id", "c.column_id", "c.title", "c.position"])
		.where("c.workspace_id", "=", workspaceId)
		.where("c.deleted_at", "is", null)
		.where("col.board_id", "=", boardId)
		.where("col.workspace_id", "=", workspaceId)
		.orderBy("c.column_id")
		.orderBy("c.position")
		.orderBy("c.id")
		.execute();

	const cardsByColumn = new Map<number, Array<(typeof cardRows)[number]>>();
	for (const card of cardRows) {
		const cards = cardsByColumn.get(card.column_id);
		if (cards) {
			cards.push(card);
		} else {
			cardsByColumn.set(card.column_id, [card]);
		}
	}

	return colRows.map((col) => ({
		id: col.id,
		slug: col.slug,
		name: col.title,
		position: col.position,
		reasoning: col.reasoning,
		systemPrompt: col.system_prompt,
		cards: (cardsByColumn.get(col.id) ?? []).map((card) => ({
			id: card.id,
			columnId: card.column_id,
			title: card.title,
			position: card.position,
		})),
	}));
}
