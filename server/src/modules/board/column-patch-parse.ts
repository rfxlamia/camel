import { db } from "../../db/kysely.js";
import {
	COLUMN_COLOR_VALIDATION_ERROR,
	isValidColumnColor,
} from "../../validators/column.js";
import { validateColumnName } from "../../validators/input-length.js";
import type { updateColumnWithIsDoneRemap } from "./column-is-done-remap.js";

type ColumnPatchFields = Parameters<
	typeof updateColumnWithIsDoneRemap
>[0]["patchFields"];

type ColumnPatchInput = {
	title?: string;
	wipLimit?: number | null;
	policy?: string;
	isDone?: boolean;
	isSignable?: boolean;
	signableAssigneeId?: number | null;
	hasSignableAssigneeId: boolean;
	color?: string | null;
};

function buildColumnPatchFields(input: ColumnPatchInput) {
	const fields: ColumnPatchFields = {};
	if (input.title != null) fields.title = input.title;
	if (input.wipLimit !== undefined) fields.wip_limit = input.wipLimit ?? null;
	if (input.policy != null) fields.policy = input.policy;
	if (input.isDone !== undefined) fields.is_done = input.isDone;
	if (input.isSignable !== undefined) fields.is_signable = input.isSignable;
	if (input.isSignable === false) {
		fields.signable_assignee_id = null;
	} else if (input.hasSignableAssigneeId) {
		fields.signable_assignee_id = input.signableAssigneeId ?? null;
	}
	if (input.color !== undefined) fields.color = input.color;
	return fields;
}

export type ColumnPatchParse =
	| { error: string }
	| { patchFields: ColumnPatchFields; isDone: boolean | undefined };

/** Validates a PATCH /columns/:id body; checks run in the legacy order. */
export async function parseColumnPatch(
	body: Record<string, unknown> | undefined,
	workspaceId: number,
): Promise<ColumnPatchParse> {
	// biome-ignore lint/suspicious/noExplicitAny: raw JSON body; each field is validated below
	const raw = (body ?? {}) as Record<string, any>;
	const {
		title,
		wipLimit,
		policy,
		isDone,
		isSignable,
		signableAssigneeId,
		color,
	} = raw;
	const hasSignableAssigneeId = "signableAssigneeId" in (body ?? {});

	let trimmedTitle: string | undefined;
	if (title !== undefined) {
		const titleValidation = validateColumnName(title);
		if (!titleValidation.valid) {
			return { error: titleValidation.error as string };
		}
		trimmedTitle = titleValidation.trimmed;
	}

	if (wipLimit !== undefined && wipLimit !== null) {
		if (!Number.isInteger(wipLimit) || wipLimit < 1) {
			return { error: "wipLimit must be a positive integer or null" };
		}
	}
	if (isDone !== undefined && typeof isDone !== "boolean") {
		return { error: "isDone must be a boolean" };
	}
	if (isSignable !== undefined && typeof isSignable !== "boolean") {
		return { error: "isSignable must be a boolean" };
	}
	if (signableAssigneeId !== undefined && signableAssigneeId !== null) {
		if (!Number.isInteger(signableAssigneeId)) {
			return { error: "signableAssigneeId must be an integer or null" };
		}
		const memberCheck = await db
			.selectFrom("workspace_members")
			.select("user_id")
			.where("workspace_id", "=", workspaceId)
			.where("user_id", "=", signableAssigneeId)
			.executeTakeFirst();
		if (!memberCheck) {
			return { error: "signableAssigneeId must be a member of this workspace" };
		}
	}

	if (color !== undefined && !isValidColumnColor(color)) {
		return { error: COLUMN_COLOR_VALIDATION_ERROR };
	}

	const patchFields = buildColumnPatchFields({
		title: trimmedTitle,
		wipLimit,
		policy,
		isDone,
		isSignable,
		signableAssigneeId,
		hasSignableAssigneeId,
		color,
	});
	if (Object.keys(patchFields).length === 0) {
		return { error: "no updatable fields provided" };
	}
	return { patchFields, isDone };
}
