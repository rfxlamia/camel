import type { Selectable } from "kysely";
import type { DBExecutor } from "../db/kysely.js";
import type { ChatAttachments, ChatMessages, ChatThreads } from "../db/types.js";
import type {
	ChatAttachment,
	ChatAttachmentFormat,
	ChatMessage,
	ChatMessageRole,
	ChatThread,
	InsertAttachmentParams,
	InsertMessageParams,
} from "./types.js";

const AUTO_TITLE_MAX_LEN = 50;

function mapThread(row: Selectable<ChatThreads>): ChatThread {
	return {
		id: row.id,
		userId: row.user_id,
		title: row.title,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function mapMessage(row: Selectable<ChatMessages>): ChatMessage {
	return {
		id: row.id,
		threadId: row.thread_id,
		role: row.role as ChatMessageRole,
		content: row.content,
		thinking: row.thinking,
		toolTrace: row.tool_trace,
		createdAt: row.created_at,
	};
}

function mapAttachment(row: Selectable<ChatAttachments>): ChatAttachment {
	return {
		id: row.id,
		messageId: row.message_id,
		filename: row.filename,
		format: row.format as ChatAttachmentFormat,
		content: row.content,
		createdAt: row.created_at,
	};
}

function truncateTitle(text: string, maxLen = AUTO_TITLE_MAX_LEN): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxLen) return trimmed;
	return `${trimmed.slice(0, maxLen - 3).trimEnd()}...`;
}

export function createChatService(db: DBExecutor) {
	return {
		async createThread(userId: number): Promise<ChatThread> {
			const row = await db
				.insertInto("chat_threads")
				.values({ user_id: userId })
				.returningAll()
				.executeTakeFirstOrThrow();
			return mapThread(row);
		},

		async findEmptyThread(userId: number): Promise<ChatThread | null> {
			const row = await db
				.selectFrom("chat_threads")
				.selectAll()
				.where("user_id", "=", userId)
				.where(({ not, exists, selectFrom }) =>
					not(
						exists(
							selectFrom("chat_messages")
								.select("id")
								.whereRef("chat_messages.thread_id", "=", "chat_threads.id"),
						),
					),
				)
				.orderBy("updated_at", "desc")
				.executeTakeFirst();
			return row ? mapThread(row) : null;
		},

		async listThreads(userId: number): Promise<ChatThread[]> {
			const rows = await db
				.selectFrom("chat_threads")
				.selectAll()
				.where("user_id", "=", userId)
				.orderBy("updated_at", "desc")
				.execute();
			return rows.map(mapThread);
		},

		async getThread(userId: number, threadId: number): Promise<ChatThread | null> {
			const row = await db
				.selectFrom("chat_threads")
				.selectAll()
				.where("id", "=", threadId)
				.where("user_id", "=", userId)
				.executeTakeFirst();
			return row ? mapThread(row) : null;
		},

		async renameThread(
			userId: number,
			threadId: number,
			title: string,
		): Promise<ChatThread | null> {
			const row = await db
				.updateTable("chat_threads")
				.set({ title, updated_at: new Date() })
				.where("id", "=", threadId)
				.where("user_id", "=", userId)
				.returningAll()
				.executeTakeFirst();
			return row ? mapThread(row) : null;
		},

		async deleteThread(userId: number, threadId: number): Promise<boolean> {
			const result = await db
				.deleteFrom("chat_threads")
				.where("id", "=", threadId)
				.where("user_id", "=", userId)
				.executeTakeFirst();
			return Number(result.numDeletedRows) > 0;
		},

		async insertMessage(params: InsertMessageParams): Promise<ChatMessage> {
			const row = await db
				.insertInto("chat_messages")
				.values({
					thread_id: params.threadId,
					role: params.role,
					content: params.content,
					thinking: params.thinking ?? null,
					tool_trace: params.toolTrace ?? null,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			await db
				.updateTable("chat_threads")
				.set({ updated_at: new Date() })
				.where("id", "=", params.threadId)
				.execute();

			return mapMessage(row);
		},

		async insertAttachment(params: InsertAttachmentParams): Promise<ChatAttachment> {
			const row = await db
				.insertInto("chat_attachments")
				.values({
					message_id: params.messageId,
					filename: params.filename,
					format: params.format,
					content: params.content,
				})
				.returningAll()
				.executeTakeFirstOrThrow();
			return mapAttachment(row);
		},

		async autoTitleThread(threadId: number, firstUserMessage: string): Promise<void> {
			await db
				.updateTable("chat_threads")
				.set({
					title: truncateTitle(firstUserMessage),
					updated_at: new Date(),
				})
				.where("id", "=", threadId)
				.where("title", "=", "Untitled")
				.execute();
		},
	};
}
