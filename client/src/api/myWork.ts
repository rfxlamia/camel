import type { WorkItemSource } from "../types";
import type {
	MyWorkDetailResponse,
	MyWorkListRequest,
	MyWorkListResponse,
	MyWorkMarkDoneResponse,
} from "../types/myWork";

export type MyWorkRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

function myWorkItemPath(
	workspaceId: number,
	source: WorkItemSource,
	key: string,
): string {
	return `/my-work/${workspaceId}/${encodeURIComponent(source)}/${encodeURIComponent(key)}`;
}

export function createMyWorkApi(request: MyWorkRequest) {
	return {
		listMyWork: (options: MyWorkListRequest = {}) => {
			const params = new URLSearchParams();
			params.set("scope", options.scope || "active");
			if (options.q) params.set("q", options.q);
			if (options.workspaceId !== undefined && options.workspaceId !== "") {
				params.set("workspaceId", String(options.workspaceId));
			}
			if (options.source) params.set("source", options.source);
			if (options.cursor) params.set("cursor", options.cursor);
			if (options.limit !== undefined && options.limit !== "") {
				params.set("limit", String(options.limit));
			}
			return request<MyWorkListResponse>(`/my-work?${params.toString()}`);
		},
		getMyWorkItem: (workspaceId: number, source: WorkItemSource, key: string) =>
			request<MyWorkDetailResponse>(myWorkItemPath(workspaceId, source, key)),
		markMyWorkDone: (
			workspaceId: number,
			source: WorkItemSource,
			key: string,
			version: number,
		) =>
			request<MyWorkMarkDoneResponse>(
				`${myWorkItemPath(workspaceId, source, key)}/done`,
				{
					method: "POST",
					body: JSON.stringify({ version }),
				},
			),
	};
}
