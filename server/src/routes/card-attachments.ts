import { stat } from "node:fs/promises";
import * as path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Router } from "express";
import { config } from "../config.js";
import { db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";

interface AttachmentDeliveryRow {
	id: number;
	card_id: number;
	mime_type: string;
	thumbnail_path: string;
	original_path: string;
}

declare global {
	// biome-ignore lint/style/noNamespace: Express augmentation
	namespace Express {
		interface Request {
			attachmentDelivery?: AttachmentDeliveryRow;
		}
	}
}

function parsePositiveInteger(value: string | undefined): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Checks membership and the complete workspace -> card -> attachment ownership
 * chain before a delivery handler can resolve or read a provider path.
 */
export function createAttachmentOwnershipGuard(): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		void requireWorkspaceMember(req, res, () => {
			void loadOwnedAttachment(req, res, next);
		});
	};
}

async function loadOwnedAttachment(
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		const workspaceId = req.workspace?.workspaceId;
		const cardId = parsePositiveInteger(
			typeof req.params.cardId === "string" ? req.params.cardId : undefined,
		);
		const attachmentId = parsePositiveInteger(
			typeof req.params.attachmentId === "string"
				? req.params.attachmentId
				: undefined,
		);
		if (workspaceId === undefined || cardId === null || attachmentId === null) {
			res.status(404).json({ error: "Not found" });
			return;
		}

		const attachment = await db
			.selectFrom("attachments as a")
			.innerJoin("cards as c", "c.id", "a.card_id")
			.select([
				"a.id",
				"a.card_id",
				"a.mime_type",
				"a.thumbnail_path",
				"a.original_path",
			])
			.where("a.id", "=", attachmentId)
			.where("a.card_id", "=", cardId)
			.where("c.id", "=", cardId)
			.where("c.workspace_id", "=", workspaceId)
			.where("c.deleted_at", "is", null)
			.executeTakeFirst();

		if (!attachment) {
			res.status(404).json({ error: "Not found" });
			return;
		}

		req.attachmentDelivery = attachment;
		next();
	} catch (error) {
		next(error);
	}
}

export const attachmentOwnershipGuard = createAttachmentOwnershipGuard();

function resolveProviderPath(providerPath: string): string | null {
	if (path.isAbsolute(providerPath)) return null;
	const root = path.resolve(config.ATTACHMENTS_DIR);
	const resolved = path.resolve(root, providerPath);
	if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
		return null;
	}
	return resolved;
}

function safeDownloadFilename(
	providerPath: string,
	attachmentId: number,
): string {
	const basename = path
		.basename(providerPath)
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.replace(/^\.+$/, "");
	return basename || `attachment-${attachmentId}`;
}

function matchesIfNoneMatch(req: Request, etag: string): boolean {
	const value = req.headers["if-none-match"];
	if (typeof value !== "string") return false;
	return value
		.split(",")
		.map((candidate) => candidate.trim())
		.some((candidate) => candidate === etag || candidate === `W/${etag}`);
}

async function deliverAttachment(
	req: Request,
	res: Response,
	next: NextFunction,
	kind: "thumbnail" | "original",
	download: boolean,
): Promise<void> {
	const attachment = req.attachmentDelivery;
	if (!attachment) {
		res.status(404).json({ error: "Not found" });
		return;
	}

	const providerPath =
		kind === "thumbnail" ? attachment.thumbnail_path : attachment.original_path;
	const filePath = resolveProviderPath(providerPath);
	if (!filePath) {
		res.status(404).json({ error: "Not found" });
		return;
	}

	try {
		const metadata = await stat(filePath);
		if (!metadata.isFile()) {
			res.status(404).json({ error: "Not found" });
			return;
		}

		const etag = `"${metadata.size.toString(16)}-${Math.floor(metadata.mtimeMs).toString(16)}"`;
		res.setHeader("Cache-Control", "private, max-age=300");
		res.setHeader("ETag", etag);
		res.setHeader("Content-Type", attachment.mime_type);
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader(
			"Content-Disposition",
			download
				? `attachment; filename="${safeDownloadFilename(providerPath, attachment.id)}"`
				: "inline",
		);
		if (matchesIfNoneMatch(req, etag)) {
			res.status(304).end();
			return;
		}

		res.sendFile(filePath, (error) => {
			if (error && !res.headersSent) next(error);
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			res.status(404).json({ error: "Not found" });
			return;
		}
		next(error);
	}
}

export const cardAttachmentsRouter = Router({ mergeParams: true });

cardAttachmentsRouter.get(
	"/cards/:cardId/attachments/:attachmentId/thumbnail",
	attachmentOwnershipGuard,
	(req, res, next) => {
		void deliverAttachment(req, res, next, "thumbnail", false);
	},
);
cardAttachmentsRouter.get(
	"/cards/:cardId/attachments/:attachmentId/original/download",
	attachmentOwnershipGuard,
	(req, res, next) => {
		void deliverAttachment(req, res, next, "original", true);
	},
);
cardAttachmentsRouter.get(
	"/cards/:cardId/attachments/:attachmentId/original",
	attachmentOwnershipGuard,
	(req, res, next) => {
		void deliverAttachment(req, res, next, "original", false);
	},
);
