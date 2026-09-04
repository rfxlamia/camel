import { sql } from "kysely";
import { db } from "../db/kysely.js";

export type FocusSessionRow = {
	id: number;
	user_id: number;
	workspace_id: number;
	task_source: "board" | "tracker";
	task_id: number;
	task_key: string | null;
	return_path: string;
	state: "ready" | "running" | "paused" | "finished";
	accumulated_seconds: number;
	running_since: Date | null;
	version: number;
	created_at: Date;
	updated_at: Date;
	finished_at: Date | null;
};

export type FocusSessionInsertInput = {
	user_id: number;
	workspace_id: number;
	task_source: "board" | "tracker";
	task_id: number;
	task_key: string | null;
	return_path: string;
	state: "ready";
	accumulated_seconds: number;
	running_since: null;
};

export type FocusSessionUpdatePatch = {
	state?: FocusSessionRow["state"];
	accumulated_seconds?: number;
	running_since?: Date | null;
	finished_at?: Date | null;
};

export type ResolvedTask = {
	id: number;
	keyNumber: number | null;
	title: string;
	workspaceName: string;
};

export type FocusSessionSwitchCreateInput = FocusSessionInsertInput & {
	id?: number;
};

export type FocusSessionRepo = {
	findActive(
		userId: number,
		workspaceId: number,
	): Promise<FocusSessionRow | null>;
	insert(input: FocusSessionInsertInput): Promise<FocusSessionRow>;
	update(
		id: number,
		patch: FocusSessionUpdatePatch,
		expectedVersion: number,
	): Promise<FocusSessionRow | null>;
	switchSession(
		finish: {
			id: number;
			patch: FocusSessionUpdatePatch;
			expectedVersion: number;
		},
		create: FocusSessionSwitchCreateInput,
	): Promise<{ finished: FocusSessionRow; created: FocusSessionRow } | null>;
	findTask(
		source: "board" | "tracker",
		taskId: number,
		workspaceId: number,
	): Promise<ResolvedTask | null>;
};

const FOCUS_SESSION_COLUMNS = [
	"id",
	"user_id",
	"workspace_id",
	"task_source",
	"task_id",
	"task_key",
	"return_path",
	"state",
	"accumulated_seconds",
	"running_since",
	"version",
	"created_at",
	"updated_at",
	"finished_at",
] as const;

function mapRow(row: Record<string, unknown>): FocusSessionRow {
	return {
		id: row.id as number,
		user_id: row.user_id as number,
		workspace_id: row.workspace_id as number,
		task_source: row.task_source as "board" | "tracker",
		task_id: row.task_id as number,
		task_key: row.task_key as string | null,
		return_path: row.return_path as string,
		state: row.state as FocusSessionRow["state"],
		accumulated_seconds: row.accumulated_seconds as number,
		running_since: row.running_since as Date | null,
		version: row.version as number,
		created_at: row.created_at as Date,
		updated_at: row.updated_at as Date,
		finished_at: row.finished_at as Date | null,
	};
}

export function createFocusSessionRepo(executor = db): FocusSessionRepo {
	return {
		async findActive(userId, workspaceId) {
			const row = await executor
				.selectFrom("focus_sessions")
				.select(FOCUS_SESSION_COLUMNS)
				.where("user_id", "=", userId)
				.where("workspace_id", "=", workspaceId)
				.where("state", "<>", "finished")
				.executeTakeFirst();
			return row ? mapRow(row) : null;
		},

		async insert(input) {
			const row = await executor
				.insertInto("focus_sessions")
				.values({
					user_id: input.user_id,
					workspace_id: input.workspace_id,
					task_source: input.task_source,
					task_id: input.task_id,
					task_key: input.task_key,
					return_path: input.return_path,
					state: input.state,
					accumulated_seconds: input.accumulated_seconds,
					running_since: input.running_since,
				})
				.returning(FOCUS_SESSION_COLUMNS)
				.executeTakeFirstOrThrow();
			return mapRow(row);
		},

		async update(id, patch, expectedVersion) {
			const row = await executor
				.updateTable("focus_sessions")
				.set({
					...patch,
					version: sql`version + 1`,
					updated_at: sql`now()`,
				})
				.where("id", "=", id)
				.where("version", "=", expectedVersion)
				.returning(FOCUS_SESSION_COLUMNS)
				.executeTakeFirst();
			return row ? mapRow(row) : null;
		},

		async switchSession(finish, create) {
			return executor.transaction().execute(async (trx) => {
				const finished = await trx
					.updateTable("focus_sessions")
					.set({
						...finish.patch,
						version: sql`version + 1`,
						updated_at: sql`now()`,
					})
					.where("id", "=", finish.id)
					.where("version", "=", finish.expectedVersion)
					.returning(FOCUS_SESSION_COLUMNS)
					.executeTakeFirst();

				if (!finished) {
					return null;
				}

				const created = await trx
					.insertInto("focus_sessions")
					.values({
						...(create.id !== undefined ? { id: create.id } : {}),
						user_id: create.user_id,
						workspace_id: create.workspace_id,
						task_source: create.task_source,
						task_id: create.task_id,
						task_key: create.task_key,
						return_path: create.return_path,
						state: create.state,
						accumulated_seconds: create.accumulated_seconds,
						running_since: create.running_since,
					})
					.returning(FOCUS_SESSION_COLUMNS)
					.executeTakeFirstOrThrow();

				return {
					finished: mapRow(finished),
					created: mapRow(created),
				};
			});
		},

		async findTask(source, taskId, workspaceId) {
			if (source === "board") {
				const row = await executor
					.selectFrom("cards")
					.innerJoin("workspaces", "workspaces.id", "cards.workspace_id")
					.select([
						"cards.id",
						"cards.key_number",
						"cards.title",
						"workspaces.name as workspace_name",
					])
					.where("cards.id", "=", taskId)
					.where("cards.workspace_id", "=", workspaceId)
					.where("cards.deleted_at", "is", null)
					.executeTakeFirst();
				if (!row) return null;
				return {
					id: row.id,
					keyNumber: row.key_number,
					title: row.title,
					workspaceName: row.workspace_name,
				};
			}

			const row = await executor
				.selectFrom("tracker_items")
				.innerJoin("workspaces", "workspaces.id", "tracker_items.workspace_id")
				.select([
					"tracker_items.id",
					"tracker_items.key_number",
					"tracker_items.title",
					"workspaces.name as workspace_name",
				])
				.where("tracker_items.id", "=", taskId)
				.where("tracker_items.workspace_id", "=", workspaceId)
				.where("tracker_items.deleted_at", "is", null)
				.executeTakeFirst();
			if (!row) return null;
			return {
				id: row.id,
				keyNumber: row.key_number,
				title: row.title,
				workspaceName: row.workspace_name,
			};
		},
	};
}
