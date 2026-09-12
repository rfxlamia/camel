import type { WorkItemSource } from "../types";
import type {
	MyWorkDetailResponse,
	MyWorkListRequest,
	MyWorkListResponse,
	MyWorkMarkDoneResponse,
} from "../types/myWork";

export type MyWorkRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export type MyWorkActiveCandidateRequest = Pick<
	MyWorkListRequest,
	"q" | "workspaceId" | "source" | "limit"
> & {
	/** Maximum number of server pages to drain (capped at the active bound). */
	maxPages?: number;
};

const MAX_ACTIVE_CANDIDATE_PAGES = 20;

function boundedMaxPages(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined || value < 1) {
		return MAX_ACTIVE_CANDIDATE_PAGES;
	}
	return Math.min(MAX_ACTIVE_CANDIDATE_PAGES, Math.floor(value));
}

function myWorkItemPath(
	workspaceId: number,
	source: WorkItemSource,
	key: string,
): string {
	return `/my-work/${workspaceId}/${encodeURIComponent(source)}/${encodeURIComponent(key)}`;
}

export function createMyWorkApi(request: MyWorkRequest) {
	const listMyWork = (options: MyWorkListRequest = {}) => {
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
	};

	const listActiveMyWorkCandidates = async (
		options: MyWorkActiveCandidateRequest = {},
	): Promise<MyWorkListResponse> => {
		const maxPages = boundedMaxPages(options.maxPages);
		const filters: MyWorkListRequest = {
			workspaceId: options.workspaceId,
			source: options.source,
			limit: options.limit,
		};
		const items = [] as MyWorkListResponse["items"];
		const seenCursors = new Set<string>();
		let cursor: string | null = null;

		for (let page = 0; page < maxPages; page += 1) {
			const response = await listMyWork({
				...filters,
				scope: "active",
				...(cursor === null ? {} : { cursor }),
			});
			items.push(...response.items);
			const nextCursor = response.nextCursor;
			if (!nextCursor || seenCursors.has(nextCursor)) {
				return { items, nextCursor: null };
			}
			seenCursors.add(nextCursor);
			cursor = nextCursor;
		}

		// Preserve a continuation signal if the bounded candidate budget is hit.
		return { items, nextCursor: cursor };
	};

	return {
		listMyWork,
		listActiveMyWorkCandidates,
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
