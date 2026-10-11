import type { ApiRequest } from "../../shared/apiRequest";
import type { SettingsMap } from "../../types";

export function createSettingsApi(request: ApiRequest) {
	return {
		getSettings: (workspaceId: number) =>
			request<SettingsMap>(`/workspaces/${workspaceId}/settings`),

		updateSettings: (
			workspaceId: number,
			settings: Array<{
				key: string;
				textValue?: string;
				boolValue?: boolean;
				version: number;
			}>,
		) =>
			request<SettingsMap>(`/workspaces/${workspaceId}/settings`, {
				method: "PATCH",
				body: JSON.stringify(settings),
			}),

		resetSettings: (workspaceId: number) =>
			request<void>(`/workspaces/${workspaceId}/settings`, {
				method: "DELETE",
			}),

		uploadLogo: (workspaceId: number, file: File): Promise<SettingsMap> => {
			const formData = new FormData();
			formData.append("logo", file);
			return request.raw<SettingsMap>(
				`/workspaces/${workspaceId}/settings/logo`,
				{ method: "POST", body: formData, credentials: "same-origin" },
				(status) => `Upload failed (${status})`,
			);
		},
	};
}
