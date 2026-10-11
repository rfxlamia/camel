import type { ApiRequest } from "../../shared/apiRequest";
import type { TrackerCreatePayload } from "../../shared/taskCreateContracts";
import type { TrackerEvent, WorkItem } from "../../types";

export function createWorkItemApi(request: ApiRequest) {
	return {
		createWorkItem: (workspaceId: number, body: TrackerCreatePayload) =>
			request<WorkItem>(`/workspaces/${workspaceId}/work-items`, {
				method: "POST",
				body: JSON.stringify(body),
			}),

		listWorkItems: (workspaceId: number, opts?: { q?: string }) => {
			const params = new URLSearchParams();
			if (opts?.q !== undefined) params.set("q", opts.q);
			const query = params.toString();
			return request<WorkItem[]>(
				query
					? `/workspaces/${workspaceId}/work-items?${query}`
					: `/workspaces/${workspaceId}/work-items`,
			);
		},

		getWorkItem: (workspaceId: number, key: string) =>
			request<WorkItem>(`/workspaces/${workspaceId}/work-items/${key}`),

		updateWorkItem: (
			workspaceId: number,
			key: string,
			patch: {
				title?: string;
				description?: string;
				statusId?: number;
				priorityId?: number | null;
				assigneeIds?: number[];
				labelIds?: number[];
				projectId?: number | null;
				phaseId?: number | null;
				startDate?: string | null;
				endDate?: string | null;
				version?: number;
			},
		) =>
			request<WorkItem>(`/workspaces/${workspaceId}/work-items/${key}`, {
				method: "PATCH",
				body: JSON.stringify(patch),
			}),

		reorderWorkItem: (
			workspaceId: number,
			key: string,
			body: { beforeKey?: string; afterKey?: string },
		) =>
			request<WorkItem>(
				`/workspaces/${workspaceId}/work-items/${key}/position`,
				{
					method: "PATCH",
					body: JSON.stringify(body),
				},
			),

		deleteWorkItem: (
			workspaceId: number,
			key: string,
			body?: { version?: number },
		) =>
			request<void>(`/workspaces/${workspaceId}/work-items/${key}`, {
				method: "DELETE",
				body: JSON.stringify(body ?? {}),
			}),

		getWorkItemChangelog: (workspaceId: number, key: string) =>
			request<{ events: TrackerEvent[] }>(
				`/workspaces/${workspaceId}/work-items/${key}/events`,
			),
	};
}
