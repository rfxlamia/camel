import { derivePrefix } from "../core/tracker-key.js";
import { boundedPageLimit, localDateForTimezone } from "./my-work-query.js";
import {
	decodeMyWorkCursor,
	paginateMyWorkItems,
} from "./my-work-response-pagination.js";
import {
	isActiveMyWorkCandidate,
	mergeMyWorkRows,
} from "./my-work-response-serialization.js";
import {
	asUnavailable,
	type MyWorkHydrate,
} from "./my-work-service-support.js";
import type {
	MyWorkBoardRow,
	MyWorkCandidate,
	MyWorkDataSource,
	MyWorkListInput,
	MyWorkListResponse,
	MyWorkService,
	MyWorkSourceQueryInput,
	MyWorkTrackerRow,
	MyWorkWorkspace,
} from "./my-work-types.js";

function requestedWorkspaceIds(
	workspaces: readonly MyWorkWorkspace[],
	workspaceId: number | undefined,
): number[] {
	if (workspaceId === undefined)
		return workspaces.map((workspace) => workspace.id);
	return workspaces.some((workspace) => workspace.id === workspaceId)
		? [workspaceId]
		: [];
}

function buildSourceQueryInput(
	input: MyWorkListInput,
	workspaces: readonly MyWorkWorkspace[],
	workspaceIds: readonly number[],
	pageLimit: number,
	now: Date,
): MyWorkSourceQueryInput {
	return {
		userId: input.userId,
		workspaceIds,
		workspaceId: input.workspaceId,
		q: input.q?.trim() ?? "",
		scope: input.scope === "all" ? "all" : "active",
		cursor: input.cursor ? decodeMyWorkCursor(input.cursor) : null,
		limit: pageLimit,
		now,
		workspacePrefixes: new Map(
			workspaces.map((workspace) => [
				workspace.id,
				derivePrefix(workspace.name),
			]),
		),
		workspaceLocalDates: new Map(
			workspaces.map((workspace) => [
				workspace.id,
				localDateForTimezone(now, workspace.timezone),
			]),
		),
	};
}

async function loadSourceRows(
	source: MyWorkDataSource,
	input: MyWorkListInput,
	queryInput: MyWorkSourceQueryInput,
): Promise<{ trackerRows: MyWorkTrackerRow[]; boardRows: MyWorkBoardRow[] }> {
	const [trackerRows, boardRows] = await Promise.all([
		input.source === "board"
			? Promise.resolve([] as MyWorkTrackerRow[])
			: source.listTrackerRows(queryInput),
		input.source === "tracker"
			? Promise.resolve([] as MyWorkBoardRow[])
			: source.listBoardRows(queryInput),
	]);
	return { trackerRows, boardRows };
}

function candidateMatchesQuery(
	candidate: MyWorkCandidate,
	workspace: MyWorkWorkspace,
	q: string,
): boolean {
	if (!q) return true;
	const row = candidate.row;
	const key = `${derivePrefix(workspace.name)}-${row.key_number}`;
	const haystack =
		`${key} ${row.key_number} ${row.title} ${row.description}`.toLowerCase();
	return haystack.includes(q.toLowerCase());
}

function filterCandidates(
	candidates: MyWorkCandidate[],
	workspaceMap: ReadonlyMap<number, MyWorkWorkspace>,
	input: MyWorkListInput,
	queryInput: MyWorkSourceQueryInput,
): MyWorkCandidate[] {
	let filtered = candidates.filter(
		(candidate) =>
			workspaceMap.has(candidate.row.workspace_id) &&
			(candidate.row.assignees === undefined ||
				candidate.row.assignees.some(
					(assignee) => assignee.id === input.userId,
				)),
	);
	if (queryInput.scope === "active") {
		filtered = filtered.filter(isActiveMyWorkCandidate);
	}
	if (queryInput.scope === "all" && queryInput.q) {
		filtered = filtered.filter((candidate) => {
			const workspace = workspaceMap.get(candidate.row.workspace_id);
			return (
				workspace !== undefined &&
				candidateMatchesQuery(candidate, workspace, queryInput.q)
			);
		});
	}
	return filtered;
}

export function createMyWorkList(
	source: MyWorkDataSource,
	hydrate: MyWorkHydrate,
	usesBoundedSourceQueries: boolean,
): MyWorkService["list"] {
	return async (input: MyWorkListInput): Promise<MyWorkListResponse> => {
		try {
			const workspaces = await source.listAuthorizedWorkspaces(input.userId);
			const workspaceIds = requestedWorkspaceIds(workspaces, input.workspaceId);
			if (workspaceIds.length === 0) {
				return { items: [], nextCursor: null };
			}

			const workspaceMap = new Map(
				workspaces.map((workspace) => [workspace.id, workspace]),
			);
			const pageLimit = boundedPageLimit(input.limit);
			const now = input.now ?? new Date();
			const queryInput = buildSourceQueryInput(
				input,
				workspaces,
				workspaceIds,
				pageLimit,
				now,
			);
			const { trackerRows, boardRows } = await loadSourceRows(
				source,
				input,
				queryInput,
			);
			const sourceHasMore =
				usesBoundedSourceQueries &&
				(trackerRows.length > pageLimit || boardRows.length > pageLimit);
			const candidates = filterCandidates(
				mergeMyWorkRows(trackerRows, boardRows),
				workspaceMap,
				input,
				queryInput,
			);
			const items = await hydrate(candidates, workspaceMap);
			return paginateMyWorkItems(items, {
				limit: pageLimit,
				cursor: input.cursor,
				now,
				hasMore: sourceHasMore,
			});
		} catch (error) {
			throw asUnavailable(error);
		}
	};
}
