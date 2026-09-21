import { stat } from "node:fs/promises";
import * as path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "../../config.js";
import { db } from "../../db/kysely.js";
import { requireWorkspaceMember } from "../../middleware/workspace.js";

const MIME_TO_DOWNLOAD_EXTENSION = {
	"image/png": "png",
	"image/jpeg": "jpg",
} as const;

export interface AttachmentDeliveryRow {
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

export type AttachmentOwnershipGuardOptions = {
	requireAttachment?: boolean;
};

export function createAttachmentOwnershipGuard({
	requireAttachment = true,
}: AttachmentOwnershipGuardOptions = {}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		void requireWorkspaceMember(req, res, () => {
			void loadOwnedCard(req, res, next, requireAttachment);
		});
	};
}

async function loadOwnedCard(
	req: Request,
	res: Response,
	next: NextFunction,
	requireAttachment: boolean,
): Promise<void> {
	try {
		const workspaceId = req.workspace?.workspaceId;
		const cardId = parsePositiveInteger(
			typeof req.params.cardId === "string" ? req.params.cardId : undefined,
		);
		if (workspaceId === undefined || cardId === null) {
			res.status(404).json({ error: "Not found" });
			return;
		}

		const card = await db
			.selectFrom("cards as c")
			.innerJoin("columns as col", "col.id", "c.column_id")
			.select("c.id")
			.where("c.id", "=", cardId)
			.where("c.workspace_id", "=", workspaceId)
			.where("col.workspace_id", "=", workspaceId)
			.where("col.board_id", "is", null)
			.where("c.deleted_at", "is", null)
			.executeTakeFirst();
		if (!card) {
			res.status(404).json({ error: "Not found" });
			return;
		}

		if (!requireAttachment) {
			next();
			return;
		}
		await loadOwnedAttachment(req, res, next, card.id);
	} catch (error) {
		next(error);
	}
}

async function loadOwnedAttachment(
	req: Request,
	res: Response,
	next: NextFunction,
	cardId: number,
): Promise<void> {
	const attachmentId = parsePositiveInteger(
		typeof req.params.attachmentId === "string"
			? req.params.attachmentId
			: undefined,
	);
	if (attachmentId === null) {
		res.status(404).json({ error: "Not found" });
		return;
	}

	const attachment = await db
		.selectFrom("attachments as a")
		.select([
			"a.id",
			"a.card_id",
			"a.mime_type",
			"a.thumbnail_path",
			"a.original_path",
		])
		.where("a.id", "=", attachmentId)
		.where("a.card_id", "=", cardId)
		.executeTakeFirst();
	if (!attachment) {
		res.status(404).json({ error: "Not found" });
		return;
	}

	req.attachmentDelivery = attachment;
	next();
}

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
	mimeType: string,
): string {
	const basename = path
		.basename(providerPath)
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.replace(/^\.+$/, "");
	const safeBasename = basename || `attachment-${attachmentId}`;
	if (/\.[a-zA-Z0-9]+$/.test(safeBasename)) return safeBasename;
	const extension =
		MIME_TO_DOWNLOAD_EXTENSION[
			mimeType as keyof typeof MIME_TO_DOWNLOAD_EXTENSION
		];
	return extension ? `${safeBasename}.${extension}` : safeBasename;
}

function matchesIfNoneMatch(req: Request, etag: string): boolean {
	const value = req.headers["if-none-match"];
	if (typeof value !== "string") return false;
	return value
		.split(",")
		.map((candidate) => candidate.trim())
		.some((candidate) => candidate === etag || candidate === `W/${etag}`);
}

export async function deliverAttachment(
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
				? `attachment; filename="${safeDownloadFilename(providerPath, attachment.id, attachment.mime_type)}"`
				: "inline",
		);
		if (matchesIfNoneMatch(req, etag)) {
			res.removeHeader("Content-Type");
			res.status(304).end();
			return;
		}
		res.sendFile(providerPath, { root: config.ATTACHMENTS_DIR }, (error) => {
			if (error) next(error);
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			res.status(404).json({ error: "Not found" });
			return;
		}
		next(error);
	}
}

export const attachmentOwnershipGuard = createAttachmentOwnershipGuard();
