import type { Request, Response } from "express";
import { db } from "../../db/kysely.js";
import { getAttachmentStorage } from "../../lib/attachment-storage.js";
import { logger } from "../../lib/logger.js";
import {
	persistCreatedCard,
	removeWrittenAttachments,
	writeUploadedAttachments,
} from "./card-create-persistence.js";
import { publishCreatedResult } from "./card-create-publish.js";
import type { CreateResult, WrittenAttachment } from "./card-create-types.js";
import {
	prepareCreate,
	prepareCreateRequest,
} from "./card-create-validation.js";

function respondToCreateFailure(
	res: Response,
	result: Exclude<CreateResult, { kind: "ok" }>,
): Response {
	if (result.kind === "not_found_column") {
		return res.status(404).json({ error: "column not found" });
	}
	if (result.kind === "wip") {
		return res.status(409).json({ error: "WIP limit reached for this column" });
	}
	return res.status(400).json({
		error: "Some card fields are invalid",
		fieldErrors: result.fieldErrors,
	});
}

export async function createCard(req: Request, res: Response) {
	const { workspaceId } = req.workspace!;
	const preparedRequest = await prepareCreateRequest(req, workspaceId);
	if (preparedRequest.kind === "bad_request") {
		return res.status(400).json({ error: preparedRequest.error });
	}

	const { input, attachments } = preparedRequest;
	const attachmentStorage = getAttachmentStorage();
	let writtenAttachments: WrittenAttachment[];
	try {
		writtenAttachments = await writeUploadedAttachments(
			attachmentStorage,
			attachments,
		);
	} catch (error) {
		logger.error({ err: error }, "Failed to write card attachments");
		return res.status(500).json({ error: "Unable to store card attachments" });
	}

	let result: CreateResult;
	try {
		result = await db.transaction().execute(async (trx) => {
			const prepared = await prepareCreate(trx, input);
			if (prepared.kind !== "ready") return prepared;
			return persistCreatedCard(trx, input, prepared, writtenAttachments);
		});
	} catch (error) {
		await removeWrittenAttachments(attachmentStorage, writtenAttachments);
		logger.error({ err: error }, "Failed to create card with attachments");
		return res.status(500).json({ error: "Unable to create card" });
	}
	if (result.kind !== "ok") {
		await removeWrittenAttachments(attachmentStorage, writtenAttachments);
		return respondToCreateFailure(res, result);
	}

	await publishCreatedResult(workspaceId, input.actor, result);
	return res.status(201).json(result.card);
}
