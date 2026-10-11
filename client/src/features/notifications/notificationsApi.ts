import type { ApiRequest } from "../../shared/apiRequest";
import type { NotificationsResponse } from "../../types";

export function createNotificationsApi(request: ApiRequest) {
	return {
		getNotifications: (
			workspaceId: number,
			opts?: { cursor?: number; limit?: number },
		) => {
			const params = new URLSearchParams();
			if (opts?.cursor !== undefined) params.set("cursor", String(opts.cursor));
			if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
			const query = params.toString();
			return request<NotificationsResponse>(
				query
					? `/workspaces/${workspaceId}/notifications?${query}`
					: `/workspaces/${workspaceId}/notifications`,
			);
		},

		markNotificationAsRead: (workspaceId: number, id: number) =>
			request<{ ok: boolean }>(
				`/workspaces/${workspaceId}/notifications/${id}/read`,
				{ method: "PATCH" },
			),

		markAllNotificationsAsRead: (workspaceId: number) =>
			request<{ ok: boolean; markedCount: number }>(
				`/workspaces/${workspaceId}/notifications/read-all`,
				{ method: "POST" },
			),
	};
}
