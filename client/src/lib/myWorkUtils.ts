import type { WorkItemSource } from "../types";
import type { MyWorkScope } from "../types/myWork";

export type {
	MyWorkGroupMap,
	MyWorkStatusGroup,
} from "./myWorkStatus";
export {
	deriveMyWorkGroups,
	filterMyWorkItems,
	isActiveMyWorkItem,
	normalizeMyWorkStatus,
} from "./myWorkStatus";
export {
	isMyWorkItemOverdue,
	orderMyWorkItems,
} from "./myWorkOrdering";

export type { MyWorkPage } from "./myWorkSearch";
export { MY_WORK_PAGE_SIZE, paginateMyWorkItems } from "./myWorkSearch";

export interface MyWorkViewState {
	scope: MyWorkScope;
	workspaceId: number | "";
	source: WorkItemSource | "";
	q: string;
	page: number;
}

export const DEFAULT_MY_WORK_VIEW_STATE: MyWorkViewState = {
	scope: "active",
	workspaceId: "",
	source: "",
	q: "",
	page: 1,
};

function parseWorkspaceId(value: string | null): number | "" {
	if (!value || !/^\d+$/.test(value)) return "";
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : "";
}

/** Parse URL view state using presentation-only defaults; it performs no I/O. */
export function parseMyWorkViewState(
	input: URLSearchParams | string,
): MyWorkViewState {
	const params = typeof input === "string" ? new URLSearchParams(input) : input;
	const scope: MyWorkScope = params.get("scope") === "all" ? "all" : "active";
	const workspaceId = parseWorkspaceId(
		params.get("workspaceId") ?? params.get("workspace"),
	);
	const sourceValue = params.get("source");
	const source: WorkItemSource | "" =
		sourceValue === "board" || sourceValue === "tracker" ? sourceValue : "";
	const pageValue = Number(params.get("page"));
	const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
	return {
		scope,
		workspaceId,
		source,
		q: params.get("q") ?? "",
		page,
	};
}

/** Serialize view state with defaults omitted for compact, stable URLs. */
export function serializeMyWorkViewState(
	state: Partial<MyWorkViewState>,
): URLSearchParams {
	const params = new URLSearchParams();
	if (state.scope === "all") params.set("scope", "all");
	if (typeof state.workspaceId === "number" && state.workspaceId > 0) {
		params.set("workspaceId", String(state.workspaceId));
	}
	if (state.source === "board" || state.source === "tracker") {
		params.set("source", state.source);
	}
	if (state.q) params.set("q", state.q);
	if (
		state.page !== undefined &&
		Number.isSafeInteger(state.page) &&
		state.page > 1
	) {
		params.set("page", String(state.page));
	}
	return params;
}
