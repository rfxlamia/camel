import type { DBExecutor } from "../../db/kysely.js";
import {
	selectBoardWorkItemRows,
	selectWorkItemRows,
} from "../../lib/work-item-response.js";
import type {
	MyWorkBoardRow,
	MyWorkDetailQueryInput,
	MyWorkTrackerRow,
} from "./my-work-types.js";

export async function getMyWorkTrackerRow(
	executor: DBExecutor,
	input: MyWorkDetailQueryInput,
): Promise<MyWorkTrackerRow | null> {
	const row = await selectWorkItemRows(executor)
		.select("c.workspace_id")
		.where("c.column_id", "is", null)
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
	if (!row) return null;
	return { ...row, position: row.plan_position } as MyWorkTrackerRow;
}

export async function getMyWorkBoardRow(
	executor: DBExecutor,
	input: MyWorkDetailQueryInput,
): Promise<MyWorkBoardRow | null> {
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
}
