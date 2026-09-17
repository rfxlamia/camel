// Client mutation router for unified work items — see docs/pocket/adr/2026-09-board-tracker-dual-table.md (#103).
import { api } from "../api";
import type { TrackerItem, WorkItem } from "../types";
import type { MyWorkItem } from "../types/myWork";

type TrackerItemPatch = Parameters<typeof api.updateWorkItem>[2];
type CardPatch = Parameters<typeof api.updateCard>[2];

export type MyWorkMutationStatus =
	| "pending"
	| "success"
	| "failure"
	| "unavailable";

export interface MyWorkMutationSnapshot {
	identity: string;
	item: MyWorkItem;
	sequence: number;
	status: MyWorkMutationStatus;
	error?: unknown;
}

type MyWorkMutationListener = () => void;
type MyWorkMutationIdentity = Pick<
	MyWorkItem,
	"workspaceId" | "source" | "key"
>;

const myWorkMutationSnapshots = new Map<string, MyWorkMutationSnapshot>();
const myWorkMutationListeners = new Set<MyWorkMutationListener>();
let myWorkMutationSequence = 0;

export function myWorkMutationIdentity(item: MyWorkMutationIdentity): string {
	return `${item.workspaceId}:${item.source}:${item.key}`;
}

function notifyMyWorkMutationListeners(): void {
	for (const listener of myWorkMutationListeners) {
		try {
			listener();
		} catch {
			// A subscriber must not prevent other My Work surfaces from reconciling.
		}
	}
}

export function subscribeToMyWorkMutations(
	listener: MyWorkMutationListener,
): () => void {
	myWorkMutationListeners.add(listener);
	return () => myWorkMutationListeners.delete(listener);
}

export function getMyWorkMutationRevision(): number {
	return myWorkMutationSequence;
}

export function getMyWorkMutationSnapshot(
	identity: string | MyWorkMutationIdentity,
): MyWorkMutationSnapshot | undefined {
	const key =
		typeof identity === "string" ? identity : myWorkMutationIdentity(identity);
	return myWorkMutationSnapshots.get(key);
}

export function beginMyWorkMutation(item: MyWorkItem): number {
	const identity = myWorkMutationIdentity(item);
	const sequence = ++myWorkMutationSequence;
	myWorkMutationSnapshots.set(identity, {
		identity,
		item,
		sequence,
		status: "pending",
	});
	notifyMyWorkMutationListeners();
	return sequence;
}

export function settleMyWorkMutation(
	item: MyWorkItem,
	sequence: number,
	status: Exclude<MyWorkMutationStatus, "pending">,
	result: MyWorkItem = item,
	error?: unknown,
): boolean {
	const identity = myWorkMutationIdentity(item);
	const current = myWorkMutationSnapshots.get(identity);
	if (!current || current.sequence !== sequence) return false;
	myWorkMutationSnapshots.set(identity, {
		identity,
		item: result,
		sequence,
		status,
		...(error === undefined ? {} : { error }),
	});
	notifyMyWorkMutationListeners();
	return true;
}

/** Clear a settled overlay after a newer authoritative read supersedes it. */
export function reconcileMyWorkMutationSnapshot(identity: string): boolean {
	if (!myWorkMutationSnapshots.delete(identity)) return false;
	notifyMyWorkMutationListeners();
	return true;
}

/** Test-only reset for the process-local mutation reconciliation state. */
export function resetMyWorkMutationsForTests(): void {
	myWorkMutationSnapshots.clear();
	myWorkMutationSequence = 0;
	notifyMyWorkMutationListeners();
}

/** Keep a Mark done response tied to the source-aware item identity. */
export function mergeMyWorkMutationResult(
	item: MyWorkItem,
	result: MyWorkItem | null | undefined,
): MyWorkItem {
	if (!result || typeof result !== "object") return item;
	return {
		...item,
		...result,
		source: item.source,
		workspaceId: item.workspaceId,
		identity: {
			...item.identity,
			workspaceId: item.workspaceId,
			source: item.source,
			key: item.key,
		},
	};
}

/** Execute the source-aware My Work Mark done command with the item's version. */
export async function markWorkItemDone(
	workspaceId: number,
	item: MyWorkItem,
	version = item.version,
): Promise<MyWorkItem> {
	const updated = await api.markMyWorkDone(
		workspaceId,
		item.source,
		item.key,
		version,
	);
	return mergeMyWorkMutationResult(item, updated);
}

export async function updateWorkItem(
	workspaceId: number,
	item: WorkItem,
	patch: TrackerItemPatch,
): Promise<WorkItem> {
	if (item.source === "board") {
		const cardPatch: CardPatch = {};
		if (patch.title !== undefined) cardPatch.title = patch.title;
		if (patch.description !== undefined) {
			cardPatch.description = patch.description;
		}
		if (patch.priorityId !== undefined) cardPatch.priorityId = patch.priorityId;
		if (patch.labelIds !== undefined) cardPatch.labelIds = patch.labelIds;
		if (patch.projectId !== undefined) cardPatch.projectId = patch.projectId;
		if (patch.phaseId !== undefined) cardPatch.phaseId = patch.phaseId;
		if (patch.assigneeIds !== undefined) {
			cardPatch.assigneeIds = patch.assigneeIds;
		}
		if (patch.version !== undefined) cardPatch.version = patch.version;

		const updated = await api.updateCard(workspaceId, item.id, cardPatch);
		return {
			...item,
			title: updated.title,
			description: updated.description,
			priority: updated.priority ?? null,
			labels: updated.labels ?? [],
			projectId: updated.projectId ?? null,
			phaseId: updated.phaseId ?? null,
			assignees: updated.assignees,
			version: updated.version,
			dueDate: updated.dueDate,
			updatedAt: updated.updatedAt,
		};
	}

	const updated = await api.updateWorkItem(workspaceId, item.key, patch);
	return { ...item, ...updated, source: "tracker" };
}

export async function updateWorkItemStatus(
	workspaceId: number,
	item: WorkItem,
	statusId: number,
	version: number,
): Promise<WorkItem> {
	if (item.source === "board") {
		const updated = await api.updateWorkItem(workspaceId, item.key, {
			statusId,
			version,
		});
		return { ...item, ...updated, source: "board" };
	}

	const updated = await api.updateWorkItem(workspaceId, item.key, {
		statusId,
		version,
	});
	return { ...item, ...updated, source: "tracker" };
}

type ReorderBody = Parameters<typeof api.reorderWorkItem>[2];

export async function reorderWorkItem(
	workspaceId: number,
	item: WorkItem,
	body: ReorderBody,
): Promise<WorkItem> {
	const updated = await api.reorderWorkItem(workspaceId, item.key, body);
	return { ...item, ...updated, source: item.source };
}

export function isBoardWorkItem(
	item: TrackerItem | WorkItem,
): item is WorkItem {
	return "source" in item && item.source === "board";
}
