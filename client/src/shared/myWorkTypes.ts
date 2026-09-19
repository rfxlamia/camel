import type { TrackerStatusCategory, WorkItem, WorkItemSource } from "../types";

export type MyWorkScope = "active" | "all";

export interface MyWorkListRequest {
	scope?: MyWorkScope;
	q?: string;
	workspaceId?: number | "";
	source?: WorkItemSource | "";
	cursor?: string | null;
	limit?: number | "";
}

export interface MyWorkIdentity {
	workspaceId: number;
	source: WorkItemSource;
	key: string;
}

export type MyWorkActionReason =
	| "missing_done_mapping"
	| "terminal"
	| "pending"
	| null;

export interface MyWorkWorkspace {
	id: number;
	name: string;
	timezone: string | null;
}

export interface MyWorkItem extends WorkItem {
	workspace: MyWorkWorkspace;
	workspaceId: number;
	workspaceName: string;
	identity: MyWorkIdentity;
	statusCategory?: TrackerStatusCategory | null;
	canMarkDone: boolean;
	markDoneReason: MyWorkActionReason;
}

export interface MyWorkListResponse {
	items: MyWorkItem[];
	nextCursor: string | null;
}

export type MyWorkDetailResponse = MyWorkItem;
export type MyWorkMarkDoneResponse = MyWorkItem;
