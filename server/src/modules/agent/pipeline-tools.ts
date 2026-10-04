import { extractRevisedDocument } from "./artifact.js";
import type {
	AgentBoardRecord,
	AgentBoardServiceDeps,
	ColumnInfo,
} from "./service-types.js";
import { makeCreateFile } from "./tools/createFile.js";
import { makeQueryBoardData } from "./tools/queryBoardData.js";
import type { Tool } from "./tools/types.js";

export function resolveColumnTools(
	deps: AgentBoardServiceDeps,
	ctx: {
		board: AgentBoardRecord;
		column: ColumnInfo;
		boardId: number;
		workspaceId: number;
		accumulator: Record<string, string>;
		slugToOutputKey: Map<string, string>;
		artifactEnabled: boolean;
	},
): Tool[] {
	const {
		board,
		column,
		boardId,
		workspaceId,
		accumulator,
		slugToOutputKey,
		artifactEnabled,
	} = ctx;

	let resolvedTools = deps.toolRegistry?.resolveTools(column.tools ?? []) ?? [];
	if (artifactEnabled && (column.tools ?? []).includes("create_file")) {
		let editorBody = "";
		for (const [, key] of slugToOutputKey) {
			if (key === "editor_output" && accumulator[key]) {
				editorBody = extractRevisedDocument(accumulator[key]);
				break;
			}
		}
		resolvedTools = [
			...resolvedTools,
			makeCreateFile({
				boardId,
				workspaceId,
				intent: board.originalIntent,
				documentContent: editorBody,
				insertArtifact: deps.insertArtifact!,
			}),
		];
	}
	if (
		(column.tools ?? []).includes("query_board_data") &&
		deps.fetchCardTimestamps &&
		deps.fetchActivityEvents
	) {
		resolvedTools = [
			...resolvedTools,
			makeQueryBoardData({
				workspaceId,
				fetchCardTimestamps: deps.fetchCardTimestamps,
				fetchActivityEvents: deps.fetchActivityEvents,
			}),
		];
	}
	return resolvedTools;
}
