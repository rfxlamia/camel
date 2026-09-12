import type { Selectable } from "kysely";
import type { AuthUser } from "../auth.js";
import { type DBExecutor, db } from "../db/kysely.js";
import type { Cards, TrackerItems } from "../db/types.js";
import type { MyWorkSource } from "../routes/my-work-types.js";
import { applyBoardCardStatusChange } from "./board-card-status-change.js";
import { resolveMyWorkDoneTarget } from "./my-work-done-target.js";
import { applyTrackerItemStatusChange } from "./tracker-item-status-change.js";

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

type BoardMarkDoneRow = Pick<
	Selectable<Cards>,
	"id" | "column_id" | "status_id" | "title" | "version"
>;
type TrackerMarkDoneRow = Pick<
	Selectable<TrackerItems>,
	"id" | "status_id" | "title" | "version"
>;
type Transaction = <T>(callback: (trx: DBExecutor) => Promise<T>) => Promise<T>;

type BoardStatusChange = typeof applyBoardCardStatusChange;
type TrackerStatusChange = typeof applyTrackerItemStatusChange;
type SourceChangeResult = Awaited<
	ReturnType<BoardStatusChange | TrackerStatusChange>
>;
type DoneTargetInputs = Parameters<typeof resolveMyWorkDoneTarget>[1];

export type MyWorkMarkDoneDeps = {
	executor?: DBExecutor;
	transaction?: Transaction;
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

async function assignmentExists(
	trx: DBExecutor,
	input: MyWorkMarkDoneInput,
	itemId: number,
): Promise<boolean> {
	const table =
		input.source === "board" ? "card_assignees" : "tracker_item_assignees";
	const itemColumn = input.source === "board" ? "card_id" : "tracker_item_id";
	const assignment = await trx
		.selectFrom(table)
		.select(itemColumn)
		.where(itemColumn, "=", itemId)
		.where("user_id", "=", input.userId)
		.forUpdate()
		.executeTakeFirst();
	return assignment != null;
}

type AuthorizedMarkDoneItem =
	| { source: "board"; item: BoardMarkDoneRow }
	| { source: "tracker"; item: TrackerMarkDoneRow };

async function readAuthorizedItem(
	trx: DBExecutor,
	input: MyWorkMarkDoneInput,
): Promise<AuthorizedMarkDoneItem | null> {
	if (input.source === "board") {
		const item = await trx
			.selectFrom("cards")
			.select(["id", "column_id", "status_id", "title", "version"])
			.where("workspace_id", "=", input.workspaceId)
			.where("key_number", "=", input.keyNumber)
			.where("deleted_at", "is", null)
			.forUpdate()
			.executeTakeFirst();
		if (!item || !(await assignmentExists(trx, input, item.id))) return null;
		return { source: "board", item };
	}

	const item = await trx
		.selectFrom("tracker_items")
		.select(["id", "status_id", "title", "version"])
		.where("workspace_id", "=", input.workspaceId)
		.where("key_number", "=", input.keyNumber)
		.where("deleted_at", "is", null)
		.forUpdate()
		.executeTakeFirst();
	if (!item || !(await assignmentExists(trx, input, item.id))) return null;
	return { source: "tracker", item };
}

async function loadDoneTargetInputs(
	trx: DBExecutor,
	workspaceId: number,
): Promise<DoneTargetInputs> {
	const [columns, statuses] = await Promise.all([
		trx
			.selectFrom("columns")
			.select([
				"id",
				"workspace_id as workspaceId",
				"board_id as boardId",
				"position",
				"is_done",
			])
			.where("workspace_id", "=", workspaceId)
			.orderBy("board_id", "asc")
			.orderBy("position", "asc")
			.orderBy("id", "asc")
			.forUpdate()
			.execute(),
		trx
			.selectFrom("tracker_vocabularies")
			.select(["id", "workspace_id as workspaceId", "kind", "slot", "position"])
			.where("workspace_id", "=", workspaceId)
			.where("kind", "=", "status")
			.where("slot", "=", "done")
			.orderBy("position", "asc")
			.orderBy("id", "asc")
			.forUpdate()
			.execute(),
	]);
	return { boardColumns: columns, statusVocabularies: statuses };
}

function sourceResult(
	source: MyWorkSource,
	itemId: number,
	itemTitle: string,
	result: SourceChangeResult,
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

type DoneCommandContext = {
	input: MyWorkMarkDoneInput;
} & Pick<
	Required<MyWorkMarkDoneDeps>,
	"boardStatusChange" | "trackerStatusChange"
>;

function unchangedResult(item: AuthorizedMarkDoneItem): MyWorkMarkDoneResult {
	const result = {
		kind: "ok" as const,
		source: item.source,
		itemId: item.item.id,
		itemTitle: item.item.title,
		changed: false,
	};
	return item.source === "board" ? { ...result, moved: false } : result;
}

async function markSourceDone(
	trx: DBExecutor,
	context: DoneCommandContext,
): Promise<MyWorkMarkDoneResult> {
	const { input } = context;
	const authorized = await readAuthorizedItem(trx, input);
	if (!authorized) return { kind: "not_found" };
	const target = resolveMyWorkDoneTarget(
		authorized.source === "board"
			? {
					source: "board",
					workspaceId: input.workspaceId,
					columnId: authorized.item.column_id,
				}
			: { source: "tracker", workspaceId: input.workspaceId },
		await loadDoneTargetInputs(trx, input.workspaceId),
	);
	if (!target.available) return { kind: "unmappable" };
	const alreadyDone =
		authorized.source === "board"
			? target.source === "board" &&
				authorized.item.column_id === target.columnId &&
				authorized.item.status_id === target.statusId
			: authorized.item.status_id === target.statusId;
	if (alreadyDone) return unchangedResult(authorized);
	const result =
		authorized.source === "board"
			? await context.boardStatusChange(trx, {
					workspaceId: input.workspaceId,
					actor: input.actor,
					cardId: authorized.item.id,
					targetStatusId: target.statusId,
					version: input.version,
				})
			: await context.trackerStatusChange(trx, {
					workspaceId: input.workspaceId,
					actor: input.actor,
					trackerItemId: authorized.item.id,
					targetStatusId: target.statusId,
					version: input.version,
				});
	return sourceResult(
		authorized.source,
		authorized.item.id,
		authorized.item.title,
		result,
	);
}

async function markDoneInTransaction(
	trx: DBExecutor,
	context: DoneCommandContext,
): Promise<MyWorkMarkDoneResult> {
	if (!(await membershipExists(trx, context.input))) {
		return { kind: "not_found" };
	}
	return markSourceDone(trx, context);
}

function createTransactionRunner(
	executor: DBExecutor,
	transaction?: Transaction,
): Transaction {
	if (transaction) return transaction;
	const factory = (executor as { transaction?: () => { execute: Transaction } })
		.transaction;
	if (factory) {
		return <T>(callback: (trx: DBExecutor) => Promise<T>) =>
			factory().execute(callback);
	}
	return <T>(callback: (trx: DBExecutor) => Promise<T>) => callback(executor);
}

/** Creates the authenticated, source-aware Mark done command. */
export function createMyWorkMarkDoneService(deps: MyWorkMarkDoneDeps = {}) {
	const executor = deps.executor ?? db;
	const runTransaction = createTransactionRunner(executor, deps.transaction);
	const context = {
		boardStatusChange: deps.boardStatusChange ?? applyBoardCardStatusChange,
		trackerStatusChange:
			deps.trackerStatusChange ?? applyTrackerItemStatusChange,
	};
	const markDone = (input: MyWorkMarkDoneInput) =>
		runTransaction((trx) => markDoneInTransaction(trx, { ...context, input }));
	return { markDone, markMyWorkDone: markDone };
}

export const createMyWorkMarkDoneCommand = createMyWorkMarkDoneService;
