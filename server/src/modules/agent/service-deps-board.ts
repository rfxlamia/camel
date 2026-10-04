import { sql } from "kysely";
import { allocateCardIdentity } from "../../core/allocate-card-identity.js";
import { db } from "../../db/kysely.js";
import { runInsertColumns, validateBoardColumns } from "./board-db.js";
import type { AgentBoardServiceDeps } from "./service.js";

export const boardDeps: Pick<
	AgentBoardServiceDeps,
	| "insertBoard"
	| "insertConversation"
	| "insertColumns"
	| "getBoard"
	| "updateBoard"
	| "approveBoardAtomic"
	| "listBoards"
	| "getFirstCard"
	| "getColumns"
	| "insertCard"
> = {
	insertBoard: async (data) => {
		const inserted = await db
			.insertInto("agent_boards")
			.values({
				workspace_id: data.workspaceId,
				user_id: data.userId,
				template_id: data.templateId,
				original_intent: data.originalIntent,
				status: data.status,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		return { id: inserted.id };
	},

	insertConversation: async (data) => {
		await db
			.insertInto("agent_conversations")
			.values({
				board_id: data.boardId,
				role: data.role,
				content: data.content,
			})
			.execute();
	},

	insertColumns: (data) =>
		runInsertColumns(db, data as Parameters<typeof runInsertColumns>[1]),

	getBoard: async (boardId) => {
		const r = await db
			.selectFrom("agent_boards")
			.select([
				"id",
				"workspace_id",
				"user_id",
				"template_id",
				"original_intent",
				"status",
				"execution_status",
				"created_at",
			])
			.where("id", "=", boardId)
			.executeTakeFirst();
		if (!r) return null;
		return {
			id: r.id,
			workspaceId: r.workspace_id,
			userId: r.user_id,
			templateId: r.template_id,
			originalIntent: r.original_intent,
			status: r.status,
			executionStatus: r.execution_status,
			createdAt: r.created_at.toISOString(),
		};
	},

	updateBoard: async (boardId, data) => {
		validateBoardColumns(Object.keys(data));
		await db
			.updateTable("agent_boards")
			.set({
				...(data as {
					status?: string;
					execution_status?: string;
					original_intent?: string;
				}),
				updated_at: sql`now()`,
			})
			.where("id", "=", boardId)
			.execute();
	},

	approveBoardAtomic: async (boardId) => {
		const result = await db
			.updateTable("agent_boards")
			.set({
				status: "approved",
				execution_status: "running",
				updated_at: sql`now()`,
			})
			.where("id", "=", boardId)
			.where("status", "=", "pending")
			.executeTakeFirst();
		return { rowCount: Number(result.numUpdatedRows ?? 0) };
	},

	listBoards: async (workspaceId) => {
		const rows = await db
			.selectFrom("agent_boards")
			.select([
				"id",
				"original_intent",
				"template_id",
				"status",
				"execution_status",
				"created_at",
			])
			.where("workspace_id", "=", workspaceId)
			.orderBy("created_at", "desc")
			.execute();
		return rows.map((r) => ({
			id: r.id,
			originalIntent: r.original_intent,
			templateId: r.template_id,
			status: r.status,
			executionStatus: r.execution_status,
			createdAt: r.created_at.toISOString(),
		}));
	},

	getFirstCard: async (boardId) => {
		const r = await db
			.selectFrom("columns")
			.select([
				"id",
				"slug",
				"system_prompt",
				"reasoning",
				"tools",
				"tool_budget",
			])
			.where("board_id", "=", boardId)
			.orderBy("position")
			.limit(1)
			.executeTakeFirst();
		if (!r) return null;
		return {
			columnId: r.id,
			columnSlug: r.slug as string,
			systemPrompt: r.system_prompt as string,
			reasoning: r.reasoning,
			tools: r.tools ?? [],
			toolBudget: r.tool_budget ?? null,
		};
	},

	getColumns: async (boardId) => {
		const rows = await db
			.selectFrom("columns")
			.select([
				"id",
				"slug",
				"system_prompt",
				"reasoning",
				"tools",
				"tool_budget",
			])
			.where("board_id", "=", boardId)
			.orderBy("position")
			.execute();
		return rows.map((r) => ({
			columnId: r.id,
			columnSlug: r.slug as string,
			systemPrompt: r.system_prompt as string,
			reasoning: r.reasoning,
			tools: r.tools ?? [],
			toolBudget: r.tool_budget ?? null,
		}));
	},

	// Intentionally does NOT call recordActivity()/write card_events (R6, see
	// service.test.ts). Agent-created cards get a clickable board handle only;
	// the human Activity Feed stays reserved for user-driven actions. Also, no
	// actor is available here — runPipeline is fire-and-forget with no req.user.
	insertCard: async (data) => {
		await db.transaction().execute(async (trx) => {
			const identity = await allocateCardIdentity(trx, {
				workspaceId: data.workspaceId,
				columnId: data.columnId,
			});
			await trx
				.insertInto("cards")
				.values({
					column_id: data.columnId,
					title: data.title,
					position: data.position,
					workspace_id: data.workspaceId,
					key_number: identity.keyNumber,
					status_id: identity.statusId,
				})
				.execute();
		});
	},
};
