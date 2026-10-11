import type { ApiRequest } from "../../shared/apiRequest";
import type { ActivityEvent, PresenceUser } from "../../types";

export function createActivityApi(request: ApiRequest) {
	return {
		getActivity: (workspaceId: number, limit?: number) =>
			request<{ events: ActivityEvent[] }>(
				limit !== undefined
					? `/workspaces/${workspaceId}/activity?limit=${limit}`
					: `/workspaces/${workspaceId}/activity`,
			),

		getPresence: (workspaceId: number) =>
			request<{ users: PresenceUser[] }>(`/workspaces/${workspaceId}/presence`),

		heartbeat: (workspaceId: number) =>
			request<{ ok: boolean }>(
				`/workspaces/${workspaceId}/presence/heartbeat`,
				{
					method: "POST",
				},
			),
	};
}
