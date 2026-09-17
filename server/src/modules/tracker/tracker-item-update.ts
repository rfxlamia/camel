import type { Request, Response } from "express";
import { sql } from "kysely";
import { applyBoardCardStatusChange } from "../../core/board-card-status-change.js";
import { diffIds } from "../../core/diff-ids.js";
import { positionBetween } from "../../core/position.js";
import {
	applyTrackerItemStatusChange,
	completedAtForTrackerCategory,
	getTrackerStatusCategory,
} from "../../core/tracker-item-status-change.js";
import { formatKey, parseKeyFromUrl } from "../../core/tracker-key.js";
import { type DBExecutor, db } from "../../db/kysely.js";
import { domainBus, EVENTS } from "../../events.js";
import { publishEvent } from "../../realtime.js";
import { recordTrackerActivity } from "../../lib/tracker-activity.js";
import { syncTrackerItemAssignees } from "../../lib/tracker-assignees.js";
import {
	parseAssigneeIds,
	parseDateRange,
	parseLabelIds,
	parseProjectPhase,
} from "../../lib/tracker-item-parsers.js";
import {
	resolveWorkItemByKey,
	routeKeyParam,
	workspacePrefix,
} from "./tracker-item-route-helpers.js";
import {
	findBoardCardByKeyNumber,
	findTrackerItemByKeyNumber,
	hydrateMutationItem,
} from "../../lib/work-item-response.js";

async function getTrackerItemLabelIds(
	dbExec: DBExecutor,
	trackerItemId: number,
): Promise<number[]> {
	const rows = await dbExec
		.selectFrom("tracker_item_labels")
		.select("vocabulary_id")
		.where("tracker_item_id", "=", trackerItemId)
		.orderBy("vocabulary_id")
		.execute();
	return rows.map((r) => r.vocabulary_id);
}

async function syncTrackerItemLabels(
	dbExec: DBExecutor,
	trackerItemId: number,
	labelIds: number[],
): Promise<void> {
	const prev = await getTrackerItemLabelIds(dbExec, trackerItemId);
	const { added, removed } = diffIds(prev, labelIds);

	if (removed.length > 0) {
		await dbExec
			.deleteFrom("tracker_item_labels")
			.where("tracker_item_id", "=", trackerItemId)
			.where("vocabulary_id", "in", removed)
			.execute();
	}
	for (const vocabularyId of added) {
		await dbExec
			.insertInto("tracker_item_labels")
			.values({ tracker_item_id: trackerItemId, vocabulary_id: vocabularyId })
			.onConflict((oc) => oc.doNothing())
			.execute();
	}
}

async function endOfBucketPosition(
	dbExec: DBExecutor,
	workspaceId: number,
	projectId: number | null,
	phaseId: number | null,
): Promise<number> {
	let query = dbExec
		.selectFrom("tracker_items")
		.select(sql<number | null>`max(position)`.as("max_position"))
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null);

	if (projectId === null) {
		query = query.where("project_id", "is", null);
	} else {
		query = query.where("project_id", "=", projectId);
	}

	if (phaseId === null) {
		query = query.where("phase_id", "is", null);
	} else {
		query = query.where("phase_id", "=", phaseId);
	}

	const row = await query.executeTakeFirst();
	return positionBetween(row?.max_position ?? null, null);
}

export async function updateTrackerItemHandler(req: Request, res: Response) {
	const { workspaceId } = req.workspace!;
	const actor = req.user!;
	const parsed = parseKeyFromUrl(routeKeyParam(req.params.key));
	if (!parsed) {
		return res.status(400).json({ error: "invalid tracker key" });
	}

	const body = req.body ?? {};
	const { version } = body as { version?: unknown };
	if (version !== undefined && !Number.isInteger(version)) {
		return res.status(400).json({ error: "version must be an integer" });
	}

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

		const allowedKeys = new Set(["version", "statusId"]);
		const bodyKeys = Object.keys(body).filter((key) => body[key] !== undefined);
		const hasOnlyStatus =
			bodyKeys.length > 0 &&
			bodyKeys.every((key) => allowedKeys.has(key)) &&
			body.statusId !== undefined;
		if (!hasOnlyStatus) {
			return res.status(409).json({
				error: "Board items must be updated via the card API.",
				code: "board_item_use_card_api",
			});
		}
		if (!Number.isInteger(body.statusId)) {
			return res.status(400).json({ error: "statusId must be an integer" });
		}

		const result = await db.transaction().execute(async (trx) =>
			applyBoardCardStatusChange(trx, {
				workspaceId,
				actor,
				cardId: boardCard.id,
				targetStatusId: body.statusId as number,
				version: version as number | undefined,
			}),
		);

		if (result.kind === "not_found") {
			return res.status(404).json({ error: "Not found" });
		}
		if (result.kind === "conflict") {
			return res.status(409).json({
				error: "Someone else updated this item first.",
				code: "version_conflict",
			});
		}
		if (result.kind === "invalid_status") {
			return res.status(400).json({ error: "invalid status" });
		}
		if (result.kind === "unmappable") {
			return res.status(409).json({
				error: "This status cannot be mapped to the current board columns.",
				code: "status_column_unmappable",
			});
		}
		if (result.kind === "wip") {
			return res.status(409).json({
				error: "WIP limit reached for this column",
				reason: result.reason,
			});
		}

		const key = formatKey(prefix, parsed.keyNumber);
		await publishEvent(workspaceId, {
			type: result.moved ? "card.moved" : "card.updated",
			actor,
			cardId: boardCard.id,
			payload: { key },
		});

		if (result.addedSignableAssignee != null) {
			domainBus.emit(EVENTS.CARD_ASSIGNED, {
				type: EVENTS.CARD_ASSIGNED,
				workspaceId,
				actorId: actor.id,
				payload: {
					cardId: boardCard.id,
					assigneeId: result.addedSignableAssignee,
					cardTitle: result.cardTitle,
					actorDisplayName: actor.displayName,
				},
			});
		}

		const item = await resolveWorkItemByKey(
			db,
			workspaceId,
			parsed.keyNumber,
			prefix,
		);
		if (!item) return res.status(404).json({ error: "Not found" });
		return res.json(item);
	}

	const bodyKeys = Object.keys(body).filter((key) => body[key] !== undefined);
	const hasOnlyStatus =
		bodyKeys.length > 0 &&
		bodyKeys.every((key) => key === "version" || key === "statusId") &&
		body.statusId !== undefined;
	if (hasOnlyStatus) {
		if (!Number.isInteger(body.statusId)) {
			return res.status(400).json({ error: "statusId must be an integer" });
		}
		const result = await db.transaction().execute(async (trx) =>
			applyTrackerItemStatusChange(trx, {
				workspaceId,
				actor,
				trackerItemId: existing.id,
				targetStatusId: body.statusId as number,
				version: version as number | undefined,
			}),
		);

		if (result.kind === "not_found") {
			return res.status(404).json({ error: "Not found" });
		}
		if (result.kind === "conflict") {
			return res.status(409).json({
				error: "Someone else updated this item first.",
				code: "version_conflict",
			});
		}
		if (result.kind === "invalid_status") {
			return res.status(400).json({ error: "invalid status" });
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
		return res.json(item);
	}

	const setFields: Record<string, unknown> = {};
	if (typeof body.title === "string") {
		const trimmed = body.title.trim();
		if (!trimmed) {
			return res.status(400).json({ error: "title is required" });
		}
		setFields.title = trimmed;
	}
	if (typeof body.description === "string") {
		setFields.description = body.description;
	}
	if (body.statusId !== undefined) {
		if (!Number.isInteger(body.statusId)) {
			return res.status(400).json({ error: "statusId must be an integer" });
		}
		setFields.status_id = body.statusId;
	}
	if (body.priorityId !== undefined) {
		if (body.priorityId !== null && !Number.isInteger(body.priorityId)) {
			return res
				.status(400)
				.json({ error: "priorityId must be an integer or null" });
		}
		setFields.priority_id = body.priorityId;
	}

	const hasProjectPhase = "projectId" in body || "phaseId" in body;
	let parsedProjectPhase:
		| { projectId?: number | null; phaseId?: number | null }
		| undefined;
	if (hasProjectPhase) {
		const parsedPhase = await parseProjectPhase(body, workspaceId);
		if ("error" in parsedPhase) {
			return res.status(400).json({ error: parsedPhase.error });
		}
		parsedProjectPhase = parsedPhase;
		if (parsedPhase.projectId !== undefined) {
			setFields.project_id = parsedPhase.projectId;
		}
		if (parsedPhase.phaseId !== undefined) {
			setFields.phase_id = parsedPhase.phaseId;
		}
	}

	const hasDates = "startDate" in body || "endDate" in body;
	if (hasDates) {
		const parsedDates = parseDateRange(body);
		if ("error" in parsedDates) {
			return res.status(400).json({ error: parsedDates.error });
		}
		if ("startDate" in body) setFields.start_date = parsedDates.startDate;
		if ("endDate" in body) setFields.end_date = parsedDates.endDate;
	}

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

	const hasAssigneeIds = body.assigneeIds !== undefined;
	let parsedAssigneeIds: number[] | undefined;
	if (hasAssigneeIds) {
		const parsedAssignees = await parseAssigneeIds(body, workspaceId);
		if ("error" in parsedAssignees) {
			return res.status(400).json({ error: parsedAssignees.error });
		}
		parsedAssigneeIds = parsedAssignees;
	}

	const hasLabelIds = body.labelIds !== undefined;
	let parsedLabelIds: number[] | undefined;
	if (hasLabelIds) {
		const parsedLabels = await parseLabelIds(body, workspaceId);
		if ("error" in parsedLabels) {
			return res.status(400).json({ error: parsedLabels.error });
		}
		parsedLabelIds = parsedLabels;
	}

	const hasSets = Object.keys(setFields).length > 0;
	if (!hasSets && !hasAssigneeIds && !hasLabelIds) {
		return res.status(400).json({ error: "no updatable fields provided" });
	}

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
