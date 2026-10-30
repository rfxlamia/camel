import type { ApiRequest } from "../../shared/apiRequest";
import type { BoardCreatePayload } from "../../shared/taskCreateContracts";
import type {
	ActivityEvent,
	Board,
	Card,
	CardAttachment,
	Column,
	FlowMetrics,
	MetricsHistoryBucket,
} from "../../types";
import type { TemplateColumn } from "./templates";

export type CardAttachmentUploadResponse = {
	attachments: CardAttachment[];
	acceptedCount: number;
	addedCount: number;
	rejectedCount: number;
	requestedCount: number;
	total: number;
	totalCount: number;
	limit: number;
	message?: string;
};
function cardAttachmentBasePath(
	workspaceId: number,
	cardId: number,
	attachmentId: number,
): string {
	return `/api/workspaces/${workspaceId}/cards/${cardId}/attachments/${attachmentId}`;
}
export function cardAttachmentThumbnailUrl(
	workspaceId: number,
	cardId: number,
	attachmentId: number,
): string {
	return `${cardAttachmentBasePath(workspaceId, cardId, attachmentId)}/thumbnail`;
}
export function cardAttachmentOriginalUrl(
	workspaceId: number,
	cardId: number,
	attachmentId: number,
): string {
	return `${cardAttachmentBasePath(workspaceId, cardId, attachmentId)}/original`;
}
export function cardAttachmentDownloadUrl(
	workspaceId: number,
	cardId: number,
	attachmentId: number,
): string {
	return `${cardAttachmentBasePath(workspaceId, cardId, attachmentId)}/original/download`;
}
function serializeBoardCreateMetadata(body: BoardCreatePayload): string {
	return JSON.stringify({
		columnId: body.columnId,
		title: body.title,
		description: body.description ?? "",
		assigneeIds: body.assigneeIds,
		priorityId: body.priorityId,
		labelIds: body.labelIds,
		projectId: body.projectId,
		phaseId: body.phaseId,
		dueDate: body.dueDate,
	});
}
function buildAttachmentFormData(
	pairs: Array<{ thumbnail: File; original: File }>,
): FormData {
	const formData = new FormData();
	for (const pair of pairs) {
		formData.append("thumbnail", pair.thumbnail);
		formData.append("original", pair.original);
	}
	return formData;
}
export function createBoardApi(request: ApiRequest) {
	return {
		getBoard: (workspaceId: number) =>
			request<Board>(`/workspaces/${workspaceId}/board`),

		getMetrics: (workspaceId: number) =>
			request<FlowMetrics>(`/workspaces/${workspaceId}/metrics`),

		getMetricsHistory: (workspaceId: number, weeks?: number) =>
			request<{ weeks: MetricsHistoryBucket[] }>(
				weeks !== undefined
					? `/workspaces/${workspaceId}/metrics/history?weeks=${weeks}`
					: `/workspaces/${workspaceId}/metrics/history`,
			),

		getCard: (workspaceId: number, id: number) =>
			request<Card>(`/workspaces/${workspaceId}/cards/${id}`),

		createCard: (workspaceId: number, body: BoardCreatePayload) => {
			if (body.attachments && body.attachments.length > 0) {
				const formData = buildAttachmentFormData(body.attachments);
				formData.set("metadata", serializeBoardCreateMetadata(body));
				return request<Card>(
					`/workspaces/${workspaceId}/cards`,
					{
						method: "POST",
						body: formData,
					},
					{ userInitiated: true, userAction: "submit" },
				);
			}
			return request<Card>(
				`/workspaces/${workspaceId}/cards`,
				{
					method: "POST",
					body: JSON.stringify({
						columnId: body.columnId,
						title: body.title,
						description: body.description ?? "",
						assigneeIds: body.assigneeIds,
						priorityId: body.priorityId,
						labelIds: body.labelIds,
						projectId: body.projectId,
						phaseId: body.phaseId,
						dueDate: body.dueDate,
					}),
				},
				{ userInitiated: true, userAction: "submit" },
			);
		},

		uploadCardAttachments: (
			workspaceId: number,
			cardId: number,
			pairs: Array<{ thumbnail: File; original: File }>,
		) => {
			const formData = buildAttachmentFormData(pairs);
			return request<CardAttachmentUploadResponse>(
				`/workspaces/${workspaceId}/cards/${cardId}/attachments`,
				{
					method: "POST",
					body: formData,
				},
				{ userInitiated: true, userAction: "upload-attachment" },
			);
		},

		deleteCardAttachment: (
			workspaceId: number,
			cardId: number,
			attachmentId: number,
		) =>
			request<void>(
				`/workspaces/${workspaceId}/cards/${cardId}/attachments/${attachmentId}`,
				{ method: "DELETE" },
				{ userInitiated: true, userAction: "delete-attachment" },
			),

		updateCard: (
			workspaceId: number,
			id: number,
			patch: {
				title?: string;
				description?: string;
				assigneeIds?: number[];
				dueDate?: string | null;
				priorityId?: number | null;
				labelIds?: number[];
				projectId?: number | null;
				phaseId?: number | null;
				version?: number;
			},
		) =>
			request<Card>(
				`/workspaces/${workspaceId}/cards/${id}`,
				{
					method: "PATCH",
					body: JSON.stringify(patch),
				},
				{ userInitiated: true, userAction: "Save" },
			),

		deleteCard: (workspaceId: number, id: number, version?: number) =>
			request<void>(`/workspaces/${workspaceId}/cards/${id}`, {
				method: "DELETE",
				body: JSON.stringify({ version }),
			}),

		getCardActivity: (workspaceId: number, id: number) =>
			request<{ events: ActivityEvent[] }>(
				`/workspaces/${workspaceId}/cards/${id}/activity`,
			),

		moveCard: (
			workspaceId: number,
			id: number,
			body: { toColumnId: number; index: number; version?: number },
		) =>
			request<Card>(
				`/workspaces/${workspaceId}/cards/${id}/move`,
				{
					method: "POST",
					body: JSON.stringify(body),
				},
				{ userInitiated: true, userAction: "drag-drop" },
			),

		createColumn: (workspaceId: number, title: string) =>
			request<Column>(`/workspaces/${workspaceId}/columns`, {
				method: "POST",
				body: JSON.stringify({ title }),
			}),

		applyTemplate: (
			workspaceId: number,
			body: { templateName: string; columns: TemplateColumn[] },
		) =>
			request<Column[]>(`/workspaces/${workspaceId}/columns/batch`, {
				method: "POST",
				body: JSON.stringify(body),
			}),

		updateColumn: (
			workspaceId: number,
			id: number,
			patch: {
				title?: string;
				wipLimit?: number | null;
				policy?: string;
				isDone?: boolean;
				isSignable?: boolean;
				signableAssigneeId?: number | null;
				color?: string | null;
			},
		) =>
			request<Column>(`/workspaces/${workspaceId}/columns/${id}`, {
				method: "PATCH",
				body: JSON.stringify(patch),
			}),

		deleteColumn: (workspaceId: number, id: number) =>
			request<void>(`/workspaces/${workspaceId}/columns/${id}`, {
				method: "DELETE",
			}),
	};
}
