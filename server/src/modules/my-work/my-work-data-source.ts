import { type DBExecutor, db } from "../../db/kysely.js";
import {
	getMyWorkBoardRow,
	getMyWorkTrackerRow,
} from "./my-work-data-source-detail.js";
import {
	listAuthorizedMyWorkspaces,
	listMyWorkBoardRows,
	listMyWorkTrackerRows,
} from "./my-work-data-source-list.js";
import type { MyWorkDataSource } from "./my-work-types.js";

/**
 * Default My Work data source. Every delegated query embeds membership,
 * assignment, soft-delete, and bounded pagination constraints.
 */
export function createMyWorkDataSource(
	executor: DBExecutor = db,
): MyWorkDataSource {
	return {
		listAuthorizedWorkspaces: (userId) =>
			listAuthorizedMyWorkspaces(executor, userId),
		listTrackerRows: (input) => listMyWorkTrackerRows(executor, input),
		listBoardRows: (input) => listMyWorkBoardRows(executor, input),
		getTrackerRow: (input) => getMyWorkTrackerRow(executor, input),
		getBoardRow: (input) => getMyWorkBoardRow(executor, input),
	};
}

export const createDefaultMyWorkDataSource = createMyWorkDataSource;
