import type { DBExecutor } from "../db/kysely.js";
import type {
	MyWorkDoneBoardColumn,
	MyWorkDoneStatusVocabulary,
	MyWorkDoneTargetInputs,
} from "../core/my-work-done-target.js";
import {
	type CardAssignee,
	loadCardAssigneesForCards,
} from "./card-assignees.js";
import { loadCardLabelsForCards } from "./card-response.js";
import { serializeMyWorkCandidate } from "./my-work-response-serialization.js";
import type {
	MyWorkBoardRow,
	MyWorkCandidate,
	MyWorkSerializedItem,
	MyWorkTrackerRow,
	MyWorkWorkspace,
} from "./my-work-types.js";
import {
	loadTrackerAssigneesForItems,
	type TrackerItemAssignee,
} from "../lib/tracker-assignees.js";
import type { VocabularyRow } from "../lib/vocabulary-response.js";
import { isTerminalMyWorkStatus } from "./my-work-response-serialization.js";

async function loadTrackerLabelsForItems(
	dbExec: DBExecutor,
	itemIds: readonly number[],
): Promise<Map<number, VocabularyRow[]>> {
	const map = new Map<number, VocabularyRow[]>();
	if (itemIds.length === 0) return map;

	const rows = await dbExec
		.selectFrom("tracker_item_labels as til")
		.innerJoin("tracker_vocabularies as tv", "tv.id", "til.vocabulary_id")
		.select([
			"til.tracker_item_id",
			"tv.id",
			"tv.kind",
			"tv.name",
			"tv.position",
			"tv.colour",
		])
		.where("til.tracker_item_id", "in", [...itemIds])
		.where("tv.kind", "=", "label")
		.orderBy("til.tracker_item_id")
		.orderBy("tv.position")
		.execute();

	for (const row of rows) {
		const labels = map.get(row.tracker_item_id) ?? [];
		labels.push({
			id: row.id,
			kind: row.kind,
			name: row.name,
			position: row.position,
			colour: row.colour,
		});
		map.set(row.tracker_item_id, labels);
	}
	return map;
}

export const loadMyWorkTrackerLabels = loadTrackerLabelsForItems;

function uniqueIds(ids: readonly number[]): number[] {
	return [...new Set(ids)];
}

async function loadBoardDoneTargetColumns(
	dbExec: DBExecutor,
	workspaceIds: readonly number[],
): Promise<MyWorkDoneBoardColumn[]> {
	if (workspaceIds.length === 0) return [];
	const rows = await dbExec
		.selectFrom("columns")
		.select(["id", "workspace_id", "board_id", "position", "is_done"])
		.where("workspace_id", "in", [...workspaceIds])
		.orderBy("workspace_id", "asc")
		.orderBy("board_id", "asc")
		.orderBy("position", "asc")
		.orderBy("id", "asc")
		.execute();
	return rows.map((row) => ({
		id: row.id,
		workspaceId: row.workspace_id,
		boardId: row.board_id,
		position: row.position,
		is_done: row.is_done,
	}));
}

async function loadDoneStatusVocabularies(
	dbExec: DBExecutor,
	workspaceIds: readonly number[],
): Promise<MyWorkDoneStatusVocabulary[]> {
	if (workspaceIds.length === 0) return [];
	const rows = await dbExec
		.selectFrom("tracker_vocabularies")
		.select(["id", "workspace_id", "kind", "slot", "position"])
		.where("workspace_id", "in", [...workspaceIds])
		.where("kind", "=", "status")
		.where("slot", "=", "done")
		.orderBy("workspace_id", "asc")
		.orderBy("position", "asc")
		.orderBy("id", "asc")
		.execute();
	return rows.map((row) => ({
		id: row.id,
		workspaceId: row.workspace_id,
		kind: row.kind,
		slot: row.slot,
		position: row.position,
	}));
}

/**
 * Loads all mapping inputs for the supplied authorized candidates in at most
 * one Board-column query and one Tracker-vocabulary query.
 */
export async function loadMyWorkDoneTargetInputs(
	dbExec: DBExecutor,
	candidates: readonly MyWorkCandidate[],
): Promise<MyWorkDoneTargetInputs> {
	if (typeof (dbExec as { selectFrom?: unknown }).selectFrom !== "function") {
		return { boardColumns: [], statusVocabularies: [] };
	}

	const boardWorkspaceIds = uniqueIds(
		candidates
			.filter((candidate) => candidate.source === "board")
			.map((candidate) => candidate.row.workspace_id),
	);
	const statusWorkspaceIds = uniqueIds(
		candidates.map((candidate) => candidate.row.workspace_id),
	);
	const [boardColumns, statusVocabularies] = await Promise.all([
		loadBoardDoneTargetColumns(dbExec, boardWorkspaceIds),
		loadDoneStatusVocabularies(dbExec, statusWorkspaceIds),
	]);
	return { boardColumns, statusVocabularies };
}

function sourceCandidates(
	candidates: readonly MyWorkCandidate[],
	source: MyWorkCandidate["source"],
): MyWorkCandidate[] {
	return candidates.filter((candidate) => candidate.source === source);
}

function candidateIdsWithout(
	candidates: readonly MyWorkCandidate[],
	field: "assignees" | "labels",
): number[] {
	return uniqueIds(
		candidates
			.filter((candidate) => candidate.row[field] === undefined)
			.map((candidate) => candidate.row.id),
	);
}

type MyWorkHydrationData = {
	trackerAssignees: ReadonlyMap<number, TrackerItemAssignee[]>;
	trackerLabels: ReadonlyMap<number, VocabularyRow[]>;
	boardAssignees: ReadonlyMap<number, CardAssignee[]>;
	boardLabels: ReadonlyMap<number, VocabularyRow[]>;
	doneTargetInputs: MyWorkDoneTargetInputs;
};

function candidateHydrationIds(candidates: readonly MyWorkCandidate[]) {
	const trackerCandidates = sourceCandidates(candidates, "tracker");
	const boardCandidates = sourceCandidates(candidates, "board");
	return {
		trackerIdsForAssignees: candidateIdsWithout(trackerCandidates, "assignees"),
		trackerIdsForLabels: candidateIdsWithout(trackerCandidates, "labels"),
		boardIdsForAssignees: candidateIdsWithout(boardCandidates, "assignees"),
		boardIdsForLabels: candidateIdsWithout(boardCandidates, "labels"),
	};
}

async function loadMyWorkHydrationData(
	dbExec: DBExecutor,
	candidates: readonly MyWorkCandidate[],
): Promise<MyWorkHydrationData> {
	const ids = candidateHydrationIds(candidates);
	const capabilityCandidates = candidates.filter(
		(candidate) =>
			!isTerminalMyWorkStatus(
				candidate.row.status_category,
				candidate.row.status_slot,
			),
	);
	const [
		trackerAssignees,
		trackerLabels,
		boardAssignees,
		boardLabels,
		doneTargetInputs,
	] = await Promise.all([
		ids.trackerIdsForAssignees.length > 0
			? loadTrackerAssigneesForItems(dbExec, ids.trackerIdsForAssignees)
			: Promise.resolve(new Map<number, TrackerItemAssignee[]>()),
		ids.trackerIdsForLabels.length > 0
			? loadTrackerLabelsForItems(dbExec, ids.trackerIdsForLabels)
			: Promise.resolve(new Map<number, VocabularyRow[]>()),
		ids.boardIdsForAssignees.length > 0
			? loadCardAssigneesForCards(dbExec, ids.boardIdsForAssignees)
			: Promise.resolve(new Map<number, CardAssignee[]>()),
		ids.boardIdsForLabels.length > 0
			? loadCardLabelsForCards(dbExec, ids.boardIdsForLabels)
			: Promise.resolve(new Map<number, VocabularyRow[]>()),
		loadMyWorkDoneTargetInputs(dbExec, capabilityCandidates),
	]);
	return {
		trackerAssignees,
		trackerLabels,
		boardAssignees,
		boardLabels,
		doneTargetInputs,
	};
}

/**
 * Batch-hydrates all candidates in at most one assignee and one label query per
 * physical source. Rows supplied with test/source hydration are not queried a
 * second time.
 */
export async function hydrateMyWorkRows(
	dbExec: DBExecutor,
	candidates: readonly MyWorkCandidate[],
	workspaces: ReadonlyMap<number, MyWorkWorkspace>,
): Promise<MyWorkSerializedItem[]> {
	const data = await loadMyWorkHydrationData(dbExec, candidates);
	return serializeHydratedCandidates(
		candidates,
		workspaces,
		data.trackerAssignees,
		data.trackerLabels,
		data.boardAssignees,
		data.boardLabels,
		data.doneTargetInputs,
	);
}

function serializeHydratedCandidates(
	candidates: readonly MyWorkCandidate[],
	workspaces: ReadonlyMap<number, MyWorkWorkspace>,
	trackerAssignees: ReadonlyMap<number, TrackerItemAssignee[]>,
	trackerLabels: ReadonlyMap<number, VocabularyRow[]>,
	boardAssignees: ReadonlyMap<number, CardAssignee[]>,
	boardLabels: ReadonlyMap<number, VocabularyRow[]>,
	doneTargetInputs: MyWorkDoneTargetInputs,
): MyWorkSerializedItem[] {
	const serialized: MyWorkSerializedItem[] = [];
	for (const candidate of candidates) {
		const workspace = workspaces.get(candidate.row.workspace_id);
		if (!workspace) {
			// Fail closed if a source row is not backed by current membership
			// metadata. Never return its task or workspace identity.
			continue;
		}

		const assignees =
			candidate.row.assignees ??
			(candidate.source === "tracker"
				? trackerAssignees.get(candidate.row.id)
				: boardAssignees.get(candidate.row.id)) ??
			[];
		const labels =
			candidate.row.labels ??
			(candidate.source === "tracker"
				? trackerLabels.get(candidate.row.id)
				: boardLabels.get(candidate.row.id)) ??
			[];
		serialized.push(
			serializeMyWorkCandidate(
				candidate,
				workspace,
				{ assignees, labels },
				doneTargetInputs,
			),
		);
	}
	return serialized;
}

export const hydrateMyWorkItems = hydrateMyWorkRows;
