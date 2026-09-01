import { api } from "../api";
import type { TrackerItem, WorkItem } from "../types";

type TrackerItemPatch = Parameters<typeof api.updateWorkItem>[2];
type CardPatch = Parameters<typeof api.updateCard>[2];

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
			updatedAt: item.updatedAt,
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

export function isBoardWorkItem(item: TrackerItem | WorkItem): item is WorkItem {
	return "source" in item && item.source === "board";
}
