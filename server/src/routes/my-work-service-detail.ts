import {
	asUnavailable,
	type MyWorkHydrate,
} from "./my-work-service-support.js";
import type {
	MyWorkBoardRow,
	MyWorkCandidate,
	MyWorkDataSource,
	MyWorkDetailInput,
	MyWorkDetailQueryInput,
	MyWorkSerializedItem,
	MyWorkService,
	MyWorkTrackerRow,
} from "./my-work-types.js";

function readDetailRow(
	source: MyWorkDataSource,
	input: MyWorkDetailQueryInput,
	kind: "board" | "tracker",
): Promise<MyWorkBoardRow | MyWorkTrackerRow | null> {
	return kind === "tracker"
		? source.getTrackerRow(input)
		: source.getBoardRow(input);
}

function detailRowMatches(
	row: MyWorkBoardRow | MyWorkTrackerRow | null,
	workspaceId: number,
	userId: number,
): row is MyWorkBoardRow | MyWorkTrackerRow {
	return (
		row !== null &&
		row.workspace_id === workspaceId &&
		(row.assignees === undefined ||
			row.assignees.some((assignee) => assignee.id === userId))
	);
}

function detailCandidate(
	input: MyWorkDetailInput,
	row: MyWorkBoardRow | MyWorkTrackerRow,
): MyWorkCandidate {
	return input.source === "tracker"
		? { source: "tracker", row: row as MyWorkTrackerRow }
		: { source: "board", row: row as MyWorkBoardRow };
}

export function createMyWorkDetail(
	source: MyWorkDataSource,
	hydrate: MyWorkHydrate,
): MyWorkService["getDetail"] {
	return async (
		input: MyWorkDetailInput,
	): Promise<MyWorkSerializedItem | null> => {
		try {
			const workspaces = await source.listAuthorizedWorkspaces(input.userId);
			const workspace = workspaces.find(
				(candidate) => candidate.id === input.workspaceId,
			);
			if (!workspace) return null;

			const detailInput: MyWorkDetailQueryInput = {
				userId: input.userId,
				workspaceId: input.workspaceId,
				key: input.key,
				keyNumber: input.keyNumber,
			};
			const initialRow = await readDetailRow(source, detailInput, input.source);
			if (!detailRowMatches(initialRow, workspace.id, input.userId))
				return null;

			// Re-read membership after the source read to close the stale detail
			// window for injected repositories and revoked memberships.
			const currentWorkspaces = await source.listAuthorizedWorkspaces(
				input.userId,
			);
			const currentWorkspace = currentWorkspaces.find(
				(candidate) => candidate.id === input.workspaceId,
			);
			if (!currentWorkspace) return null;

			// Assignment is a separate authorization boundary. Re-read the source
			// row immediately before hydration so revoked assignments fail closed.
			const currentRow = await readDetailRow(source, detailInput, input.source);
			if (!detailRowMatches(currentRow, currentWorkspace.id, input.userId)) {
				return null;
			}

			const candidate = detailCandidate(input, currentRow);
			const hydrated = await hydrate(
				[candidate],
				new Map([[currentWorkspace.id, currentWorkspace]]),
			);
			return hydrated[0] ?? null;
		} catch (error) {
			throw asUnavailable(error);
		}
	};
}
