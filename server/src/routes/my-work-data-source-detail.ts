import type { DBExecutor } from "../db/kysely.js";
import type {
	MyWorkBoardRow,
	MyWorkDetailQueryInput,
	MyWorkTrackerRow,
} from "./my-work-types.js";
import {
	selectBoardWorkItemRows,
	selectTrackerItemRows,
} from "../lib/work-item-response.js";

export async function getMyWorkTrackerRow(
	executor: DBExecutor,
	input: MyWorkDetailQueryInput,
): Promise<MyWorkTrackerRow | null> {
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
