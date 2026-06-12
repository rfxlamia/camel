import { Router } from "express";
import { pool } from "../db/pool.js";
import { type AuthUser } from "../auth.js";
import { onlineUsers, publishEvent } from "../realtime.js";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { unlink } from "node:fs/promises";

export const VALID_SETTING_KEYS = new Set(["board_name", "logo_path"]);

export const DEFAULT_SETTINGS = {
  boardName: "Camel",
  logoPath: "/logo.png",
} as const;

export function validateBoardName(name: string): { valid: false; error: string } | { valid: true; trimmed: string } {
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

export function validateLogoFile(mimetype: string): { valid: boolean; error?: string } {
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    return { valid: false, error: "Only .png and .jpg files are accepted" };
  }
  return { valid: true };
}

export function validateFileSize(size: number): { valid: boolean; error?: string } {
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

export const UPLOADS_DIR = fileURLToPath(new URL("../../../client/public/uploads", import.meta.url));
mkdirSync(UPLOADS_DIR, { recursive: true });

// Lazy multer instance: dynamic import ensures pure validator tests (which only import
// the top-level pure functions) do not require the 'multer' package at collection time.
let uploadPromise: Promise<any> | null = null;

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
      })
    );
  }
  return uploadPromise;
}

async function tryDeleteOldUploadedLogo(currentLogoPath: string | null | undefined) {
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

export interface SettingsResponse {
  boardName: string;
  logoPath: string;
  version: number;
}

export function generateDefaultSettings(rows: SettingRow[]): SettingsResponse {
  const map = new Map(rows.map(r => [r.key, r]));
  const boardName = map.get("board_name")?.textValue ?? DEFAULT_SETTINGS.boardName;
  const logoPath = map.get("logo_path")?.textValue ?? DEFAULT_SETTINGS.logoPath;
  const version = rows.reduce((max, r) => Math.max(max, r.version), 0);
  return { boardName, logoPath, version };
}

export const settingsRouter = Router();

settingsRouter.get("/", async (_req, res) => {
  const { rows: raw } = await pool.query(
    `SELECT key, text_value, bool_value, version FROM settings`
  );
  const rows: SettingRow[] = raw.map((r: any) => ({
    key: r.key,
    textValue: r.text_value,
    boolValue: r.bool_value,
    version: r.version,
    updatedAt: "",
  }));
  const settings = generateDefaultSettings(rows);
  res.json(settings);
});

settingsRouter.patch("/", async (req, res) => {
  const body = (req.body ?? {}) as {
    version?: number;
    boardName?: unknown;
    logoPath?: unknown;
  };
  if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
    return res.status(400).json({ error: "version must be an integer" });
  }

  const updates: Array<{ key: string; textValue: string }> = [];

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
  const maybeUpdates = (body as any).updates;
  if (Array.isArray(maybeUpdates)) {
    for (const item of maybeUpdates) {
      if (!item || typeof item.key !== "string" || !validateSettingKey(item.key)) {
        return res.status(400).json({ error: `Invalid setting key: ${item?.key ?? ""}` });
      }
      if (item.key === "board_name") {
        if (typeof item.value !== "string") {
          return res.status(400).json({ error: "board_name value must be a string" });
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
          return res.status(400).json({ error: "logo_path value must be a string" });
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

  const { rows: verRows } = await pool.query(`SELECT version FROM settings`);
  const currentGlobal = verRows.reduce((max: number, r: any) => Math.max(max, r.version || 0), 0);

  if (body.version !== currentGlobal) {
    return res.status(409).json({
      error: "Someone else updated settings first.",
      code: "version_conflict",
    });
  }

  if (updates.length === 0) {
    const { rows: raw } = await pool.query(
      `SELECT key, text_value, bool_value, version FROM settings`
    );
    const rows: SettingRow[] = raw.map((r: any) => ({
      key: r.key,
      textValue: r.text_value,
      boolValue: r.bool_value,
      version: r.version,
      updatedAt: "",
    }));
    return res.json(generateDefaultSettings(rows));
  }

  const newVersion = currentGlobal + 1;

  for (const u of updates) {
    await pool.query(
      `INSERT INTO settings (key, text_value, version, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET
         text_value = EXCLUDED.text_value,
         version = EXCLUDED.version,
         updated_at = now()`,
      [u.key, u.textValue, newVersion]
    );
  }

  await publishEvent({ type: "settings.updated", actor: req.user! });

  const { rows: rawAfter } = await pool.query(
    `SELECT key, text_value, bool_value, version FROM settings`
  );
  const afterRows: SettingRow[] = rawAfter.map((r: any) => ({
    key: r.key,
    textValue: r.text_value,
    boolValue: r.bool_value,
    version: r.version,
    updatedAt: "",
  }));
  res.json(generateDefaultSettings(afterRows));
});

settingsRouter.delete("/", async (req, res) => {
  await pool.query("DELETE FROM settings");
  await publishEvent({ type: "settings.updated", actor: req.user! });
  res.status(204).end();
});

settingsRouter.post("/reset-app", async (req, res) => {
  const users = await onlineUsers(req.user!);
  const othersOnline = users.filter((u) => u.id !== req.user!.id);
  if (othersOnline.length > 0) {
    return res.status(409).json({ error: "Cannot reset while other users are online" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM columns");
    await client.query("DELETE FROM settings");
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await publishEvent({ type: "settings.updated", actor: req.user! });
  res.status(204).end();
});

settingsRouter.post(
  "/logo",
  async (req, res, next) => {
    try {
      const upload = await getUpload();
      upload.single("logo")(req, res, (err: any) => {
        if (err) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ error: "File size must be under 10MB" });
          }
          const msg = err.message || "Upload error";
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
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const newRelativePath = `/uploads/${req.file.filename}`;

    // Read current logo_path to clean up old uploaded file (if any)
    const { rows: currentRows } = await pool.query(
      `SELECT key, text_value FROM settings WHERE key = 'logo_path'`
    );
    const oldLogoPath = currentRows[0]?.text_value ?? null;

    await tryDeleteOldUploadedLogo(oldLogoPath);

    // Bump global version and persist the new logo_path (authoritative on upload)
    const { rows: verRows } = await pool.query(`SELECT version FROM settings`);
    const currentGlobal = verRows.reduce((max: number, r: any) => Math.max(max, r.version || 0), 0);
    const newVersion = currentGlobal + 1;

    await pool.query(
      `INSERT INTO settings (key, text_value, version, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET
         text_value = EXCLUDED.text_value,
         version = EXCLUDED.version,
         updated_at = now()`,
      ["logo_path", newRelativePath, newVersion]
    );

    await publishEvent({ type: "settings.updated", actor: req.user! });

    const { rows: rawAfter } = await pool.query(
      `SELECT key, text_value, bool_value, version FROM settings`
    );
    const afterRows: SettingRow[] = rawAfter.map((r: any) => ({
      key: r.key,
      textValue: r.text_value,
      boolValue: r.bool_value,
      version: r.version,
      updatedAt: "",
    }));
    res.json(generateDefaultSettings(afterRows));
  }
);
