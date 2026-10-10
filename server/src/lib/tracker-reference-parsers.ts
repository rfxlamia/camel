import { type DBExecutor, db } from "../db/kysely.js";
import { parseWith } from "../validators/http.js";
import { integerIdArray } from "../validators/schemas.js";

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
	const parsed = parseWith(integerIdArray("labelIds"), body.labelIds);
	if (!parsed.ok) return parsed.body;
	const ids = parsed.data;
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
	const parsed = parseWith(integerIdArray("assigneeIds"), body.assigneeIds);
	if (!parsed.ok) return parsed.body;
	const ids = parsed.data;
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
