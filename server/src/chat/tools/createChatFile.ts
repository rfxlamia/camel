import { MAX_ARTIFACT_BYTES } from "../../agent/artifact.js";
import type { Tool, ToolResult } from "../../agent/tools/types.js";
import type { ChatAttachmentFormat, InsertAttachmentParams } from "../types.js";

const VALID_FORMATS = new Set<ChatAttachmentFormat>(["md", "txt", "csv"]);

export interface CreateChatFileCtx {
	messageId: number;
	insertAttachment: (row: InsertAttachmentParams) => Promise<void>;
}

export function makeCreateChatFile(ctx: CreateChatFileCtx): Tool {
	return {
		name: "create_file",
		description:
			"Save a file attachment (markdown, plain text, or CSV) to the current chat message.",
		riskTier: "write",
		inputSchema: {
			type: "object",
			properties: {
				filename: {
					type: "string",
					description: "Filename including extension (e.g. report.md).",
				},
				content: {
					type: "string",
					description: "Full file content to save.",
				},
				format: {
					type: "string",
					enum: ["md", "txt", "csv"],
					description: "File format.",
				},
			},
			required: ["filename", "content", "format"],
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

			const format = String(input.format ?? "") as ChatAttachmentFormat;
			if (!VALID_FORMATS.has(format)) {
				return {
					ok: false,
					content: "format must be md, txt, or csv",
					errorCode: "INVALID_FORMAT",
				};
			}

			const filename = String(input.filename ?? "").trim();
			if (!filename) {
				return {
					ok: false,
					content: "filename is required",
					errorCode: "INVALID_INPUT",
				};
			}

			await ctx.insertAttachment({
				messageId: ctx.messageId,
				filename,
				format,
				content,
			});

			return {
				ok: true,
				content: `saved ${filename}`,
			};
		},
	};
}
