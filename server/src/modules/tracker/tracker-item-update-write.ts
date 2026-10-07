import { sql } from "kysely";
import type { AuthUser } from "../../auth.js";
import {
	completedAtForTrackerCategory,
	getTrackerStatusCategory,
} from "../../core/tracker-item-status-change.js";
import type { DBExecutor } from "../../db/kysely.js";
import { recordActivity } from "../../lib/helpers.js";
import { syncTrackerItemAssignees } from "../../lib/tracker-assignees.js";
import { endOfBucketPosition } from "./tracker-item-create-queries.js";
import { syncTrackerItemLabels } from "./tracker-item-labels.js";
import { classifyWriteFailure } from "./tracker-item-merged-queries.js";
import type { ParsedTrackerUpdate } from "./tracker-item-update-parse.js";

export type TrackerUpdateWriteResult =
	| { kind: "not_found" }
	| { kind: "conflict" }
	| { kind: "ok" };

export type TrackerUpdateWriteInput = {
	workspaceId: number;
	actor: AuthUser;
	existing: {
		id: number;
		title: string;
		project_id: number | null;
		phase_id: number | null;
	};
	parsed: ParsedTrackerUpdate;
	statusId: number | undefined;
	version: number | undefined;
};

function changedFields(parsed: ParsedTrackerUpdate): string[] {
	const { setFields } = parsed;
	const schedule =
		setFields.start_date !== undefined || setFields.end_date !== undefined;
	return [
		setFields.title !== undefined && "title",
		setFields.description !== undefined && "description",
		setFields.status_id !== undefined && "status",
		setFields.priority_id !== undefined && "priority",
		setFields.project_id !== undefined && "project",
		setFields.phase_id !== undefined && "phase",
		schedule && "schedule",
		parsed.hasAssigneeIds && "assignees",
		parsed.hasLabelIds && "labels",
	].filter((field): field is string => typeof field === "string");
}

/** Derived columns: bucket move re-ranks at the end, status drives completed_at. */
async function derivedFields(
	trx: DBExecutor,
	input: TrackerUpdateWriteInput,
): Promise<Record<string, unknown>> {
	const { existing, parsed, workspaceId } = input;
	const derived: Record<string, unknown> = {};
	const pp = parsed.projectPhase;
	const projectId =
		pp?.projectId !== undefined ? pp.projectId : existing.project_id;
	const phaseId = pp?.phaseId !== undefined ? pp.phaseId : existing.phase_id;
	const bucketChanged =
		parsed.hasProjectPhase &&
		(projectId !== existing.project_id || phaseId !== existing.phase_id);
	if (bucketChanged) {
		derived.plan_position = await endOfBucketPosition(
			trx,
			workspaceId,
			projectId,
			phaseId,
		);
	}
	if (input.statusId !== undefined) {
		const category = await getTrackerStatusCategory(
			trx,
			workspaceId,
			input.statusId,
		);
		derived.completed_at = completedAtForTrackerCategory(category);
	}
	return derived;
}

/**
 * One guarded UPDATE on the column-less cards row (version + updated_at always
 * advance), then junction sync and a single `tracker_item_updated` event.
 */
export async function writeTrackerUpdate(
	trx: DBExecutor,
	input: TrackerUpdateWriteInput,
): Promise<TrackerUpdateWriteResult> {
	const { existing, parsed, workspaceId, version } = input;
	const set = { ...parsed.setFields, ...(await derivedFields(trx, input)) };
	const updated = await trx
		.updateTable("cards")
		.set({ ...set, version: sql`version + 1`, updated_at: sql`now()` })
		.where("id", "=", existing.id)
		.where("workspace_id", "=", workspaceId)
		.where("column_id", "is", null)
		.where("deleted_at", "is", null)
		.$if(version !== undefined, (qb) =>
			qb.where("version", "=", version as number),
		)
		.returning("id")
		.executeTakeFirst();
	if (!updated) {
		return { kind: await classifyWriteFailure(trx, workspaceId, existing.id) };
	}

	if (parsed.hasAssigneeIds && parsed.assigneeIds !== undefined) {
		await syncTrackerItemAssignees(trx, existing.id, parsed.assigneeIds);
	}
	if (parsed.hasLabelIds && parsed.labelIds !== undefined) {
		await syncTrackerItemLabels(trx, existing.id, parsed.labelIds);
	}
	await recordActivity(trx, input.actor, workspaceId, "tracker_item_updated", {
		cardId: existing.id,
		payload: {
			title:
				typeof parsed.setFields.title === "string"
					? parsed.setFields.title
					: existing.title,
			changed: changedFields(parsed),
		},
	});
	return { kind: "ok" };
}
