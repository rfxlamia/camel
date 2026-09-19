import { resolveMyWorkDoneTarget } from "../core/my-work-done-target.js";
import type { MyWorkDoneTargetInputs } from "../core/my-work-done-target.js";
import { derivePrefix } from "../core/tracker-key.js";
import type { CardAssignee } from "../lib/card-assignees.js";
import type {
	MyWorkAssignee,
	MyWorkBoardRow,
	MyWorkCandidate,
	MyWorkSerializedItem,
	MyWorkStatusCategory,
	MyWorkStatusGroup,
	MyWorkTrackerRow,
	MyWorkWorkspace,
} from "./my-work-types.js";
import type { TrackerItemAssignee } from "../lib/tracker-assignees.js";
import type { VocabularyRow } from "../lib/vocabulary-response.js";
import {
	serializeBoardWorkItem,
	serializeTrackerWorkItem,
} from "../lib/work-item-response.js";

const STATUS_CATEGORIES = new Set<MyWorkStatusCategory>([
	"backlog",
	"started",
	"completed",
	"canceled",
]);

const SLOT_TO_CATEGORY: Record<string, MyWorkStatusCategory> = {
	backlog: "backlog",
	todo: "backlog",
	in_progress: "started",
	done: "completed",
	canceled: "canceled",
};

/**
 * Normalizes the existing tracker category/slot vocabulary for My Work.
 * Unknown non-null categories remain in the Other group; the slot is only a
 * fallback when the persisted category is absent.
 */
export function normalizeMyWorkStatusCategory(
	category: string | null | undefined,
	slot: string | null | undefined,
): MyWorkStatusCategory | null {
	if (category != null) {
		return STATUS_CATEGORIES.has(category as MyWorkStatusCategory)
			? (category as MyWorkStatusCategory)
			: null;
	}
	if (slot) return SLOT_TO_CATEGORY[slot] ?? null;
	return null;
}

export const normalizeStatusCategory = normalizeMyWorkStatusCategory;

export function myWorkStatusGroup(
	category: string | null | undefined,
	slot: string | null | undefined,
): MyWorkStatusGroup {
	return normalizeMyWorkStatusCategory(category, slot) ?? "other";
}

export const statusGroupForMyWork = myWorkStatusGroup;

export function isTerminalMyWorkStatus(
	category: string | null | undefined,
	slot: string | null | undefined,
): boolean {
	const normalized = normalizeMyWorkStatusCategory(category, slot);
	return normalized === "completed" || normalized === "canceled";
}

export function isActiveMyWorkCandidate(candidate: MyWorkCandidate): boolean {
	return !isTerminalMyWorkStatus(
		candidate.row.status_category,
		candidate.row.status_slot,
	);
}

/** Composite source identity used while merging rows. */
export function myWorkCandidateIdentity(candidate: MyWorkCandidate): string {
	return `${candidate.row.workspace_id}:${candidate.source}:${candidate.row.key_number}`;
}

/**
 * Merge source rows without a cross-workspace key collision. A tracker item
 * replaces a board card only for the same workspace and key number. Duplicate
 * rows caused by joins are collapsed deterministically by source/id.
 */
export function mergeMyWorkRows(
	trackerRows: readonly MyWorkTrackerRow[],
	boardRows: readonly MyWorkBoardRow[],
): MyWorkCandidate[] {
	const byWorkspaceKey = new Map<string, MyWorkCandidate>();
	const add = (candidate: MyWorkCandidate) => {
		if (candidate.row.key_number == null) return;
		const scopeKey = `${candidate.row.workspace_id}:${candidate.row.key_number}`;
		const previous = byWorkspaceKey.get(scopeKey);
		if (!previous) {
			byWorkspaceKey.set(scopeKey, candidate);
			return;
		}

		// Tracker wins locally, never globally.
		if (previous.source === "tracker" && candidate.source === "board") return;
		if (previous.source === "board" && candidate.source === "tracker") {
			byWorkspaceKey.set(scopeKey, candidate);
			return;
		}

		// A repeated join row should not make response identity nondeterministic.
		if (candidate.row.id < previous.row.id) {
			byWorkspaceKey.set(scopeKey, candidate);
		}
	};

	for (const row of trackerRows) add({ source: "tracker", row });
	for (const row of boardRows) add({ source: "board", row });
	return [...byWorkspaceKey.values()];
}

export const mergeWorkItems = mergeMyWorkRows;

function statusFields(row: {
	status_category: string | null | undefined;
	status_slot: string | null | undefined;
}): MyWorkStatusCategory | null {
	return normalizeMyWorkStatusCategory(row.status_category, row.status_slot);
}

export function myWorkDoneCapability(
	candidate: MyWorkCandidate,
	statusCategory: MyWorkStatusCategory | null,
	doneTargetInputs?: MyWorkDoneTargetInputs,
): Pick<MyWorkSerializedItem, "canMarkDone" | "markDoneReason"> {
	if (statusCategory === "completed" || statusCategory === "canceled") {
		return { canMarkDone: false, markDoneReason: "terminal" };
	}
	if (!doneTargetInputs) {
		return {
			canMarkDone: false,
			markDoneReason: "missing_done_mapping",
		};
	}

	const doneTarget = resolveMyWorkDoneTarget(
		candidate.source === "board"
			? {
					source: "board",
					workspaceId: candidate.row.workspace_id,
					columnId: candidate.row.column_id,
				}
			: {
					source: "tracker",
					workspaceId: candidate.row.workspace_id,
				},
		doneTargetInputs,
	);
	return doneTarget.available
		? { canMarkDone: true, markDoneReason: null }
		: {
				canMarkDone: false,
				markDoneReason: "missing_done_mapping",
			};
}

function asAssignees(
	value: readonly MyWorkAssignee[] | undefined,
): MyWorkAssignee[] {
	return value ? [...value] : [];
}

function asLabels(
	value: readonly VocabularyRow[] | undefined,
): VocabularyRow[] {
	return value ? [...value] : [];
}

/** Serialize one already-authorized candidate with current workspace metadata. */
export function serializeMyWorkCandidate(
	candidate: MyWorkCandidate,
	workspace: MyWorkWorkspace,
	hydration: {
		assignees?: readonly MyWorkAssignee[];
		labels?: readonly VocabularyRow[];
	} = {},
	doneTargetInputs?: MyWorkDoneTargetInputs,
): MyWorkSerializedItem {
	const prefix = derivePrefix(workspace.name);
	const row = candidate.row;
	const assignees = asAssignees(hydration.assignees ?? row.assignees ?? []);
	const labels = asLabels(hydration.labels ?? row.labels ?? []);
	const base =
		candidate.source === "tracker"
			? serializeTrackerWorkItem(
					candidate.row,
					prefix,
					assignees as TrackerItemAssignee[],
					labels,
				)
			: serializeBoardWorkItem(
					candidate.row,
					prefix,
					assignees as CardAssignee[],
					labels,
				);

	const key = String(base.key);
	const category = statusFields(row);
	const doneCapability = myWorkDoneCapability(
		candidate,
		category,
		doneTargetInputs,
	);
	return {
		...base,
		workspace,
		workspaceId: workspace.id,
		workspaceName: workspace.name,
		identity: {
			workspaceId: workspace.id,
			source: candidate.source,
			key,
		},
		statusCategory: category,
		...doneCapability,
	} as MyWorkSerializedItem;
}

export const serializeMyWorkItem = serializeMyWorkCandidate;
