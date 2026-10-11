import type { ApiRequest } from "../../shared/apiRequest";
import type {
	FocusSession,
	FocusSessionGetResponse,
	WorkItemSource,
} from "../../types";

export function createFocusApi(request: ApiRequest) {
	return {
		focus: {
			getConfig: () => request<{ enabled: boolean }>("/focus/config"),
			get: (workspaceId: number) =>
				request<FocusSessionGetResponse>(
					`/workspaces/${workspaceId}/focus-session`,
				),
			post: (
				workspaceId: number,
				body: {
					action: "focus" | "switch";
					source: WorkItemSource;
					taskId: number;
					version?: number;
					sessionId?: number;
				},
			) =>
				request<{ session: FocusSession }>(
					`/workspaces/${workspaceId}/focus-session`,
					{
						method: "POST",
						body: JSON.stringify(body),
					},
				),
			patch: (
				workspaceId: number,
				body: {
					action: "start" | "pause" | "resume" | "finish";
					version: number;
					sessionId: number;
				},
			) =>
				request<{ session: FocusSession }>(
					`/workspaces/${workspaceId}/focus-session`,
					{
						method: "PATCH",
						body: JSON.stringify(body),
					},
				),
		},
	};
}
