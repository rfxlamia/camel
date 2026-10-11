import type { ApiRequest } from "../../shared/apiRequest";
import type {
	TrackerEvent,
	TrackerItem,
	TrackerPhase,
	TrackerProject,
	TrackerVocabulary,
	TrackerVocabularyKind,
	WorkItem,
} from "../../types";

export function createTrackerApi(request: ApiRequest) {
	return {
		createTrackerItem: (
			workspaceId: number,
			body: {
				title: string;
				description?: string;
				statusId?: number;
				priorityId?: number | null;
				labelIds?: number[];
				assigneeIds?: number[];
				projectId?: number | null;
				phaseId?: number | null;
			},
		) =>
			request<TrackerItem>(`/workspaces/${workspaceId}/tracker/items`, {
				method: "POST",
				body: JSON.stringify(body),
			}),

		listTrackerItems: (workspaceId: number, opts?: { q?: string }) => {
			const params = new URLSearchParams();
			if (opts?.q !== undefined) params.set("q", opts.q);
			const query = params.toString();
			return request<WorkItem[]>(
				query
					? `/workspaces/${workspaceId}/tracker/items?${query}`
					: `/workspaces/${workspaceId}/tracker/items`,
			);
		},

		getTrackerItem: (workspaceId: number, key: string) =>
			request<WorkItem>(`/workspaces/${workspaceId}/tracker/items/${key}`),

		updateTrackerItem: (
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
			request<WorkItem>(`/workspaces/${workspaceId}/tracker/items/${key}`, {
				method: "PATCH",
				body: JSON.stringify(patch),
			}),

		reorderTrackerItem: (
			workspaceId: number,
			key: string,
			body: { beforeKey?: string; afterKey?: string },
		) =>
			request<WorkItem>(
				`/workspaces/${workspaceId}/tracker/items/${key}/position`,
				{
					method: "PATCH",
					body: JSON.stringify(body),
				},
			),

		deleteTrackerItem: (
			workspaceId: number,
			key: string,
			body?: { version?: number },
		) =>
			request<void>(`/workspaces/${workspaceId}/tracker/items/${key}`, {
				method: "DELETE",
				body: JSON.stringify(body ?? {}),
			}),

		getTrackerChangelog: (workspaceId: number, key: string) =>
			request<{ events: TrackerEvent[] }>(
				`/workspaces/${workspaceId}/tracker/items/${key}/events`,
			),

		listTrackerVocabularies: (
			workspaceId: number,
			kind: TrackerVocabularyKind,
		) =>
			request<TrackerVocabulary[]>(
				`/workspaces/${workspaceId}/tracker/vocabularies?kind=${kind}`,
			),

		createTrackerVocabulary: (
			workspaceId: number,
			body: {
				kind: TrackerVocabularyKind;
				name: string;
				position: number;
				colour?: string;
			},
		) =>
			request<TrackerVocabulary>(
				`/workspaces/${workspaceId}/tracker/vocabularies`,
				{
					method: "POST",
					body: JSON.stringify(body),
				},
			),

		listTrackerProjects: (workspaceId: number) =>
			request<TrackerProject[]>(`/workspaces/${workspaceId}/tracker/projects`),

		createTrackerProject: (workspaceId: number, body: { name: string }) =>
			request<TrackerProject>(`/workspaces/${workspaceId}/tracker/projects`, {
				method: "POST",
				body: JSON.stringify(body),
			}),

		updateTrackerProject: (
			workspaceId: number,
			id: number,
			patch: { name: string; version: number },
		) =>
			request<TrackerProject>(
				`/workspaces/${workspaceId}/tracker/projects/${id}`,
				{
					method: "PATCH",
					body: JSON.stringify(patch),
				},
			),

		deleteTrackerProject: (workspaceId: number, id: number) =>
			request<void>(`/workspaces/${workspaceId}/tracker/projects/${id}`, {
				method: "DELETE",
			}),

		createTrackerPhase: (
			workspaceId: number,
			projectId: number,
			body: {
				name: string;
				subtitle?: string;
				startDate?: string | null;
				endDate?: string | null;
			},
		) =>
			request<TrackerPhase>(
				`/workspaces/${workspaceId}/tracker/projects/${projectId}/phases`,
				{
					method: "POST",
					body: JSON.stringify(body),
				},
			),

		updateTrackerPhase: (
			workspaceId: number,
			id: number,
			patch: {
				name: string;
				version: number;
				startDate?: string | null;
				endDate?: string | null;
			},
		) =>
			request<TrackerPhase>(`/workspaces/${workspaceId}/tracker/phases/${id}`, {
				method: "PATCH",
				body: JSON.stringify(patch),
			}),

		deleteTrackerPhase: (workspaceId: number, id: number) =>
			request<void>(`/workspaces/${workspaceId}/tracker/phases/${id}`, {
				method: "DELETE",
			}),
	};
}
