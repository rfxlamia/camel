import type { CardTimestamps } from "../../core/metrics.js";
import { db } from "../../db/kysely.js";
import {
	type ActivityItem,
	makeQueryBoardData,
} from "../../agent/tools/queryBoardData.js";
import {
	createToolRegistry,
	type ToolRegistry,
} from "../../agent/tools/registry.js";
import type { Tool } from "../../agent/tools/types.js";
import { webSearch } from "../../agent/tools/webSearch.js";
import type { InsertAttachmentParams } from "../types.js";
import { makeCreateChatFile } from "./createChatFile.js";

export interface ChatToolFactoryCtx {
	userId: number;
	threadId: number;
	messageId: number;
	workspaceId?: number;
	insertAttachment: (row: InsertAttachmentParams) => Promise<void>;
	fetchCardTimestamps?: (workspaceId: number) => Promise<CardTimestamps[]>;
	fetchActivityEvents?: (
		workspaceId: number,
		limit: number,
	) => Promise<ActivityItem[]>;
}

async function defaultFetchCardTimestamps(
	workspaceId: number,
): Promise<CardTimestamps[]> {
	const rows = await db
		.selectFrom("cards")
		.select(["created_at", "started_at", "done_at"])
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null)
		.execute();
	return rows.map((r) => ({
		createdAt: r.created_at,
		startedAt: r.started_at,
		doneAt: r.done_at,
	}));
}

async function defaultFetchActivityEvents(
	workspaceId: number,
	limit: number,
): Promise<ActivityItem[]> {
	const rows = await db
		.selectFrom("card_events as e")
		.leftJoin("cards as c", (join) =>
			join.onRef("c.id", "=", "e.card_id").on("c.deleted_at", "is", null),
		)
		.select([
			"e.event_type",
			"e.payload",
			"e.created_at",
			"c.title as current_card_title",
		])
		.where("e.workspace_id", "=", workspaceId)
		.orderBy("e.created_at", "desc")
		.orderBy("e.id", "desc")
		.limit(limit)
		.execute();
	return rows.map((r) => {
		const payload = r.payload as { cardTitle?: string } | null;
		return {
			type: r.event_type,
			cardTitle: r.current_card_title ?? payload?.cardTitle ?? null,
			at: r.created_at.toISOString(),
		};
	});
}

function makeChatQueryBoardData(ctx: ChatToolFactoryCtx): Tool {
	const inner = makeQueryBoardData({
		workspaceId: ctx.workspaceId ?? 0,
		fetchCardTimestamps:
			ctx.fetchCardTimestamps ?? defaultFetchCardTimestamps,
		fetchActivityEvents: ctx.fetchActivityEvents ?? defaultFetchActivityEvents,
	});

	return {
		...inner,
		async execute(input: Record<string, unknown>) {
			if (ctx.workspaceId == null) {
				return {
					ok: false,
					content: "workspace context required for board queries",
					errorCode: "MISSING_WORKSPACE",
				};
			}
			return inner.execute(input);
		},
	};
}

export function createChatToolFactory(ctx: ChatToolFactoryCtx): ToolRegistry {
	const tools: Tool[] = [
		webSearch,
		makeChatQueryBoardData(ctx),
		makeCreateChatFile({
			messageId: ctx.messageId,
			insertAttachment: ctx.insertAttachment,
		}),
	];

	return createToolRegistry(tools);
}
