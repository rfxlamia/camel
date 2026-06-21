import { mkdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type RequestHandler, Router } from "express";
import { pool } from "../db/pool.js";
import { validateFileContent } from "../lib/file-validator.js";
import { publishEvent } from "../realtime.js";

export const VALID_SETTING_KEYS = new Set(["board_name", "logo_path"]);

export const DEFAULT_SETTINGS = {
	boardName: "Camel",
	logoPath: "/logo.png",
} as const;

export function validateBoardName(
	name: string,
): { valid: false; error: string } | { valid: true; trimmed: string } {
	const trimmed = name.trim();
	if (trimmed === "") return { valid: false, error: "Name is required" };
	if (trimmed.length > 15) return { valid: false, error: "Max 15 characters" };
	return { valid: true, trimmed };
}

export function validateSettingKey(key: string): boolean {
	return VALID_SETTING_KEYS.has(key);
}

export const MAX_LOGO_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

export function validateLogoFile(mimetype: string): {
	valid: boolean;
	error?: string;
} {
	if (!ALLOWED_MIME_TYPES.has(mimetype)) {
		return { valid: false, error: "Only .png and .jpg files are accepted" };
	}
	return { valid: true };
}

export function validateFileSize(size: number): {
	valid: boolean;
	error?: string;
} {
	if (size > MAX_LOGO_SIZE_BYTES) {
		return { valid: false, error: "File size must be under 10MB" };
	}
	return { valid: true };
}

export function generateLogoFilename(mimetype: string): string {
	const ext = mimetype === "image/jpeg" ? "jpg" : "png";
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	return `logo-${timestamp}-${random}.${ext}`;
}

export const UPLOADS_DIR = fileURLToPath(
	new URL("../../../client/public/uploads", import.meta.url),
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

export interface SettingRow {
	key: string;
	textValue: string | null;
	boolValue: boolean | null;
	version: number;
	updatedAt: string;
}

type PgSettingRow = {
	key: string;
	text_value: string | null;
	bool_value: boolean | null;
	version: number;
};

type PgVersionRow = { version: number | null };

function mapPgSettingRow(r: PgSettingRow): SettingRow {
	return {
		key: r.key,
		textValue: r.text_value,
		boolValue: r.bool_value,
		version: r.version,
		updatedAt: "",
	};
}

export interface SettingsResponse {
	boardName: string;
	logoPath: string;
	version: number;
}

export function generateDefaultSettings(rows: SettingRow[]): SettingsResponse {
	const map = new Map(rows.map((r) => [r.key, r]));
	const boardName =
		map.get("board_name")?.textValue ?? DEFAULT_SETTINGS.boardName;
	const logoPath = map.get("logo_path")?.textValue ?? DEFAULT_SETTINGS.logoPath;
	const version = rows.reduce((max, r) => Math.max(max, r.version), 0);
	return { boardName, logoPath, version };
}

export type SettingsAuthCheck =
	| { allowed: true }
	| { allowed: false; status: number; error: string };

export function checkCanEditSettings(role: string): SettingsAuthCheck {
	if (role === "admin" || role === "owner") return { allowed: true };
	return { allowed: false, status: 403, error: "Forbidden" };
}

export type WorkspaceSettingsRepo = {
	getMembership: (
		workspaceId: number,
		userId: number,
	) => Promise<{ userId: number; role: string } | null>;
	getSettings: (workspaceId: number) => Promise<SettingRow[]>;
	updateSettings: (
		workspaceId: number,
		updates: Array<{ key: string; textValue: string; version: number }>,
	) => Promise<unknown>;
};

export function createWorkspaceSettingsService(repo: WorkspaceSettingsRepo) {
	return {
		async getSettings({
			userId,
			workspaceId,
		}: {
			userId: number;
			workspaceId: number;
		}) {
			const membership = await repo.getMembership(workspaceId, userId);
			if (!membership) return { status: 404 as const, error: "Not found" };
			const rows = await repo.getSettings(workspaceId);
			return generateDefaultSettings(rows);
		},

		async updateSettings({
			userId,
			workspaceId,
			updates,
		}: {
			userId: number;
			workspaceId: number;
			updates: Array<{ key: string; textValue: string; version: number }>;
		}) {
			const membership = await repo.getMembership(workspaceId, userId);
			if (!membership) return { status: 404 as const, error: "Not found" };

			const edit = checkCanEditSettings(membership.role);
			if (!edit.allowed) {
				return { status: edit.status, error: edit.error };
			}

			await repo.updateSettings(workspaceId, updates);
			return { ok: true as const };
		},
	};
}

export function hasResetAppRoute(): boolean {
	return false;
}

function parseWorkspaceId(raw: string): number | null {
	const workspaceId = Number(raw);
	return Number.isInteger(workspaceId) ? workspaceId : null;
}

type WorkspaceRouteParams = { workspaceId: string };

export const settingsRouter = Router({ mergeParams: true });

settingsRouter.get("/", async (req, res) => {
	const workspaceId = parseWorkspaceId(
		(req.params as WorkspaceRouteParams).workspaceId,
	);
	if (workspaceId === null) {
		return res.status(400).json({ error: "workspaceId must be an integer" });
	}

	const { rows: memberRows } = await pool.query(
		"SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
		[workspaceId, req.user!.id],
	);
	if (memberRows.length === 0)
		return res.status(404).json({ error: "Not found" });

	const { rows: raw } = await pool.query(
		`SELECT key, text_value, bool_value, version FROM settings WHERE workspace_id = $1`,
		[workspaceId],
	);
	const rows: SettingRow[] = raw.map((r) => mapPgSettingRow(r as PgSettingRow));
	const settings = generateDefaultSettings(rows);
	res.json(settings);
});

settingsRouter.patch("/", async (req, res) => {
	const workspaceId = parseWorkspaceId(
		(req.params as WorkspaceRouteParams).workspaceId,
	);
	if (workspaceId === null) {
		return res.status(400).json({ error: "workspaceId must be an integer" });
	}

	const { rows: memberRows } = await pool.query(
		"SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
		[workspaceId, req.user!.id],
	);
	if (memberRows.length === 0)
		return res.status(404).json({ error: "Not found" });

	const edit = checkCanEditSettings(memberRows[0].role as string);
	if (!edit.allowed) {
		return res.status(edit.status).json({ error: edit.error });
	}

	const updates: Array<{ key: string; textValue: string }> = [];
	let clientVersion: number | undefined;

	if (Array.isArray(req.body)) {
		for (const item of req.body as Array<{
			key?: string;
			textValue?: string;
			version?: number;
		}>) {
			if (typeof item.version === "number") clientVersion = item.version;
			if (!item?.key || !validateSettingKey(item.key)) {
				return res
					.status(400)
					.json({ error: `Invalid setting key: ${item?.key ?? ""}` });
			}
			if (item.key === "board_name") {
				if (typeof item.textValue !== "string") {
					return res
						.status(400)
						.json({ error: "board_name value must be a string" });
				}
				const vr = validateBoardName(item.textValue);
				if (!vr.valid) return res.status(400).json({ error: vr.error });
				updates.push({ key: "board_name", textValue: vr.trimmed });
			} else if (item.key === "logo_path") {
				if (typeof item.textValue !== "string") {
					return res
						.status(400)
						.json({ error: "logo_path value must be a string" });
				}
				const trimmed = item.textValue.trim();
				if (trimmed === "") {
					return res.status(400).json({ error: "logo_path cannot be empty" });
				}
				updates.push({ key: "logo_path", textValue: trimmed });
			}
		}
	} else {
		const body = (req.body ?? {}) as {
			version?: number;
			boardName?: unknown;
			logoPath?: unknown;
			updates?: Array<{ key?: string; value?: string }>;
		};
		clientVersion = body.version;

		if (body.boardName !== undefined) {
			if (typeof body.boardName !== "string") {
				return res.status(400).json({ error: "boardName must be a string" });
			}
			const vr = validateBoardName(body.boardName);
			if (!vr.valid) {
				return res.status(400).json({ error: vr.error });
			}
			updates.push({ key: "board_name", textValue: vr.trimmed });
		}
		if (body.logoPath !== undefined) {
			if (typeof body.logoPath !== "string") {
				return res.status(400).json({ error: "logoPath must be a string" });
			}
			const trimmed = body.logoPath.trim();
			if (trimmed === "") {
				return res.status(400).json({ error: "logoPath cannot be empty" });
			}
			updates.push({ key: "logo_path", textValue: trimmed });
		}

		// Support explicit updates array form (exercises validateSettingKey for unknown keys)
		const maybeUpdates = body.updates;
		if (Array.isArray(maybeUpdates)) {
			for (const item of maybeUpdates) {
				if (
					!item ||
					typeof item.key !== "string" ||
					!validateSettingKey(item.key)
				) {
					return res
						.status(400)
						.json({ error: `Invalid setting key: ${item?.key ?? ""}` });
				}
				if (item.key === "board_name") {
					if (typeof item.value !== "string") {
						return res
							.status(400)
							.json({ error: "board_name value must be a string" });
					}
					const vr = validateBoardName(item.value);
					if (!vr.valid) {
						return res.status(400).json({ error: vr.error });
					}
					if (!updates.some((u) => u.key === "board_name")) {
						updates.push({ key: "board_name", textValue: vr.trimmed });
					}
				} else if (item.key === "logo_path") {
					if (typeof item.value !== "string") {
						return res
							.status(400)
							.json({ error: "logo_path value must be a string" });
					}
					const trimmed = item.value.trim();
					if (trimmed === "") {
						return res.status(400).json({ error: "logo_path cannot be empty" });
					}
					if (!updates.some((u) => u.key === "logo_path")) {
						updates.push({ key: "logo_path", textValue: trimmed });
					}
				}
			}
		}
	}

	if (typeof clientVersion !== "number" || !Number.isInteger(clientVersion)) {
		return res.status(400).json({ error: "version must be an integer" });
	}

	const { rows: verRows } = await pool.query(
		`SELECT version FROM settings WHERE workspace_id = $1`,
		[workspaceId],
	);
	// All setting keys share one version per workspace; client must send the max it last saw.
	const currentGlobal = verRows.reduce(
		(max: number, r) => Math.max(max, (r as PgVersionRow).version || 0),
		0,
	);

	if (clientVersion !== currentGlobal) {
		return res.status(409).json({
			error: "Someone else updated settings first.",
			code: "version_conflict",
		});
	}

	if (updates.length === 0) {
		const { rows: raw } = await pool.query(
			`SELECT key, text_value, bool_value, version FROM settings WHERE workspace_id = $1`,
			[workspaceId],
		);
		const rows: SettingRow[] = raw.map((r) =>
			mapPgSettingRow(r as PgSettingRow),
		);
		return res.json(generateDefaultSettings(rows));
	}

	const newVersion = currentGlobal + 1;

	for (const u of updates) {
		await pool.query(
			`INSERT INTO settings (workspace_id, key, text_value, version, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (workspace_id, key) DO UPDATE SET
         text_value = EXCLUDED.text_value,
         version = EXCLUDED.version,
         updated_at = now()`,
			[workspaceId, u.key, u.textValue, newVersion],
		);
	}

	await publishEvent(workspaceId, {
		type: "settings.updated",
		actor: req.user!,
	});

	const { rows: rawAfter } = await pool.query(
		`SELECT key, text_value, bool_value, version FROM settings WHERE workspace_id = $1`,
		[workspaceId],
	);
	const afterRows: SettingRow[] = rawAfter.map((r) =>
		mapPgSettingRow(r as PgSettingRow),
	);
	res.json(generateDefaultSettings(afterRows));
});

settingsRouter.delete("/", async (req, res) => {
	const workspaceId = parseWorkspaceId(
		(req.params as WorkspaceRouteParams).workspaceId,
	);
	if (workspaceId === null) {
		return res.status(400).json({ error: "workspaceId must be an integer" });
	}

	const { rows: memberRows } = await pool.query(
		"SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
		[workspaceId, req.user!.id],
	);
	if (memberRows.length === 0)
		return res.status(404).json({ error: "Not found" });

	const edit = checkCanEditSettings(memberRows[0].role as string);
	if (!edit.allowed) {
		return res.status(edit.status).json({ error: edit.error });
	}

	await pool.query("DELETE FROM settings WHERE workspace_id = $1", [
		workspaceId,
	]);
	await publishEvent(workspaceId, {
		type: "settings.updated",
		actor: req.user!,
	});
	res.status(204).end();
});

settingsRouter.post(
	"/logo",
	async (req, res, next) => {
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
					const msg = uploadErr.message || "Upload error";
					if (msg.includes("Only .png and .jpg")) {
						return res.status(400).json({ error: msg });
					}
					return res.status(400).json({ error: msg });
				}
				next();
			});
		} catch (e) {
			next(e);
		}
	},
	async (req, res) => {
		const workspaceId = parseWorkspaceId(
			(req.params as WorkspaceRouteParams).workspaceId,
		);
		if (workspaceId === null) {
			return res.status(400).json({ error: "workspaceId must be an integer" });
		}

		const { rows: memberRows } = await pool.query(
			"SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
			[workspaceId, req.user!.id],
		);
		if (memberRows.length === 0)
			return res.status(404).json({ error: "Not found" });

		const edit = checkCanEditSettings(memberRows[0].role as string);
		if (!edit.allowed) {
			return res.status(edit.status).json({ error: edit.error });
		}

		if (!req.file) {
			return res.status(400).json({ error: "No file uploaded" });
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
			return res.status(400).json({ error: validation.error });
		}

		const newRelativePath = `/uploads/${req.file.filename}`;

		const { rows: currentRows } = await pool.query(
			`SELECT key, text_value FROM settings WHERE workspace_id = $1 AND key = 'logo_path'`,
			[workspaceId],
		);
		const oldLogoPath = currentRows[0]?.text_value ?? null;

		await tryDeleteOldUploadedLogo(oldLogoPath);

		const { rows: verRows } = await pool.query(
			`SELECT version FROM settings WHERE workspace_id = $1`,
			[workspaceId],
		);
		const currentGlobal = verRows.reduce(
			(max: number, r) => Math.max(max, (r as PgVersionRow).version || 0),
			0,
		);
		const newVersion = currentGlobal + 1;

		await pool.query(
			`INSERT INTO settings (workspace_id, key, text_value, version, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (workspace_id, key) DO UPDATE SET
         text_value = EXCLUDED.text_value,
         version = EXCLUDED.version,
         updated_at = now()`,
			[workspaceId, "logo_path", newRelativePath, newVersion],
		);

		await publishEvent(workspaceId, {
			type: "settings.updated",
			actor: req.user!,
		});

		const { rows: rawAfter } = await pool.query(
			`SELECT key, text_value, bool_value, version FROM settings WHERE workspace_id = $1`,
			[workspaceId],
		);
		const afterRows: SettingRow[] = rawAfter.map((r) =>
			mapPgSettingRow(r as PgSettingRow),
		);
		res.json(generateDefaultSettings(afterRows));
	},
);
