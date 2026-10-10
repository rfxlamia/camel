import { type DBExecutor, db } from "../db/kysely.js";

export async function parsePriorityId(
	body: Record<string, unknown>,
	workspaceId: number,
	dbExec: DBExecutor = db,
): Promise<number | null | { error: string }> {
	if (!("priorityId" in body)) {
		return { error: "priorityId must be an integer or null" };
	}
	const raw = body.priorityId;
	if (raw === null) {
		return null;
	}
	if (!Number.isInteger(raw)) {
		return { error: "priorityId must be an integer or null" };
	}
	const row = await dbExec
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("id", "=", raw as number)
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "priority")
		.executeTakeFirst();
	if (!row) {
		return { error: "priority must belong to this workspace" };
	}
	return raw as number;
}

export async function parseLabelIds(
	body: Record<string, unknown>,
	workspaceId: number,
	dbExec: DBExecutor = db,
): Promise<number[] | { error: string }> {
	const raw = body.labelIds;
	if (!Array.isArray(raw)) {
		return { error: "labelIds must be an array of integers" };
	}
	const ids: number[] = [];
	for (const id of raw) {
		if (!Number.isInteger(id)) {
			return { error: "labelIds must be an array of integers" };
		}
		ids.push(id as number);
	}
	for (const labelId of [...new Set(ids)]) {
		const row = await dbExec
			.selectFrom("tracker_vocabularies")
			.select("id")
			.where("id", "=", labelId)
			.where("workspace_id", "=", workspaceId)
			.where("kind", "=", "label")
			.executeTakeFirst();
		if (!row) {
			return { error: "label must belong to this workspace" };
		}
	}
	return ids;
}

export async function parseAssigneeIds(
	body: Record<string, unknown>,
	workspaceId: number,
	dbExec: DBExecutor = db,
): Promise<number[] | { error: string }> {
	const raw = body.assigneeIds;
	if (!Array.isArray(raw)) {
		return { error: "assigneeIds must be an array of integers" };
	}
	const ids: number[] = [];
	for (const id of raw) {
		if (!Number.isInteger(id)) {
			return { error: "assigneeIds must be an array of integers" };
		}
		ids.push(id as number);
	}
	for (const userId of [...new Set(ids)]) {
		const member = await dbExec
			.selectFrom("workspace_members")
			.select("role")
			.where("workspace_id", "=", workspaceId)
			.where("user_id", "=", userId)
			.executeTakeFirst();
		const role = member?.role;
		if (!role) {
			return { error: "assignee must be a member of this workspace" };
		}
	}
	return ids;
}
