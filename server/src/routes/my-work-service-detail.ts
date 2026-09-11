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
	MyWorkWorkspace,
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

async function findAuthorizedWorkspace(
	source: MyWorkDataSource,
	userId: number,
	workspaceId: number,
): Promise<MyWorkWorkspace | null> {
	const workspaces = await source.listAuthorizedWorkspaces(userId);
	return workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

function detailQueryInput(input: MyWorkDetailInput): MyWorkDetailQueryInput {
	return {
		userId: input.userId,
		workspaceId: input.workspaceId,
		key: input.key,
		keyNumber: input.keyNumber,
	};
}

async function readAuthorizedDetailRow(
	source: MyWorkDataSource,
	input: MyWorkDetailQueryInput,
	kind: "board" | "tracker",
): Promise<MyWorkBoardRow | MyWorkTrackerRow | null> {
	const row = await readDetailRow(source, input, kind);
	return detailRowMatches(row, input.workspaceId, input.userId) ? row : null;
}

function detailCandidate(
	input: MyWorkDetailInput,
	row: MyWorkBoardRow | MyWorkTrackerRow,
): MyWorkCandidate {
	return input.source === "tracker"
		? { source: "tracker", row: row as MyWorkTrackerRow }
		: { source: "board", row: row as MyWorkBoardRow };
}

async function hydrateDetail(
	hydrate: MyWorkHydrate,
	input: MyWorkDetailInput,
	workspace: MyWorkWorkspace,
	row: MyWorkBoardRow | MyWorkTrackerRow,
): Promise<MyWorkSerializedItem | null> {
	const hydrated = await hydrate(
		[detailCandidate(input, row)],
		new Map([[workspace.id, workspace]]),
	);
	return hydrated[0] ?? null;
}

export function createMyWorkDetail(
	source: MyWorkDataSource,
	hydrate: MyWorkHydrate,
): MyWorkService["getDetail"] {
	return async (
		input: MyWorkDetailInput,
	): Promise<MyWorkSerializedItem | null> => {
		try {
			const initialWorkspace = await findAuthorizedWorkspace(
				source,
				input.userId,
				input.workspaceId,
			);
			if (!initialWorkspace) return null;
			const queryInput = detailQueryInput(input);
			const initialRow = await readAuthorizedDetailRow(
				source,
				queryInput,
				input.source,
			);
			if (!initialRow) return null;

			const currentWorkspace = await findAuthorizedWorkspace(
				source,
				input.userId,
				input.workspaceId,
			);
			if (!currentWorkspace) return null;
			const currentRow = await readAuthorizedDetailRow(
				source,
				queryInput,
				input.source,
			);
			if (!currentRow) return null;
			return hydrateDetail(hydrate, input, currentWorkspace, currentRow);
		} catch (error) {
			throw asUnavailable(error);
		}
	};
}
