import { sql } from "kysely";
import type { DBExecutor } from "../../db/kysely.js";
import {
	selectBoardWorkItemRows,
	selectWorkItemRows,
} from "../../lib/work-item-response.js";
import {
	buildSearchPattern,
	sourceCursorPredicate,
	sourceOrderExpressions,
	sourceQueryLimit,
	sourceSearchPredicate,
} from "./my-work-query.js";
import type {
	MyWorkBoardRow,
	MyWorkSourceQueryInput,
	MyWorkTrackerRow,
	MyWorkWorkspace,
} from "./my-work-types.js";

export async function listAuthorizedMyWorkspaces(
	executor: DBExecutor,
	userId: number,
): Promise<MyWorkWorkspace[]> {
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
}

function buildTrackerRowsQuery(
	executor: DBExecutor,
	input: MyWorkSourceQueryInput,
) {
	const order = sourceOrderExpressions("tracker", input);
	let query = selectWorkItemRows(executor)
		.select("c.workspace_id")
		.where("c.column_id", "is", null)
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
	if (input.scope === "all" && input.q) {
		query = query.where(
			sourceSearchPredicate("tracker", input, buildSearchPattern(input.q)),
		);
	}
	return { query, order };
}

export async function listMyWorkTrackerRows(
	executor: DBExecutor,
	input: MyWorkSourceQueryInput,
): Promise<MyWorkTrackerRow[]> {
	const { query: baseQuery, order } = buildTrackerRowsQuery(executor, input);
	const cursorPredicate = sourceCursorPredicate("tracker", input.cursor, order);
	const query = cursorPredicate ? baseQuery.where(cursorPredicate) : baseQuery;
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
	// Tracker rows carry their plan order as `position`.
	return rows.map((row) => ({
		...row,
		position: row.plan_position,
	})) as MyWorkTrackerRow[];
}

function buildBoardRowsQuery(
	executor: DBExecutor,
	input: MyWorkSourceQueryInput,
) {
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
	if (input.scope === "all" && input.q) {
		query = query.where(
			sourceSearchPredicate("board", input, buildSearchPattern(input.q)),
		);
	}
	return { query, order };
}

export async function listMyWorkBoardRows(
	executor: DBExecutor,
	input: MyWorkSourceQueryInput,
): Promise<MyWorkBoardRow[]> {
	const { query: baseQuery, order } = buildBoardRowsQuery(executor, input);
	const cursorPredicate = sourceCursorPredicate("board", input.cursor, order);
	const query = cursorPredicate ? baseQuery.where(cursorPredicate) : baseQuery;
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
}
