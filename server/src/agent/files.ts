/**
 * Agent file upload — multer instance + DB helpers for agent_files.
 *
 * Files live entirely in Postgres (BYTEA + extracted TEXT): never on disk,
 * never under the publicly-served /uploads dir. Cleanup is free via
 * ON DELETE CASCADE from agent_boards; unattached orphans are reaped after
 * 24 hours on each new upload.
 */

import * as path from "node:path";
import type { RequestHandler } from "express";
import { sql } from "kysely";
import type { DBExecutor } from "../db/kysely.js";
import {
	detectAgentFileKind,
	MAX_AGENT_FILE_BYTES,
	MAX_FILES_PER_BOARD,
	MAX_FILES_PER_UPLOAD,
} from "./file-extract.js";

// Lazy multer instance: dynamic import ensures pure helper tests do not
// require the 'multer' package at collection time (same pattern as settings.ts).
type FilesUpload = {
	array: (field: string, maxCount: number) => RequestHandler;
};
let uploadPromise: Promise<FilesUpload> | null = null;

export async function getAgentFileUpload(): Promise<FilesUpload> {
	if (!uploadPromise) {
		const multerMod = await import("multer");
		const multer = multerMod.default ?? multerMod;

		uploadPromise = Promise.resolve(
			multer({
				storage: multer.memoryStorage(),
				fileFilter: (_req, file, cb) => {
					const detected = detectAgentFileKind(
						file.originalname,
						file.mimetype,
					);
					if (!detected.ok) {
						return cb(new Error(detected.error));
					}
					cb(null, true);
				},
				limits: {
					fileSize: MAX_AGENT_FILE_BYTES,
					files: MAX_FILES_PER_UPLOAD,
				},
			}),
		);
	}
	return uploadPromise;
}

// Filename is display + prompt only (never a filesystem path); basename strips
// any client-supplied directory components.
export function sanitizeFilename(originalname: string): string {
	return path.basename(originalname).trim().slice(0, 255);
}

export async function insertAgentFile(
	dbExec: DBExecutor,
	data: {
		workspaceId: number;
		uploadedBy: number;
		filename: string;
		mimeType: string;
		sizeBytes: number;
		content: Buffer;
		extractedText: string;
		truncated: boolean;
	},
): Promise<{ id: number }> {
	const inserted = await dbExec
		.insertInto("agent_files")
		.values({
			workspace_id: data.workspaceId,
			uploaded_by: data.uploadedBy,
			filename: data.filename,
			mime_type: data.mimeType,
			size_bytes: data.sizeBytes,
			content: data.content,
			extracted_text: data.extractedText,
			truncated: data.truncated,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return { id: inserted.id };
}

/**
 * Attach unclaimed files to a board. The WHERE clause enforces ownership
 * (same workspace, same uploader, not yet attached) so foreign, reused, or
 * stale ids simply don't match — caller treats attached !== fileIds.length
 * as a 400.
 */
export async function attachFilesToBoard(
	dbExec: DBExecutor,
	data: {
		boardId: number;
		workspaceId: number;
		userId: number;
		fileIds: number[];
	},
): Promise<{ attached: number }> {
	if (data.fileIds.length === 0) return { attached: 0 };

	const existing = await dbExec
		.selectFrom("agent_files")
		.select(sql<number>`count(*)`.as("count"))
		.where("board_id", "=", data.boardId)
		.executeTakeFirst();
	if (
		Number(existing?.count ?? 0) + data.fileIds.length >
		MAX_FILES_PER_BOARD
	) {
		return { attached: 0 };
	}

	const result = await dbExec
		.updateTable("agent_files")
		.set({ board_id: data.boardId })
		.where("id", "in", data.fileIds)
		.where("workspace_id", "=", data.workspaceId)
		.where("uploaded_by", "=", data.userId)
		.where("board_id", "is", null)
		.executeTakeFirst();

	return { attached: Number(result.numUpdatedRows ?? 0) };
}

export interface AgentFileRow {
	id: number;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	extractedText: string;
	truncated: boolean;
}

export async function getFilesForBoard(
	dbExec: DBExecutor,
	boardId: number,
): Promise<AgentFileRow[]> {
	const rows = await dbExec
		.selectFrom("agent_files")
		.select([
			"id",
			"filename",
			"mime_type",
			"size_bytes",
			"extracted_text",
			"truncated",
		])
		.where("board_id", "=", boardId)
		.orderBy("created_at")
		.orderBy("id")
		.execute();
	return rows.map((r) => ({
		id: r.id,
		filename: r.filename,
		mimeType: r.mime_type,
		sizeBytes: r.size_bytes,
		extractedText: r.extracted_text,
		truncated: r.truncated,
	}));
}

/** Best-effort orphan hygiene — fire-and-forget on each upload. */
export async function deleteStaleUnattachedFiles(
	dbExec: DBExecutor,
	userId: number,
): Promise<void> {
	await dbExec
		.deleteFrom("agent_files")
		.where("uploaded_by", "=", userId)
		.where("board_id", "is", null)
		.where("created_at", "<", sql<Date>`now() - interval '24 hours'`)
		.execute();
}
