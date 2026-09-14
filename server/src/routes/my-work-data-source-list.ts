import { sql } from "kysely";
import type { DBExecutor } from "../db/kysely.js";
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
import {
	selectBoardWorkItemRows,
	selectTrackerItemRows,
} from "./work-item-response.js";

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
	return rows as MyWorkTrackerRow[];
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
	const suppressBoardShadows = !(input.scope === "all" && input.q);
	if (suppressBoardShadows) {
		query = query.where((eb) =>
			eb.not(
				eb.exists(
					eb
						.selectFrom("tracker_items as shadow_ti")
						.select("shadow_ti.id")
						.whereRef("shadow_ti.workspace_id", "=", "c.workspace_id")
						.whereRef("shadow_ti.key_number", "=", "c.key_number")
						.where("shadow_ti.deleted_at", "is", null)
						.where((inner) =>
							inner.exists(
								inner
									.selectFrom("tracker_item_assignees as shadow_tia")
									.select("shadow_tia.tracker_item_id")
									.whereRef(
										"shadow_tia.tracker_item_id",
										"=",
										"shadow_ti.id",
									)
									.where("shadow_tia.user_id", "=", input.userId),
							),
						),
				),
			),
		);
	}
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
