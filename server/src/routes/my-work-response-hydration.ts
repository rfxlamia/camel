import type { DBExecutor } from "../db/kysely.js";
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
} from "./tracker-assignees.js";
import type { VocabularyRow } from "./vocabulary-response.js";

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
	const trackerCandidates = sourceCandidates(candidates, "tracker");
	const boardCandidates = sourceCandidates(candidates, "board");
	const trackerIdsForAssignees = candidateIdsWithout(
		trackerCandidates,
		"assignees",
	);
	const trackerIdsForLabels = candidateIdsWithout(trackerCandidates, "labels");
	const boardIdsForAssignees = candidateIdsWithout(
		boardCandidates,
		"assignees",
	);
	const boardIdsForLabels = candidateIdsWithout(boardCandidates, "labels");

	const [trackerAssignees, trackerLabels, boardAssignees, boardLabels] =
		await Promise.all([
			trackerIdsForAssignees.length > 0
				? loadTrackerAssigneesForItems(dbExec, trackerIdsForAssignees)
				: Promise.resolve(new Map<number, TrackerItemAssignee[]>()),
			trackerIdsForLabels.length > 0
				? loadTrackerLabelsForItems(dbExec, trackerIdsForLabels)
				: Promise.resolve(new Map<number, VocabularyRow[]>()),
			boardIdsForAssignees.length > 0
				? loadCardAssigneesForCards(dbExec, boardIdsForAssignees)
				: Promise.resolve(new Map<number, CardAssignee[]>()),
			boardIdsForLabels.length > 0
				? loadCardLabelsForCards(dbExec, boardIdsForLabels)
				: Promise.resolve(new Map<number, VocabularyRow[]>()),
		]);

	return serializeHydratedCandidates(
		candidates,
		workspaces,
		trackerAssignees,
		trackerLabels,
		boardAssignees,
		boardLabels,
	);
}

function serializeHydratedCandidates(
	candidates: readonly MyWorkCandidate[],
	workspaces: ReadonlyMap<number, MyWorkWorkspace>,
	trackerAssignees: ReadonlyMap<number, TrackerItemAssignee[]>,
	trackerLabels: ReadonlyMap<number, VocabularyRow[]>,
	boardAssignees: ReadonlyMap<number, CardAssignee[]>,
	boardLabels: ReadonlyMap<number, VocabularyRow[]>,
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
			serializeMyWorkCandidate(candidate, workspace, { assignees, labels }),
		);
	}
	return serialized;
}

export const hydrateMyWorkItems = hydrateMyWorkRows;
