import { deriveFilename, MAX_ARTIFACT_BYTES } from "../artifact.js";
import type { Tool, ToolResult } from "./types.js";

export interface CreateFileCtx {
	boardId: number;
	workspaceId: number;
	intent: string;
	insertArtifact: (a: {
		boardId: number;
		workspaceId: number;
		filename: string;
		format: "md";
		content: string;
	}) => Promise<void>;
}

export function makeCreateFile(ctx: CreateFileCtx): Tool {
	return {
		name: "create_file",
		description: "Save a markdown deliverable as a board artifact.",
		riskTier: "write",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string" },
				filename: { type: "string" },
			},
			required: ["content"],
		},
		async execute(input: Record<string, unknown>): Promise<ToolResult> {
			const content = String(input.content ?? "").trim();

			if (!content) {
				return {
					ok: false,
					content: "content is empty",
					errorCode: "EMPTY_CONTENT",
				};
			}

			if (Buffer.byteLength(content, "utf8") > MAX_ARTIFACT_BYTES) {
				return {
					ok: false,
					content: "content exceeds size limit",
					errorCode: "TOO_LARGE",
				};
			}

			const filename = deriveFilename(content, ctx.intent);

			await ctx.insertArtifact({
				boardId: ctx.boardId,
				workspaceId: ctx.workspaceId,
				filename,
				format: "md",
				content,
			});

			return {
				ok: true,
				content: `saved ${filename}`,
			};
		},
	};
}
