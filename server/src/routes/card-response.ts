import { derivePrefix, formatKey } from "../core/tracker-key.js";
import type { DBExecutor } from "../db/kysely.js";
import {
	type CardAssignee,
	loadCardAssigneesForCards,
} from "./card-assignees.js";
import {
	serializeVocabulary,
	type VocabularyRow,
} from "./vocabulary-response.js";

export type CardResponseVocabulary = VocabularyRow;

export type CardResponseRow = {
	id: number;
	column_id: number;
	title: string;
	description: string;
	position: number;
	version: number;
	created_at: Date | string;
	started_at: Date | string | null;
	done_at: Date | string | null;
	due_date: string | null;
	workspace_name?: string;
	key_number?: number | null;
	status_id?: number | null;
	status_kind?: string | null;
	status_name?: string | null;
	status_position?: number | null;
	status_colour?: string | null;
	status_category?: string | null;
	status_slot?: string | null;
	priority_id?: number | null;
	priority_kind?: string | null;
	priority_name?: string | null;
	priority_position?: number | null;
	priority_colour?: string | null;
	project_id?: number | null;
	phase_id?: number | null;
};

export type CardResponseHydration = {
	assignees: CardAssignee[];
	labels: VocabularyRow[];
};

function toIso(value: Date | string | null): string | null {
	if (value == null) return null;
	return typeof value === "string" ? value : value.toISOString();
}

function vocabularyFromCard(
	row: CardResponseRow,
	kind: "status" | "priority",
): VocabularyRow | null {
	const id = row[`${kind}_id`];
	if (id == null) return null;
	return {
		id,
		kind: row[`${kind}_kind`] ?? kind,
		name: row[`${kind}_name`] ?? "",
		position: row[`${kind}_position`] ?? 0,
		colour: row[`${kind}_colour`] ?? "",
		...(kind === "status"
			? {
					category: row.status_category,
					slot: row.status_slot,
				}
			: {}),
	};
}

export function buildCardResponse(
	row: CardResponseRow,
	hydration: CardResponseHydration = { assignees: [], labels: [] },
) {
	const key =
		row.key_number == null || row.workspace_name == null
			? null
			: formatKey(derivePrefix(row.workspace_name), row.key_number);
	const status = vocabularyFromCard(row, "status");
	const priority = vocabularyFromCard(row, "priority");
	return {
		id: row.id,
		key,
		columnId: row.column_id,
		title: row.title,
		description: row.description,
		position: row.position,
		version: row.version,
		createdAt: toIso(row.created_at),
		startedAt: toIso(row.started_at),
		doneAt: toIso(row.done_at),
		dueDate: row.due_date,
		status: status ? serializeVocabulary(status) : null,
		priority: priority ? serializeVocabulary(priority) : null,
		labels: hydration.labels.map(serializeVocabulary),
		projectId: row.project_id ?? null,
		phaseId: row.phase_id ?? null,
		assignees: hydration.assignees,
	};
}

export const mapCardResponse = buildCardResponse;

export async function loadCardLabelsForCards(
	dbExec: DBExecutor,
	cardIds: number[],
): Promise<Map<number, VocabularyRow[]>> {
	const labelsByCard = new Map<number, VocabularyRow[]>();
	if (cardIds.length === 0) return labelsByCard;

	const rows = await dbExec
		.selectFrom("card_labels as cl")
		.innerJoin("tracker_vocabularies as tv", "tv.id", "cl.vocabulary_id")
		.select([
			"cl.card_id",
			"tv.id",
			"tv.kind",
			"tv.name",
			"tv.position",
			"tv.colour",
		])
		.where("cl.card_id", "in", cardIds)
		.where("tv.kind", "=", "label")
		.orderBy("cl.card_id")
		.orderBy("tv.position")
		.execute();

	for (const row of rows) {
		const labels = labelsByCard.get(row.card_id) ?? [];
		labels.push({
			id: row.id,
			kind: row.kind,
			name: row.name,
			position: row.position,
			colour: row.colour,
		});
		labelsByCard.set(row.card_id, labels);
	}
	return labelsByCard;
}

export async function hydrateCardResponses(
	dbExec: DBExecutor,
	rows: CardResponseRow[],
) {
	const ids = rows.map((row) => row.id);
	const [assigneesByCard, labelsByCard] = await Promise.all([
		loadCardAssigneesForCards(dbExec, ids),
		loadCardLabelsForCards(dbExec, ids),
	]);
	return rows.map((row) =>
		buildCardResponse(row, {
			assignees: assigneesByCard.get(row.id) ?? [],
			labels: labelsByCard.get(row.id) ?? [],
		}),
	);
}
