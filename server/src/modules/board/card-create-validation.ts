import type { Request } from "express";
import { sql } from "kysely";
import { checkWipLimit } from "../../core/wip.js";
import type { DBExecutor } from "../../db/kysely.js";
import { validateAttachmentPairs } from "../../lib/attachment-validation.js";
import { validateTaskCreateMetadata } from "../../lib/work-item-create-metadata.js";
import { lockTaskCreateReferences } from "../../lib/workspace-mutation-lock.js";
import {
	validateCardDescription,
	validateCardTitle,
	validateDueDate,
} from "../../validators/input-length.js";
import type {
	Column,
	CreateBody,
	CreateInput,
	PreparedAttachment,
	PreparedCreate,
	PreparedRequest,
	UploadedFile,
} from "./card-create-types.js";

function integerIds(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return value.filter((id): id is number => Number.isInteger(id));
}

function metadataReferences(body: CreateBody) {
	const priorityId = Number.isInteger(body.priorityId)
		? [body.priorityId as number]
		: [];
	const statusId = Number.isInteger(body.statusId)
		? [body.statusId as number]
		: [];
	return {
		assigneeIds: integerIds(body.assigneeIds),
		vocabularyIds: [...statusId, ...priorityId, ...integerIds(body.labelIds)],
		statusId: statusId[0] ?? null,
		priorityId: priorityId[0] ?? null,
		labelIds: integerIds(body.labelIds),
		projectId: Number.isInteger(body.projectId)
			? (body.projectId as number)
			: null,
		phaseId: Number.isInteger(body.phaseId) ? (body.phaseId as number) : null,
	};
}

function parseCreateDueDate(body: CreateBody): {
	dueDate: string | null;
	error?: string;
} {
	if (
		!("dueDate" in body) ||
		body.dueDate === null ||
		body.dueDate === undefined
	) {
		return { dueDate: null };
	}
	const parsed = validateDueDate(body.dueDate as string);
	return parsed.valid
		? { dueDate: parsed.trimmed as string }
		: { dueDate: null, error: parsed.error ?? "invalid due date" };
}

export async function prepareCreate(
	trx: DBExecutor,
	input: CreateInput,
): Promise<PreparedCreate> {
	await lockTaskCreateReferences(trx, input.workspaceId, {
		...metadataReferences(input.body),
		actorId: input.actor.id,
		destinationColumnId: input.columnId,
	});
	const column = await trx
		.selectFrom("columns")
		.select(["id", "wip_limit", "is_signable", "signable_assignee_id"])
		.where("id", "=", input.columnId)
		.where("workspace_id", "=", input.workspaceId)
		.forUpdate()
		.executeTakeFirst();
	if (!column) return { kind: "not_found_column" };

	const fieldErrors: Record<string, string> = {};
	await validateSignableAssignee(trx, input.workspaceId, column, fieldErrors);
	const metadata = await validateTaskCreateMetadata(
		trx,
		input.workspaceId,
		input.body,
	);
	Object.assign(fieldErrors, metadata.fieldErrors);
	const dueDate = parseCreateDueDate(input.body);
	if (dueDate.error) fieldErrors.dueDate = dueDate.error;
	if (Object.keys(fieldErrors).length > 0 || !metadata.valid) {
		return { kind: "bad_request", fieldErrors };
	}

	const countRow = await trx
		.selectFrom("cards")
		.select(sql<number>`count(*)::int`.as("n"))
		.where("column_id", "=", input.columnId)
		.where("workspace_id", "=", input.workspaceId)
		.where("deleted_at", "is", null)
		.executeTakeFirstOrThrow();
	const wip = checkWipLimit({
		currentCount: countRow.n,
		wipLimit: column.wip_limit,
		isSameColumn: false,
	});
	if (!wip.allowed) return { kind: "wip" };
	return {
		kind: "ready",
		column,
		metadata: metadata.metadata,
		dueDate: dueDate.dueDate,
	};
}

async function validateSignableAssignee(
	trx: DBExecutor,
	workspaceId: number,
	column: Column,
	fieldErrors: Record<string, string>,
): Promise<void> {
	if (!column.is_signable || column.signable_assignee_id == null) return;
	const member = await trx
		.selectFrom("workspace_members")
		.select("user_id")
		.where("workspace_id", "=", workspaceId)
		.where("user_id", "=", column.signable_assignee_id)
		.executeTakeFirst();
	if (!member) {
		fieldErrors.columnId =
			"column signable assignee must be a member of this workspace";
	}
}

function parseRequestBody(req: Request): CreateBody {
	if (!req.is("multipart/form-data")) return (req.body ?? {}) as CreateBody;
	const metadata = (req.body as Record<string, unknown> | undefined)?.metadata;
	if (typeof metadata !== "string") {
		throw new Error("metadata must be a JSON object");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(metadata);
	} catch (error) {
		throw new Error("metadata must be a JSON object", { cause: error });
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("metadata must be a JSON object");
	}
	return parsed as CreateBody;
}

function uploadedAttachments(req: Request): {
	attachments?: PreparedAttachment[];
	error?: string;
} {
	if (!req.is("multipart/form-data")) return { attachments: [] };
	const files = (req.files ?? {}) as Record<string, UploadedFile[]>;
	const thumbnails = files.thumbnail ?? [];
	const originals = files.original ?? [];
	if (thumbnails.length !== originals.length) {
		return { error: "thumbnail and original attachment counts must match" };
	}
	return {
		attachments: thumbnails.map((thumbnail, index) => ({
			thumbnail,
			original: originals[index]!,
			mimeType: originals[index]!.mimetype,
		})),
	};
}

export async function prepareCreateRequest(
	req: Request,
	workspaceId: number,
): Promise<PreparedRequest> {
	let body: CreateBody;
	try {
		body = parseRequestBody(req);
	} catch (error) {
		return { kind: "bad_request", error: (error as Error).message };
	}
	const uploaded = uploadedAttachments(req);
	if (uploaded.error) return { kind: "bad_request", error: uploaded.error };
	const attachments = uploaded.attachments ?? [];
	const { columnId } = body;
	if (body.statusId !== undefined) {
		return {
			kind: "bad_request",
			error: "statusId is not accepted for card creation",
		};
	}
	if (!Number.isInteger(columnId)) {
		return { kind: "bad_request", error: "columnId must be an integer" };
	}
	const title = validateCardTitle((body.title ?? "") as string);
	const description = validateCardDescription(
		(body.description ?? "") as string,
	);
	if (!title.valid) {
		return {
			kind: "bad_request",
			error: title.error ?? "invalid title",
		};
	}
	if (!description.valid) {
		return {
			kind: "bad_request",
			error: description.error ?? "invalid description",
		};
	}
	// Last: inspects file contents, so run it only once the cheap body checks pass.
	const attachmentValidationError = await validateAttachmentPairs(attachments);
	if (attachmentValidationError) {
		return { kind: "bad_request", error: attachmentValidationError };
	}
	return {
		kind: "ready",
		input: {
			workspaceId,
			columnId: columnId as number,
			body,
			actor: req.user!,
			title: title.trimmed as string,
			description: description.trimmed ?? "",
		},
		attachments,
	};
}
