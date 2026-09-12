import type { AuthUser } from "../auth.js";
import { type DBExecutor, db } from "../db/kysely.js";
import type { MyWorkSource } from "../routes/my-work-types.js";
import {
	applyBoardCardStatusChange,
	type BoardCardStatusChangeResult,
} from "./board-card-status-change.js";
import {
	type MyWorkDoneBoardColumn,
	type MyWorkDoneStatusVocabulary,
	resolveMyWorkDoneTarget,
} from "./my-work-done-target.js";
import {
	applyTrackerItemStatusChange,
	type TrackerItemStatusChangeResult,
} from "./tracker-item-status-change.js";

export type MyWorkMarkDoneInput = {
	userId: number;
	actor: AuthUser;
	workspaceId: number;
	source: MyWorkSource;
	keyNumber: number;
	version?: number;
};

export type MyWorkMarkDoneResult =
	| { kind: "not_found" }
	| { kind: "conflict" }
	| { kind: "unmappable" }
	| { kind: "invalid_status" }
	| { kind: "wip"; reason?: string }
	| {
			kind: "ok";
			source: MyWorkSource;
			itemId: number;
			changed: boolean;
			moved?: boolean;
			itemTitle: string;
			addedSignableAssignee?: number;
	  };

type BoardMarkDoneRow = {
	id: number;
	key_number: number | null;
	column_id: number;
	status_id: number | null;
	title: string;
	version: number;
};

type TrackerMarkDoneRow = {
	id: number;
	key_number: number;
	status_id: number;
	title: string;
	version: number;
};

type BoardStatusChange = (
	trx: DBExecutor,
	params: Parameters<typeof applyBoardCardStatusChange>[1],
) => Promise<BoardCardStatusChangeResult>;

type TrackerStatusChange = (
	trx: DBExecutor,
	params: Parameters<typeof applyTrackerItemStatusChange>[1],
) => Promise<TrackerItemStatusChangeResult>;

export type MyWorkMarkDoneDeps = {
	executor?: DBExecutor;
	/** Override the root transaction seam in unit tests. */
	transaction?: <T>(callback: (trx: DBExecutor) => Promise<T>) => Promise<T>;
	/** Source-specific primitives remain injectable without changing routing. */
	boardStatusChange?: BoardStatusChange;
	trackerStatusChange?: TrackerStatusChange;
};

async function membershipExists(
	trx: DBExecutor,
	input: MyWorkMarkDoneInput,
): Promise<boolean> {
	const membership = await trx
		.selectFrom("workspace_members")
		.select("user_id")
		.where("workspace_id", "=", input.workspaceId)
		.where("user_id", "=", input.userId)
		.forUpdate()
		.executeTakeFirst();
	return membership != null;
}

async function boardAssignmentExists(
	trx: DBExecutor,
	input: MyWorkMarkDoneInput,
	cardId: number,
): Promise<boolean> {
	const assignment = await trx
		.selectFrom("card_assignees")
		.select("card_id")
		.where("card_id", "=", cardId)
		.where("user_id", "=", input.userId)
		.forUpdate()
		.executeTakeFirst();
	return assignment != null;
}

async function trackerAssignmentExists(
	trx: DBExecutor,
	input: MyWorkMarkDoneInput,
	trackerItemId: number,
): Promise<boolean> {
	const assignment = await trx
		.selectFrom("tracker_item_assignees")
		.select("tracker_item_id")
		.where("tracker_item_id", "=", trackerItemId)
		.where("user_id", "=", input.userId)
		.forUpdate()
		.executeTakeFirst();
	return assignment != null;
}

async function readAuthorizedBoardItem(
	trx: DBExecutor,
	input: MyWorkMarkDoneInput,
): Promise<BoardMarkDoneRow | null> {
	const item = await trx
		.selectFrom("cards")
		.select(["id", "key_number", "column_id", "status_id", "title", "version"])
		.where("workspace_id", "=", input.workspaceId)
		.where("key_number", "=", input.keyNumber)
		.where("deleted_at", "is", null)
		.forUpdate()
		.executeTakeFirst();
	if (!item) return null;
	if (!(await boardAssignmentExists(trx, input, item.id))) return null;
	return item;
}

async function readAuthorizedTrackerItem(
	trx: DBExecutor,
	input: MyWorkMarkDoneInput,
): Promise<TrackerMarkDoneRow | null> {
	const item = await trx
		.selectFrom("tracker_items")
		.select(["id", "key_number", "status_id", "title", "version"])
		.where("workspace_id", "=", input.workspaceId)
		.where("key_number", "=", input.keyNumber)
		.where("deleted_at", "is", null)
		.forUpdate()
		.executeTakeFirst();
	if (!item) return null;
	if (!(await trackerAssignmentExists(trx, input, item.id))) return null;
	return item;
}

async function loadDoneTargetInputs(
	trx: DBExecutor,
	workspaceId: number,
): Promise<{
	boardColumns: MyWorkDoneBoardColumn[];
	statusVocabularies: MyWorkDoneStatusVocabulary[];
}> {
	const [columns, statuses] = await Promise.all([
		trx
			.selectFrom("columns")
			.select(["id", "workspace_id", "board_id", "position", "is_done"])
			.where("workspace_id", "=", workspaceId)
			.orderBy("board_id", "asc")
			.orderBy("position", "asc")
			.orderBy("id", "asc")
			.forUpdate()
			.execute(),
		trx
			.selectFrom("tracker_vocabularies")
			.select(["id", "workspace_id", "kind", "slot", "position"])
			.where("workspace_id", "=", workspaceId)
			.where("kind", "=", "status")
			.where("slot", "=", "done")
			.orderBy("position", "asc")
			.orderBy("id", "asc")
			.forUpdate()
			.execute(),
	]);
	return {
		boardColumns: columns.map((column) => ({
			id: column.id,
			workspaceId: column.workspace_id,
			boardId: column.board_id,
			position: column.position,
			is_done: column.is_done,
		})),
		statusVocabularies: statuses.map((status) => ({
			id: status.id,
			workspaceId: status.workspace_id,
			kind: status.kind,
			slot: status.slot,
			position: status.position,
		})),
	};
}

function sourceResult(
	source: MyWorkSource,
	itemId: number,
	itemTitle: string,
	result: BoardCardStatusChangeResult | TrackerItemStatusChangeResult,
): MyWorkMarkDoneResult {
	if (result.kind === "not_found") return { kind: "not_found" };
	if (result.kind === "conflict") return { kind: "conflict" };
	if (result.kind === "unmappable" || result.kind === "invalid_status") {
		return { kind: "unmappable" };
	}
	if (result.kind === "wip") return result;
	if (result.kind !== "ok") return { kind: "invalid_status" };
	if (source === "board" && "moved" in result) {
		return {
			kind: "ok",
			source,
			itemId,
			itemTitle: result.cardTitle,
			changed: true,
			moved: result.moved,
			addedSignableAssignee: result.addedSignableAssignee,
		};
	}
	return {
		kind: "ok",
		source,
		itemId,
		itemTitle: "itemTitle" in result ? result.itemTitle : itemTitle,
		changed: true,
	};
}

/**
 * Creates the authenticated, source-aware Mark done command.
 *
 * Authorization, canonical target resolution, and the source mutation all run
 * inside one transaction. The command never writes the other physical source.
 */
export function createMyWorkMarkDoneService(deps: MyWorkMarkDoneDeps = {}) {
	const executor = deps.executor ?? db;
	const boardStatusChange =
		deps.boardStatusChange ?? applyBoardCardStatusChange;
	const trackerStatusChange =
		deps.trackerStatusChange ?? applyTrackerItemStatusChange;
	const executorWithTransaction = executor as {
		transaction?: () => {
			execute: <T>(callback: (trx: DBExecutor) => Promise<T>) => Promise<T>;
		};
	};
	const runTransaction =
		deps.transaction ??
		(typeof executorWithTransaction.transaction === "function"
			? async <T>(callback: (trx: DBExecutor) => Promise<T>): Promise<T> =>
					executorWithTransaction.transaction!().execute(callback)
			: async <T>(callback: (trx: DBExecutor) => Promise<T>): Promise<T> =>
					callback(executor));

	const markDone = async (
		input: MyWorkMarkDoneInput,
	): Promise<MyWorkMarkDoneResult> =>
		runTransaction(async (trx) => {
			if (!(await membershipExists(trx, input))) {
				return { kind: "not_found" };
			}

			if (input.source === "board") {
				const item = await readAuthorizedBoardItem(trx, input);
				if (!item) return { kind: "not_found" };
				const targetInputs = await loadDoneTargetInputs(trx, input.workspaceId);
				const target = resolveMyWorkDoneTarget(
					{
						source: "board",
						workspaceId: input.workspaceId,
						columnId: item.column_id,
					},
					targetInputs,
				);
				if (!target.available) return { kind: "unmappable" };
				if (
					target.source === "board" &&
					item.column_id === target.columnId &&
					item.status_id === target.statusId
				) {
					return {
						kind: "ok",
						source: "board",
						itemId: item.id,
						itemTitle: item.title,
						changed: false,
						moved: false,
					};
				}
				const result = await boardStatusChange(trx, {
					workspaceId: input.workspaceId,
					actor: input.actor,
					cardId: item.id,
					targetStatusId: target.statusId,
					version: input.version,
				});
				return sourceResult("board", item.id, item.title, result);
			}

			const item = await readAuthorizedTrackerItem(trx, input);
			if (!item) return { kind: "not_found" };
			const targetInputs = await loadDoneTargetInputs(trx, input.workspaceId);
			const target = resolveMyWorkDoneTarget(
				{ source: "tracker", workspaceId: input.workspaceId },
				targetInputs,
			);
			if (!target.available) return { kind: "unmappable" };
			if (item.status_id === target.statusId) {
				return {
					kind: "ok",
					source: "tracker",
					itemId: item.id,
					itemTitle: item.title,
					changed: false,
				};
			}
			const result = await trackerStatusChange(trx, {
				workspaceId: input.workspaceId,
				actor: input.actor,
				trackerItemId: item.id,
				targetStatusId: target.statusId,
				version: input.version,
			});
			return sourceResult("tracker", item.id, item.title, result);
		});

	return {
		markDone,
		markMyWorkDone: markDone,
	};
}

export const createMyWorkMarkDoneCommand = createMyWorkMarkDoneService;
