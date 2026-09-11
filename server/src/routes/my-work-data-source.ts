import { sql } from "kysely";
import { type DBExecutor, db } from "../db/kysely.js";
import {
	sourceCursorPredicate,
	sourceOrderExpressions,
	sourceQueryLimit,
	sourceSearchPredicate,
} from "./my-work-query.js";
import type {
	MyWorkBoardRow,
	MyWorkDataSource,
	MyWorkDetailQueryInput,
	MyWorkSourceQueryInput,
	MyWorkTrackerRow,
	MyWorkWorkspace,
} from "./my-work-types.js";
import {
	selectBoardWorkItemRows,
	selectTrackerItemRows,
} from "./work-item-response.js";

/**
 * Default My Work data source. Every source query embeds membership and
 * assignment authorization, soft-delete filtering, and bounded pagination.
 */
export function createMyWorkDataSource(
	executor: DBExecutor = db,
): MyWorkDataSource {
	return {
		async listAuthorizedWorkspaces(userId) {
			const rows = await executor
				.selectFrom("workspace_members as wm")
				.innerJoin("workspaces as w", "w.id", "wm.workspace_id")
				.leftJoin("workspace_settings as ws", "ws.workspace_id", "w.id")
				.select(["w.id", "w.name", "ws.timezone"])
				.where("wm.user_id", "=", userId)
				.orderBy("w.id", "asc")
				.execute();
			return rows.map((row) => ({
				id: row.id,
				name: row.name,
				timezone: row.timezone ?? null,
			}));
		},

		async listTrackerRows(input) {
			const order = sourceOrderExpressions("tracker", input);
			let query = selectTrackerItemRows(executor)
				.select("ti.workspace_id")
				.where("ti.workspace_id", "in", [...input.workspaceIds])
				.where("ti.deleted_at", "is", null)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("workspace_members as auth_wm")
							.select("auth_wm.workspace_id")
							.whereRef("auth_wm.workspace_id", "=", "ti.workspace_id")
							.where("auth_wm.user_id", "=", input.userId),
					),
				)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("tracker_item_assignees as me_tia")
							.select("me_tia.tracker_item_id")
							.whereRef("me_tia.tracker_item_id", "=", "ti.id")
							.where("me_tia.user_id", "=", input.userId),
					),
				);

			if (input.workspaceId !== undefined) {
				query = query.where("ti.workspace_id", "=", input.workspaceId);
			}
			if (input.scope === "active") {
				query = query.where(sql<boolean>`${order.group} NOT IN (2, 3)`);
			}
			if (input.q) {
				query = query.where(
					sourceSearchPredicate("tracker", input, `%${input.q}%`),
				);
			}
			const cursorPredicate = sourceCursorPredicate(
				"tracker",
				input.cursor,
				order,
			);
			if (cursorPredicate) query = query.where(cursorPredicate);

			const rows = await query
				.orderBy(order.group, "asc")
				.orderBy(order.overdueRank, "asc")
				.orderBy(order.dueNullRank, "asc")
				.orderBy(order.dueDate, "asc")
				.orderBy(order.updatedAt, "desc")
				.orderBy(order.workspaceId, "asc")
				.orderBy(order.keyNumber, "asc")
				.orderBy(order.id, "asc")
				.limit(sourceQueryLimit(input))
				.execute();
			return rows as MyWorkTrackerRow[];
		},

		async listBoardRows(input) {
			const order = sourceOrderExpressions("board", input);
			let query = selectBoardWorkItemRows(executor)
				.select("c.workspace_id")
				.where("c.workspace_id", "in", [...input.workspaceIds])
				.where("c.deleted_at", "is", null)
				.where("c.key_number", "is not", null)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("workspace_members as auth_wm")
							.select("auth_wm.workspace_id")
							.whereRef("auth_wm.workspace_id", "=", "c.workspace_id")
							.where("auth_wm.user_id", "=", input.userId),
					),
				)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("card_assignees as me_ca")
							.select("me_ca.card_id")
							.whereRef("me_ca.card_id", "=", "c.id")
							.where("me_ca.user_id", "=", input.userId),
					),
				);

			if (input.workspaceId !== undefined) {
				query = query.where("c.workspace_id", "=", input.workspaceId);
			}
			if (input.scope === "active") {
				query = query.where(sql<boolean>`${order.group} NOT IN (2, 3)`);
			}
			if (input.q) {
				query = query.where(
					sourceSearchPredicate("board", input, `%${input.q}%`),
				);
			}
			const cursorPredicate = sourceCursorPredicate(
				"board",
				input.cursor,
				order,
			);
			if (cursorPredicate) query = query.where(cursorPredicate);

			const rows = await query
				.orderBy(order.group, "asc")
				.orderBy(order.overdueRank, "asc")
				.orderBy(order.dueNullRank, "asc")
				.orderBy(order.dueDate, "asc")
				.orderBy(order.updatedAt, "desc")
				.orderBy(order.workspaceId, "asc")
				.orderBy(order.keyNumber, "asc")
				.orderBy(order.id, "asc")
				.limit(sourceQueryLimit(input))
				.execute();
			return rows as MyWorkBoardRow[];
		},

		async getTrackerRow(input) {
			const row = await selectTrackerItemRows(executor)
				.select("ti.workspace_id")
				.where("ti.workspace_id", "=", input.workspaceId)
				.where("ti.key_number", "=", input.keyNumber)
				.where("ti.deleted_at", "is", null)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("workspace_members as auth_wm")
							.select("auth_wm.workspace_id")
							.whereRef("auth_wm.workspace_id", "=", "ti.workspace_id")
							.where("auth_wm.user_id", "=", input.userId),
					),
				)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("tracker_item_assignees as me_tia")
							.select("me_tia.tracker_item_id")
							.whereRef("me_tia.tracker_item_id", "=", "ti.id")
							.where("me_tia.user_id", "=", input.userId),
					),
				)
				.executeTakeFirst();
			return (row as MyWorkTrackerRow | undefined) ?? null;
		},

		async getBoardRow(input) {
			const row = await selectBoardWorkItemRows(executor)
				.select("c.workspace_id")
				.where("c.workspace_id", "=", input.workspaceId)
				.where("c.key_number", "=", input.keyNumber)
				.where("c.deleted_at", "is", null)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("workspace_members as auth_wm")
							.select("auth_wm.workspace_id")
							.whereRef("auth_wm.workspace_id", "=", "c.workspace_id")
							.where("auth_wm.user_id", "=", input.userId),
					),
				)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("card_assignees as me_ca")
							.select("me_ca.card_id")
							.whereRef("me_ca.card_id", "=", "c.id")
							.where("me_ca.user_id", "=", input.userId),
					),
				)
				.executeTakeFirst();
			return (row as MyWorkBoardRow | undefined) ?? null;
		},
	};
}

export const createDefaultMyWorkDataSource = createMyWorkDataSource;
