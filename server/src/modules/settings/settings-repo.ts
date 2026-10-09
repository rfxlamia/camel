import { sql } from "kysely";
import { type DBExecutor, db } from "../../db/kysely.js";

export const DEFAULT_SETTINGS = {
	boardName: "Camel",
	logoPath: "/logo.png",
} as const;

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

/**
 * Batch-upsert settings keys in a single atomic multi-row INSERT.
 * A single statement covering all keys avoids N sequential round trips
 * and ensures all-or-nothing writes.
 */
export async function batchUpsertSettings(
	workspaceId: number,
	updates: Array<{ key: string; textValue: string }>,
	newVersion: number,
	dbExecutor: DBExecutor = db,
): Promise<void> {
	if (updates.length === 0) return;

	await dbExecutor
		.insertInto("settings")
		.values(
			updates.map((u) => ({
				workspace_id: workspaceId,
				key: u.key,
				text_value: u.textValue,
				version: newVersion,
				updated_at: sql`now()`,
			})),
		)
		.onConflict((oc) =>
			oc.columns(["workspace_id", "key"]).doUpdateSet({
				text_value: (eb) => eb.ref("excluded.text_value"),
				version: (eb) => eb.ref("excluded.version"),
				updated_at: sql`now()`,
			}),
		)
		.execute();
}

export async function getMemberRole(
	workspaceId: number,
	userId: number,
): Promise<string | undefined> {
	const row = await db
		.selectFrom("workspace_members")
		.select("role")
		.where("workspace_id", "=", workspaceId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return row?.role;
}

export async function getSettingRows(
	workspaceId: number,
): Promise<SettingRow[]> {
	const raw = await db
		.selectFrom("settings")
		.select(["key", "text_value", "bool_value", "version"])
		.where("workspace_id", "=", workspaceId)
		.execute();
	return raw.map(mapPgSettingRow);
}

export async function getCurrentGlobalVersion(
	workspaceId: number,
	dbExecutor: DBExecutor = db,
): Promise<number> {
	const verRows = await dbExecutor
		.selectFrom("settings")
		.select("version")
		.where("workspace_id", "=", workspaceId)
		.execute();
	return verRows.reduce((max, r) => Math.max(max, r.version || 0), 0);
}

/** Serializes concurrent settings writes for a workspace: locks the
 * workspace row so the version read and the upsert happen atomically,
 * closing the read-then-write race between getCurrentGlobalVersion and
 * batchUpsertSettings. */
export async function lockWorkspaceForSettingsWrite(
	trx: DBExecutor,
	workspaceId: number,
): Promise<void> {
	await trx
		.selectFrom("workspaces")
		.select("id")
		.where("id", "=", workspaceId)
		.forUpdate()
		.execute();
}
