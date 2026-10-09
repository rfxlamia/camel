import { mkdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "express";
import { db } from "../../db/kysely.js";
import { validateFileContent } from "../../lib/file-validator.js";
import { publishEvent } from "../../realtime.js";
import { sendValidationError } from "../../validators/http.js";
import {
	batchUpsertSettings,
	checkCanEditSettings,
	generateDefaultSettings,
	getCurrentGlobalVersion,
	getMemberRole,
	getSettingRows,
	lockWorkspaceForSettingsWrite,
} from "./settings-repo.js";
import { parseWorkspaceId } from "./settings-schemas.js";
import {
	generateLogoFilename,
	MAX_LOGO_SIZE_BYTES,
	validateLogoFile,
} from "./settings-validation.js";

export const UPLOADS_DIR = fileURLToPath(
	new URL("../../../../client/public/uploads", import.meta.url),
);
mkdirSync(UPLOADS_DIR, { recursive: true });

// Lazy multer instance: dynamic import ensures pure validator tests (which only import
// the top-level pure functions) do not require the 'multer' package at collection time.
type LogoUpload = { single: (field: string) => RequestHandler };
let uploadPromise: Promise<LogoUpload> | null = null;

async function getUpload() {
	if (!uploadPromise) {
		const multerMod = await import("multer");
		const multer = multerMod.default ?? multerMod;

		const storage = multer.diskStorage({
			destination: (_req, _file, cb) => {
				cb(null, UPLOADS_DIR);
			},
			filename: (_req, file, cb) => {
				const name = generateLogoFilename(file.mimetype);
				cb(null, name);
			},
		});

		uploadPromise = Promise.resolve(
			multer({
				storage,
				fileFilter: (_req, file, cb) => {
					const v = validateLogoFile(file.mimetype);
					if (!v.valid) {
						return cb(new Error(v.error!));
					}
					cb(null, true);
				},
				limits: { fileSize: MAX_LOGO_SIZE_BYTES },
			}),
		);
	}
	return uploadPromise;
}

async function tryDeleteOldUploadedLogo(
	currentLogoPath: string | null | undefined,
) {
	if (!currentLogoPath || !currentLogoPath.startsWith("/uploads/")) return;
	const base = currentLogoPath.replace(/^\/uploads\//, "");
	if (!base || base.includes("/") || base.includes("..")) return;
	const absPath = path.join(UPLOADS_DIR, base);
	if (!absPath.startsWith(UPLOADS_DIR)) return;
	try {
		await unlink(absPath);
	} catch {
		// best-effort cleanup; ignore ENOENT or permission errors for previous logo
	}
}

export const logoUploadMiddleware: RequestHandler = async (req, res, next) => {
	try {
		const upload = await getUpload();
		upload.single("logo")(req, res, (err: unknown) => {
			if (err) {
				const uploadErr = err as Error & { code?: string };
				if (uploadErr.code === "LIMIT_FILE_SIZE") {
					return res
						.status(413)
						.json({ error: "File size must be under 10MB" });
				}
				return sendValidationError(res, {
					error: uploadErr.message || "Upload error",
				});
			}
			next();
		});
	} catch (e) {
		next(e);
	}
};

export const logoUploadHandler: RequestHandler = async (req, res) => {
	const workspace = parseWorkspaceId(req.params);
	if (!workspace.ok) return sendValidationError(res, workspace.body);
	const workspaceId = workspace.data;

	const role = await getMemberRole(workspaceId, req.user!.id);
	if (role === undefined) return res.status(404).json({ error: "Not found" });

	const edit = checkCanEditSettings(role);
	if (!edit.allowed) {
		return res.status(edit.status).json({ error: edit.error });
	}

	if (!req.file) {
		return sendValidationError(res, { error: "No file uploaded" });
	}

	// Validate file content matches declared MIME type (H-002)
	const fileBuffer = await readFile(req.file.path);
	const validation = await validateFileContent(fileBuffer, req.file.mimetype);
	if (!validation.valid) {
		try {
			await unlink(req.file.path);
		} catch {
			// Best-effort cleanup
		}
		return sendValidationError(res, {
			error: validation.error ?? "Invalid file",
		});
	}

	const newRelativePath = `/uploads/${req.file.filename}`;

	// Lock the workspace row for the read+write so a concurrent settings
	// write can't read the same pre-write global version.
	const oldLogoPath = await db.transaction().execute(async (trx) => {
		await lockWorkspaceForSettingsWrite(trx, workspaceId);

		const current = await trx
			.selectFrom("settings")
			.select("text_value")
			.where("workspace_id", "=", workspaceId)
			.where("key", "=", "logo_path")
			.executeTakeFirst();
		const oldPath = current?.text_value ?? null;

		const currentGlobal = await getCurrentGlobalVersion(workspaceId, trx);
		await batchUpsertSettings(
			workspaceId,
			[{ key: "logo_path", textValue: newRelativePath }],
			currentGlobal + 1,
			trx,
		);

		return oldPath;
	});

	await tryDeleteOldUploadedLogo(oldLogoPath);

	await publishEvent(workspaceId, {
		type: "settings.updated",
		actor: req.user!,
	});

	const afterRows = await getSettingRows(workspaceId);
	res.json(generateDefaultSettings(afterRows));
};
