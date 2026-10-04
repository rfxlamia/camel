import { db } from "../../db/kysely.js";
import { realArtifactDeps } from "./artifact-db.js";
import {
	deleteCardsForBoard,
	deleteOutputsForBoard,
	selectConversationHistory,
} from "./board-db.js";
import type { AgentBoardServiceDeps } from "./service.js";

export const outputDeps: Pick<
	AgentBoardServiceDeps,
	| "insertOutput"
	| "insertToolCall"
	| "getOutput"
	| "insertArtifact"
	| "getArtifact"
	| "getConversationHistory"
	| "deleteOutputsForBoard"
	| "deleteCardsForBoard"
> = {
	insertOutput: async (data) => {
		await db
			.insertInto("agent_card_outputs")
			.values({
				board_id: data.boardId,
				column_slug: data.columnSlug,
				card_index: data.cardIndex,
				output: data.output,
				thinking: data.thinking ?? null,
			})
			.execute();
	},

	insertToolCall: async (data) => {
		await db
			.insertInto("agent_tool_calls")
			.values({
				board_id: data.boardId,
				column_slug: data.columnSlug,
				tool_name: data.toolName,
				input: data.input !== null ? JSON.stringify(data.input) : null,
				result: data.result ?? null,
				error_code: data.errorCode ?? null,
				attempt: data.attempt ?? 1,
			})
			.execute();
	},

	getOutput: async (data) => {
		const row = await db
			.selectFrom("agent_card_outputs")
			.select(["output", "thinking"])
			.where("board_id", "=", data.boardId)
			.where("column_slug", "=", data.columnSlug)
			.orderBy("card_index")
			.limit(1)
			.executeTakeFirst();
		if (!row) return null;
		return { output: row.output, thinking: row.thinking };
	},

	insertArtifact: (data) => realArtifactDeps.insertArtifact(db, data),

	getArtifact: (boardId) => realArtifactDeps.getArtifact(db, boardId),

	getConversationHistory: (boardId) => selectConversationHistory(db, boardId),

	deleteOutputsForBoard: (boardId) => deleteOutputsForBoard(db, boardId),

	deleteCardsForBoard: (boardId) => deleteCardsForBoard(db, boardId),
};
