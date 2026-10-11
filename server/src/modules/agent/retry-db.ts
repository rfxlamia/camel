import { sql } from "kysely";
import { db } from "../../db/kysely.js";
import type { AgentBoardServiceDeps } from "./service-types.js";
import { assertAgentSpendAllowed } from "./spend-kill-switch.js";

export function validateRetryColumns(
	columns: Array<{
		slug: string | null;
		system_prompt: string | null;
		position: number;
		tool_budget: number | null;
	}>,
) {
	if (columns.length === 0) throw new Error("Retry requires execution columns");
	const slugs = new Set<string>();
	let previous = -Infinity;
	for (const column of columns) {
		if (
			!column.slug?.trim() ||
			!column.system_prompt?.trim() ||
			!Number.isFinite(column.position) ||
			column.position <= previous ||
			slugs.has(column.slug) ||
			(column.tool_budget !== null &&
				(!Number.isInteger(column.tool_budget) || column.tool_budget < 0))
		) {
			throw new Error("Invalid retry execution columns");
		}
		slugs.add(column.slug);
		previous = column.position;
	}
}

export const retryDeps: Pick<
	AgentBoardServiceDeps,
	"retryBoardAtomic" | "failRunningBoard"
> = {
	retryBoardAtomic: async ({ boardId, workspaceId, userId }) =>
		db.transaction().execute(async (trx) => {
			// Serializes requests for the same source. The unique partial index is
			// the final invariant; lock/recheck ensures only the insert winner starts.
			const source = await trx
				.selectFrom("agent_boards")
				.selectAll()
				.where("id", "=", boardId)
				.forUpdate()
				.executeTakeFirst();
			if (!source || source.workspace_id !== workspaceId)
				return { status: 404 as const };
			if (source.user_id !== userId) return { status: 403 as const };

			// Do not disclose lineage before access checks. Replays are read-only
			// and work even when spend is disabled or the source state has changed.
			const existing = await trx
				.selectFrom("agent_boards")
				.select("id")
				.where("retry_of_board_id", "=", boardId)
				.executeTakeFirst();
			if (existing) return { boardId: existing.id, created: false };
			if (
				source.status !== "approved" ||
				source.execution_status !== "failed"
			) {
				return { status: 409 as const };
			}
			assertAgentSpendAllowed();
			const columns = await trx
				.selectFrom("columns")
				.select([
					"title",
					"position",
					"slug",
					"reasoning",
					"system_prompt",
					"tools",
					"tool_budget",
				])
				.where("board_id", "=", boardId)
				.where("workspace_id", "=", workspaceId)
				.orderBy("position")
				.orderBy("id")
				.execute();
			try {
				validateRetryColumns(columns);
			} catch (error) {
				return { status: 409 as const, message: (error as Error).message };
			}
			const conversations = await trx
				.selectFrom("agent_conversations")
				.select(["role", "content"])
				.where("board_id", "=", boardId)
				.orderBy("created_at")
				.orderBy("id")
				.execute();
			const child = await trx
				.insertInto("agent_boards")
				.values({
					workspace_id: workspaceId,
					user_id: userId,
					template_id: source.template_id,
					original_intent: source.original_intent,
					status: "approved",
					execution_status: "running",
					retry_of_board_id: boardId,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			await trx
				.insertInto("columns")
				.values(
					columns.map((column) => ({
						...column,
						workspace_id: workspaceId,
						board_id: child.id,
					})),
				)
				.execute();
			if (conversations.length) {
				await trx
					.insertInto("agent_conversations")
					.values(
						conversations.map((conversation) => ({
							...conversation,
							board_id: child.id,
						})),
					)
					.execute();
			}
			return { boardId: child.id, created: true };
		}),
	failRunningBoard: async (boardId, workspaceId) => {
		const result = await db
			.updateTable("agent_boards")
			.set({ execution_status: "failed", updated_at: sql`now()` })
			.where("id", "=", boardId)
			.where("workspace_id", "=", workspaceId)
			.where("execution_status", "=", "running")
			.executeTakeFirst();
		return Number(result.numUpdatedRows) === 1;
	},
};
