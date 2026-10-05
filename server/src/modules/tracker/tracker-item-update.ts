import type { Request, Response } from "express";
import { sql } from "kysely";
import {
	applyTrackerItemStatusChange,
	completedAtForTrackerCategory,
	getTrackerStatusCategory,
} from "../../core/tracker-item-status-change.js";
import { formatKey } from "../../core/tracker-key.js";
import { db } from "../../db/kysely.js";
import { recordTrackerActivity } from "../../lib/tracker-activity.js";
import { syncTrackerItemAssignees } from "../../lib/tracker-assignees.js";
import {
	findBoardCardByKeyNumber,
	findTrackerItemByKeyNumber,
	hydrateMutationItem,
} from "../../lib/work-item-response.js";
import { publishEvent } from "../../realtime.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { optionalVersion } from "../../validators/schemas.js";
import {
	endOfBucketPosition,
	workspacePrefix,
} from "./tracker-item-create-queries.js";
import { syncTrackerItemLabels } from "./tracker-item-labels.js";
import { updateBoardCardViaTracker } from "./tracker-item-update-board.js";
import { parseTrackerUpdateBody } from "./tracker-item-update-parse.js";
import {
	isStatusOnlyUpdate,
	updateTrackerItemStatusOnly,
} from "./tracker-item-update-status.js";
import { parseTrackerKey, statusIdField } from "./tracker-schemas.js";

export async function updateTrackerItemHandler(req: Request, res: Response) {
	const { workspaceId } = req.workspace!;
	const actor = req.user!;
	const key = parseTrackerKey(req.params.key);
	if (!key.ok) return sendValidationError(res, key.body);
	const parsed = key.data;

	const body = req.body ?? {};
	const parsedVersion = parseWith(optionalVersion, body.version);
	if (!parsedVersion.ok) return sendValidationError(res, parsedVersion.body);
	const version = parsedVersion.data;

	const prefix = await workspacePrefix(db, workspaceId);
	if (!prefix) return res.status(404).json({ error: "Not found" });

	const existing = await findTrackerItemByKeyNumber(
		db,
		workspaceId,
		parsed.keyNumber,
	);
	if (!existing) {
		const boardCard = await findBoardCardByKeyNumber(
			db,
			workspaceId,
			parsed.keyNumber,
		);
		if (!boardCard) {
			return res.status(404).json({ error: "Not found" });
		}

		return updateBoardCardViaTracker(req, res, {
			boardCard,
			body,
			version,
			prefix,
			keyNumber: parsed.keyNumber,
		});
	}

	if (isStatusOnlyUpdate(body)) {
		return updateTrackerItemStatusOnly(req, res, {
			trackerItemId: existing.id,
			statusId: body.statusId,
			version,
			prefix,
			key: parsed,
		});
	}

	const parsedBody = await parseTrackerUpdateBody(body, workspaceId);
	if ("error" in parsedBody) {
		return sendValidationError(res, { error: parsedBody.error });
	}
	const {
		setFields,
		hasProjectPhase,
		projectPhase: parsedProjectPhase,
		hasAssigneeIds,
		assigneeIds: parsedAssigneeIds,
		hasLabelIds,
		labelIds: parsedLabelIds,
	} = parsedBody;

	let newProjectId = existing.project_id;
	let newPhaseId = existing.phase_id;
	if (parsedProjectPhase) {
		if (parsedProjectPhase.projectId !== undefined) {
			newProjectId = parsedProjectPhase.projectId;
		}
		if (parsedProjectPhase.phaseId !== undefined) {
			newPhaseId = parsedProjectPhase.phaseId;
		}
	}
	const bucketChanged =
		hasProjectPhase &&
		(newProjectId !== existing.project_id || newPhaseId !== existing.phase_id);

	type TxResult =
		| { kind: "not_found" }
		| { kind: "conflict" }
		| { kind: "ok"; itemId: number };

	const result: TxResult = await db.transaction().execute(async (trx) => {
		if (bucketChanged) {
			setFields.position = await endOfBucketPosition(
				trx,
				workspaceId,
				newProjectId,
				newPhaseId,
			);
		}

		if (body.statusId !== undefined) {
			const targetCategory = await getTrackerStatusCategory(
				trx,
				workspaceId,
				body.statusId as number,
			);
			setFields.completed_at = completedAtForTrackerCategory(targetCategory);
		}

		const hasSetsNow = Object.keys(setFields).length > 0;

		if (hasSetsNow) {
			const updated = await trx
				.updateTable("tracker_items")
				.set({
					...setFields,
					version: sql`version + 1`,
					updated_at: sql`now()`,
				})
				.where("id", "=", existing.id)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.$if(version !== undefined, (qb) =>
					qb.where("version", "=", version as number),
				)
				.returning("id")
				.executeTakeFirst();

			if (!updated) {
				const current = await trx
					.selectFrom("tracker_items")
					.select("id")
					.where("id", "=", existing.id)
					.where("workspace_id", "=", workspaceId)
					.where("deleted_at", "is", null)
					.executeTakeFirst();
				return current ? { kind: "conflict" } : { kind: "not_found" };
			}
		} else if (version !== undefined) {
			const current = await trx
				.selectFrom("tracker_items")
				.select("version")
				.where("id", "=", existing.id)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.executeTakeFirst();
			if (!current) return { kind: "not_found" };
			if (current.version !== version) return { kind: "conflict" };
		}

		if (hasAssigneeIds && parsedAssigneeIds !== undefined) {
			await syncTrackerItemAssignees(trx, existing.id, parsedAssigneeIds);
			if (!hasSetsNow) {
				await trx
					.updateTable("tracker_items")
					.set({ version: sql`version + 1`, updated_at: sql`now()` })
					.where("id", "=", existing.id)
					.where("workspace_id", "=", workspaceId)
					.where("deleted_at", "is", null)
					.$if(version !== undefined, (qb) =>
						qb.where("version", "=", version as number),
					)
					.execute();
			}
		}

		if (hasLabelIds && parsedLabelIds !== undefined) {
			await syncTrackerItemLabels(trx, existing.id, parsedLabelIds);
			if (!hasSetsNow && !hasAssigneeIds) {
				await trx
					.updateTable("tracker_items")
					.set({ version: sql`version + 1`, updated_at: sql`now()` })
					.where("id", "=", existing.id)
					.where("workspace_id", "=", workspaceId)
					.where("deleted_at", "is", null)
					.$if(version !== undefined, (qb) =>
						qb.where("version", "=", version as number),
					)
					.execute();
			}
		}

		await recordTrackerActivity(
			trx,
			actor,
			workspaceId,
			"tracker_item_updated",
			{
				trackerItemId: existing.id,
				payload: {
					title:
						typeof setFields.title === "string"
							? setFields.title
							: existing.title,
					changed: [
						setFields.title !== undefined && "title",
						setFields.description !== undefined && "description",
						setFields.status_id !== undefined && "status",
						setFields.priority_id !== undefined && "priority",
						setFields.project_id !== undefined && "project",
						setFields.phase_id !== undefined && "phase",
						(setFields.start_date !== undefined ||
							setFields.end_date !== undefined) &&
							"schedule",
						hasAssigneeIds && "assignees",
						hasLabelIds && "labels",
					].filter(Boolean),
				},
			},
		);

		return { kind: "ok", itemId: existing.id };
	});

	if (result.kind === "not_found") {
		return res.status(404).json({ error: "Not found" });
	}
	if (result.kind === "conflict") {
		return res.status(409).json({
			error: "Someone else updated this item first.",
			code: "version_conflict",
		});
	}

	const row = await findTrackerItemByKeyNumber(
		db,
		workspaceId,
		parsed.keyNumber,
	);
	if (!row) return res.status(404).json({ error: "Not found" });

	const redirectFrom =
		parsed.prefix !== prefix
			? formatKey(parsed.prefix, parsed.keyNumber)
			: undefined;
	const item = await hydrateMutationItem(db, row, prefix, {
		canonicalWorkItem: req.canonicalWorkItemsRoute,
		redirectFrom,
	});
	await publishEvent(workspaceId, {
		type: "tracker.updated",
		actor,
		trackerItemId: existing.id,
	});
	res.json(item);
}
