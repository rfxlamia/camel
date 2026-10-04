import { MAX_ARTIFACT_BYTES } from "../../lib/llm/artifact-limits.js";
import {
	deriveFilename,
	extractRevisedDocument,
	parseQaVerdict,
} from "./artifact.js";
import type {
	AgentBoardRecord,
	AgentBoardServiceDeps,
	ColumnInfo,
} from "./service-types.js";

/**
 * Post-pipeline artifact step: if no artifact exists yet and QA passed,
 * persist the editor's revised document. Returns true when an artifact exists.
 */
export async function finalizeArtifact(
	deps: AgentBoardServiceDeps,
	ctx: {
		board: AgentBoardRecord;
		columns: ColumnInfo[];
		boardId: number;
		workspaceId: number;
		slugToOutputKey: Map<string, string>;
		artifactEnabled: boolean;
	},
): Promise<boolean> {
	const { board, columns, boardId, workspaceId, slugToOutputKey } = ctx;
	const { artifactEnabled } = ctx;

	let artifactForNotify = false;
	if (artifactEnabled) {
		let artifact = await deps.getArtifact!(boardId);

		if (!artifact) {
			const qaColumn = columns.find((c) =>
				(c.tools ?? []).includes("create_file"),
			);
			const qaSlug = qaColumn?.columnSlug ?? "qa-guardian";
			const qaOutput = await deps.getOutput!({
				boardId,
				columnSlug: qaSlug,
			});

			if (qaOutput && parseQaVerdict(qaOutput.output) === "pass") {
				let editorSlug = "editor";
				for (const [slug, key] of slugToOutputKey) {
					if (key === "editor_output") {
						editorSlug = slug;
						break;
					}
				}

				const editorOutput = await deps.getOutput!({
					boardId,
					columnSlug: editorSlug,
				});

				if (editorOutput) {
					const content = extractRevisedDocument(editorOutput.output);
					if (
						content.trim() &&
						Buffer.byteLength(content, "utf8") <= MAX_ARTIFACT_BYTES
					) {
						const filename = deriveFilename(content, board.originalIntent);
						await deps.insertArtifact!({
							boardId,
							workspaceId,
							filename,
							format: "md",
							content,
						});
						artifact = { filename, format: "md", content };
					}
				}
			}
		}

		artifactForNotify = !!artifact;
	}

	return artifactForNotify;
}
