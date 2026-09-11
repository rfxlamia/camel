// Server-side response and merge helpers for the authenticated My Work read boundary.
// The cards + tracker_items dual-table shim is intentional; tracker rows win only
// when the two sources collide inside the same workspace.
import { derivePrefix } from "../core/tracker-key.js";
import type { DBExecutor } from "../db/kysely.js";
import {
	type CardAssignee,
	loadCardAssigneesForCards,
} from "./card-assignees.js";
import { loadCardLabelsForCards } from "./card-response.js";
import {
	loadTrackerAssigneesForItems,
	type TrackerItemAssignee,
} from "./tracker-assignees.js";
import type { VocabularyRow } from "./vocabulary-response.js";
import {
	type BoardWorkItemRow,
	serializeBoardWorkItem,
	serializeTrackerWorkItem,
	type TrackerItemRow,
} from "./work-item-response.js";

export type MyWorkSource = "board" | "tracker";
export type MyWorkStatusCategory =
	| "backlog"
	| "started"
	| "completed"
	| "canceled";
export type MyWorkStatusGroup = MyWorkStatusCategory | "other";

export interface MyWorkWorkspace {
	id: number;
	name: string;
	timezone: string | null;
}

export type MyWorkTrackerRow = TrackerItemRow & {
	workspace_id: number;
	/** Optional test/source hydration; production rows are hydrated in batches. */
	assignees?: TrackerItemAssignee[];
	labels?: VocabularyRow[];
};

export type MyWorkBoardRow = BoardWorkItemRow & {
	workspace_id: number;
	/** Optional test/source hydration; production rows are hydrated in batches. */
	assignees?: CardAssignee[];
	labels?: VocabularyRow[];
};

export type MyWorkCandidate =
	| { source: "tracker"; row: MyWorkTrackerRow }
	| { source: "board"; row: MyWorkBoardRow };

export type MyWorkAssignee = {
	id: number;
	username: string;
	displayName: string;
};

export type MyWorkSerializedItem = Record<string, unknown> & {
	id: number;
	key: string;
	source: MyWorkSource;
	title: string;
	description: string;
	status: Record<string, unknown>;
	updatedAt: string;
	workspace: MyWorkWorkspace;
	workspaceId: number;
	workspaceName: string;
	identity: {
		workspaceId: number;
		source: MyWorkSource;
		key: string;
	};
	statusCategory: MyWorkStatusCategory | null;
	canMarkDone: boolean;
	markDoneReason: "missing_done_mapping" | "terminal" | "pending" | null;
};

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
 * Unknown categories deliberately fall back to slot when possible, otherwise
 * null so the item can be rendered in the Other group without inventing a
 * new persisted category.
 */
export function normalizeMyWorkStatusCategory(
	category: string | null | undefined,
	slot: string | null | undefined,
): MyWorkStatusCategory | null {
	if (category && STATUS_CATEGORIES.has(category as MyWorkStatusCategory)) {
		return category as MyWorkStatusCategory;
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
	status_category: string | null;
	status_slot: string | null;
}) {
	return normalizeMyWorkStatusCategory(row.status_category, row.status_slot);
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

/**
 * Serialize one already-authorized candidate. The function intentionally
 * receives workspace metadata separately; callers must not serialize a row
 * for which no currently-authorized workspace metadata exists.
 */
export function serializeMyWorkCandidate(
	candidate: MyWorkCandidate,
	workspace: MyWorkWorkspace,
	hydration: {
		assignees?: readonly MyWorkAssignee[];
		labels?: readonly VocabularyRow[];
	} = {},
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
	const terminal = category === "completed" || category === "canceled";
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
		canMarkDone: !terminal,
		markDoneReason: terminal ? "terminal" : null,
	} as MyWorkSerializedItem;
}

export const serializeMyWorkItem = serializeMyWorkCandidate;

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
	const trackerCandidates = candidates.filter(
		(candidate): candidate is Extract<MyWorkCandidate, { source: "tracker" }> =>
			candidate.source === "tracker",
	);
	const boardCandidates = candidates.filter(
		(candidate): candidate is Extract<MyWorkCandidate, { source: "board" }> =>
			candidate.source === "board",
	);

	const trackerIdsForAssignees = uniqueIds(
		trackerCandidates
			.filter((candidate) => candidate.row.assignees === undefined)
			.map((candidate) => candidate.row.id),
	);
	const trackerIdsForLabels = uniqueIds(
		trackerCandidates
			.filter((candidate) => candidate.row.labels === undefined)
			.map((candidate) => candidate.row.id),
	);
	const boardIdsForAssignees = uniqueIds(
		boardCandidates
			.filter((candidate) => candidate.row.assignees === undefined)
			.map((candidate) => candidate.row.id),
	);
	const boardIdsForLabels = uniqueIds(
		boardCandidates
			.filter((candidate) => candidate.row.labels === undefined)
			.map((candidate) => candidate.row.id),
	);

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

export type MyWorkCursor = {
	group: number;
	overdue: boolean;
	dueDate: string | null;
	updatedAt: string;
	workspaceId: number;
	source: MyWorkSource;
	key: string;
	id: number;
};

function safeIso(value: unknown): string {
	if (typeof value === "string") return value;
	return "";
}

function itemDueDate(item: MyWorkSerializedItem): string | null {
	const value = item.source === "board" ? item.dueDate : item.endDate;
	return typeof value === "string" && value.length > 0
		? value.slice(0, 10)
		: null;
}

function itemStatusGroup(item: MyWorkSerializedItem): MyWorkStatusGroup {
	if (item.statusCategory) return item.statusCategory;
	const status = item.status;
	return myWorkStatusGroup(
		typeof status.category === "string" ? status.category : null,
		typeof status.slot === "string" ? status.slot : null,
	);
}

function localDateForTimezone(now: Date, timezone: string | null): string {
	const resolvedTimezone = timezone || "UTC";
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: resolvedTimezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).formatToParts(now);
		const year = parts.find((part) => part.type === "year")?.value ?? "1970";
		const month = parts.find((part) => part.type === "month")?.value ?? "01";
		const day = parts.find((part) => part.type === "day")?.value ?? "01";
		return `${year}-${month}-${day}`;
	} catch {
		return now.toISOString().slice(0, 10);
	}
}

export function isMyWorkItemOverdue(
	item: MyWorkSerializedItem,
	now = new Date(),
): boolean {
	const dueDate = itemDueDate(item);
	if (!dueDate) return false;
	const group = itemStatusGroup(item);
	if (group === "completed" || group === "canceled") return false;
	return dueDate < localDateForTimezone(now, item.workspace.timezone);
}

export const isOverdue = isMyWorkItemOverdue;

function groupRank(group: MyWorkStatusGroup): number {
	switch (group) {
		case "backlog":
			return 0;
		case "started":
			return 1;
		case "completed":
			return 2;
		case "canceled":
			return 3;
		case "other":
			return 4;
	}
}

function cursorForItem(item: MyWorkSerializedItem, now: Date): MyWorkCursor {
	return {
		group: groupRank(itemStatusGroup(item)),
		overdue: isMyWorkItemOverdue(item, now),
		dueDate: itemDueDate(item),
		updatedAt: safeIso(item.updatedAt),
		workspaceId: item.workspaceId,
		source: item.source,
		key: item.key,
		id: item.id,
	};
}

function compareNullableDates(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a < b ? -1 : 1;
}

/** Newer updates are first; every following field makes the order total. */
export function compareMyWorkCursors(a: MyWorkCursor, b: MyWorkCursor): number {
	if (a.group !== b.group) return a.group - b.group;
	if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
	const due = compareNullableDates(a.dueDate, b.dueDate);
	if (due !== 0) return due;
	if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
	if (a.workspaceId !== b.workspaceId) return a.workspaceId - b.workspaceId;
	if (a.source !== b.source) return a.source === "board" ? -1 : 1;
	if (a.key !== b.key) return a.key < b.key ? -1 : 1;
	return a.id - b.id;
}

export function sortMyWorkItems(
	items: readonly MyWorkSerializedItem[],
	now = new Date(),
): MyWorkSerializedItem[] {
	return [...items].sort((a, b) =>
		compareMyWorkCursors(cursorForItem(a, now), cursorForItem(b, now)),
	);
}

export const orderMyWorkItems = sortMyWorkItems;

export function encodeMyWorkCursor(cursor: MyWorkCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeMyWorkCursor(value: string): MyWorkCursor | null {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		);
		if (!parsed || typeof parsed !== "object") return null;
		const candidate = parsed as Record<string, unknown>;
		if (
			typeof candidate.group !== "number" ||
			typeof candidate.overdue !== "boolean" ||
			(candidate.dueDate !== null && typeof candidate.dueDate !== "string") ||
			typeof candidate.updatedAt !== "string" ||
			typeof candidate.workspaceId !== "number" ||
			(candidate.source !== "board" && candidate.source !== "tracker") ||
			typeof candidate.key !== "string" ||
			typeof candidate.id !== "number"
		) {
			return null;
		}
		return {
			group: candidate.group,
			overdue: candidate.overdue,
			dueDate: candidate.dueDate,
			updatedAt: candidate.updatedAt,
			workspaceId: candidate.workspaceId,
			source: candidate.source,
			key: candidate.key,
			id: candidate.id,
		};
	} catch {
		return null;
	}
}

export const encodeCursor = encodeMyWorkCursor;
export const decodeCursor = decodeMyWorkCursor;

export function paginateMyWorkItems(
	items: readonly MyWorkSerializedItem[],
	options: {
		limit?: number;
		cursor?: string | null;
		now?: Date;
		/** True when a bounded source query returned a sentinel row. */
		hasMore?: boolean;
	} = {},
): { items: MyWorkSerializedItem[]; nextCursor: string | null } {
	const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 50)));
	const now = options.now ?? new Date();
	const ordered = sortMyWorkItems(items, now);
	let start = 0;
	if (options.cursor) {
		const cursor = decodeMyWorkCursor(options.cursor);
		if (cursor) {
			start = ordered.findIndex(
				(item) => compareMyWorkCursors(cursorForItem(item, now), cursor) > 0,
			);
			if (start === -1) start = ordered.length;
		}
	}
	const page = ordered.slice(start, start + limit);
	const hasMore = options.hasMore === true || start + limit < ordered.length;
	return {
		items: page,
		nextCursor:
			hasMore && page.length > 0
				? encodeMyWorkCursor(cursorForItem(page[page.length - 1]!, now))
				: null,
	};
}

export const paginateMyWork = paginateMyWorkItems;
