import { Router } from "express";
import { db } from "../../db/kysely.js";
import { publishEvent } from "../../realtime.js";
import { sendValidationError } from "../../validators/http.js";
import { logoUploadHandler, logoUploadMiddleware } from "./settings-logo.js";
import { parseSettingsPatch } from "./settings-patch.js";
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

export { UPLOADS_DIR } from "./settings-logo.js";
export {
	batchUpsertSettings,
	checkCanEditSettings,
	createWorkspaceSettingsService,
	DEFAULT_SETTINGS,
	generateDefaultSettings,
	type SettingRow,
	type SettingsAuthCheck,
	type SettingsResponse,
	type WorkspaceSettingsRepo,
} from "./settings-repo.js";
export {
	generateLogoFilename,
	MAX_LOGO_SIZE_BYTES,
	VALID_SETTING_KEYS,
	validateBoardName,
	validateFileSize,
	validateLogoFile,
	validateSettingKey,
} from "./settings-validation.js";

export function hasResetAppRoute(): boolean {
	return false;
}

export const settingsRouter = Router({ mergeParams: true });

settingsRouter.get("/", async (req, res) => {
	const workspace = parseWorkspaceId(req.params);
	if (!workspace.ok) return sendValidationError(res, workspace.body);
	const workspaceId = workspace.data;

	const role = await getMemberRole(workspaceId, req.user!.id);
	if (role === undefined) return res.status(404).json({ error: "Not found" });

	const rows = await getSettingRows(workspaceId);
	const settings = generateDefaultSettings(rows);
	res.json(settings);
});

settingsRouter.patch("/", async (req, res) => {
	const workspace = parseWorkspaceId(req.params);
	if (!workspace.ok) return sendValidationError(res, workspace.body);
	const workspaceId = workspace.data;

	const role = await getMemberRole(workspaceId, req.user!.id);
	if (role === undefined) return res.status(404).json({ error: "Not found" });

	const edit = checkCanEditSettings(role);
	if (!edit.allowed) {
		return res.status(edit.status).json({ error: edit.error });
	}

	const patch = parseSettingsPatch(req.body);
	if (!patch.ok) return sendValidationError(res, patch.body);
	const { updates, clientVersion } = patch.data;

	// The array-body path allows the same key more than once (last one
	// wins); a duplicate key reaching batchUpsertSettings's single
	// multi-row INSERT would trip Postgres's "ON CONFLICT DO UPDATE
	// command cannot affect row a second time".
	const dedupedUpdates = [...new Map(updates.map((u) => [u.key, u])).values()];

	// All setting keys share one version per workspace; client must send the max it last saw.
	// Lock the workspace row for the read+write so a concurrent request can't
	// read the same pre-write version and silently clobber this write.
	const conflict = await db.transaction().execute(async (trx) => {
		await lockWorkspaceForSettingsWrite(trx, workspaceId);
		const currentGlobal = await getCurrentGlobalVersion(workspaceId, trx);

		if (clientVersion !== currentGlobal) {
			return true;
		}

		if (dedupedUpdates.length > 0) {
			await batchUpsertSettings(
				workspaceId,
				dedupedUpdates,
				currentGlobal + 1,
				trx,
			);
		}
		return false;
	});

	if (conflict) {
		return res.status(409).json({
			error: "Someone else updated settings first.",
			code: "version_conflict",
		});
	}

	if (dedupedUpdates.length === 0) {
		const rows = await getSettingRows(workspaceId);
		return res.json(generateDefaultSettings(rows));
	}

	await publishEvent(workspaceId, {
		type: "settings.updated",
		actor: req.user!,
	});

	const afterRows = await getSettingRows(workspaceId);
	res.json(generateDefaultSettings(afterRows));
});

settingsRouter.delete("/", async (req, res) => {
	const workspace = parseWorkspaceId(req.params);
	if (!workspace.ok) return sendValidationError(res, workspace.body);
	const workspaceId = workspace.data;

	const role = await getMemberRole(workspaceId, req.user!.id);
	if (role === undefined) return res.status(404).json({ error: "Not found" });

	const edit = checkCanEditSettings(role);
	if (!edit.allowed) {
		return res.status(edit.status).json({ error: edit.error });
	}

	await db
		.deleteFrom("settings")
		.where("workspace_id", "=", workspaceId)
		.execute();
	await publishEvent(workspaceId, {
		type: "settings.updated",
		actor: req.user!,
	});
	res.status(204).end();
});

settingsRouter.post("/logo", logoUploadMiddleware, logoUploadHandler);
