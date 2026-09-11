import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { sql } from "kysely";
import { derivePrefix, parseKeyFromUrl } from "../core/tracker-key.js";
import { type DBExecutor, db } from "../db/kysely.js";
import {
	decodeMyWorkCursor,
	hydrateMyWorkRows,
	isTerminalMyWorkStatus,
	type MyWorkBoardRow,
	type MyWorkCandidate,
	type MyWorkCursor,
	type MyWorkSerializedItem,
	type MyWorkSource,
	type MyWorkTrackerRow,
	type MyWorkWorkspace,
	mergeMyWorkRows,
	paginateMyWorkItems,
} from "./my-work-response.js";
import {
	selectBoardWorkItemRows,
	selectTrackerItemRows,
} from "./work-item-response.js";

export type MyWorkScope = "active" | "all";

export type MyWorkListInput = {
	userId: number;
	scope: MyWorkScope;
	q?: string;
	workspaceId?: number;
	source?: MyWorkSource;
	cursor?: string | null;
	limit?: number;
	now?: Date;
};

export type MyWorkDetailInput = {
	userId: number;
	workspaceId: number;
	source: MyWorkSource;
	key: string;
	keyNumber: number;
};

export type MyWorkSourceQueryInput = {
	userId: number;
	workspaceIds: readonly number[];
	workspaceId?: number;
	q: string;
	scope: MyWorkScope;
	/** Cursor and page size are applied by each set-based source query. */
	cursor?: MyWorkCursor | null;
	limit?: number;
	now?: Date;
	/** Used to keep canonical workspace keys inside the SQL search boundary. */
	workspacePrefixes?: ReadonlyMap<number, string>;
	/** Local calendar dates used by the overdue ordering expression. */
	workspaceLocalDates?: ReadonlyMap<number, string>;
};

export type MyWorkDetailQueryInput = {
	userId: number;
	workspaceId: number;
	key: string;
	keyNumber: number;
};

export type MyWorkDataSource = {
	listAuthorizedWorkspaces: (userId: number) => Promise<MyWorkWorkspace[]>;
	listTrackerRows: (
		input: MyWorkSourceQueryInput,
	) => Promise<MyWorkTrackerRow[]>;
	listBoardRows: (input: MyWorkSourceQueryInput) => Promise<MyWorkBoardRow[]>;
	getTrackerRow: (
		input: MyWorkDetailQueryInput,
	) => Promise<MyWorkTrackerRow | null>;
	getBoardRow: (
		input: MyWorkDetailQueryInput,
	) => Promise<MyWorkBoardRow | null>;
};

export type MyWorkServiceDeps = Partial<MyWorkDataSource> & {
	executor?: DBExecutor;
	hydrateRows?: (
		candidates: readonly MyWorkCandidate[],
		workspaces: ReadonlyMap<number, MyWorkWorkspace>,
	) => Promise<MyWorkSerializedItem[]>;
};

export type MyWorkService = {
	list: (input: MyWorkListInput) => Promise<MyWorkListResponse>;
	listMyWork: (input: MyWorkListInput) => Promise<MyWorkListResponse>;
	getDetail: (input: MyWorkDetailInput) => Promise<MyWorkSerializedItem | null>;
	getMyWorkItem: (
		input: MyWorkDetailInput,
	) => Promise<MyWorkSerializedItem | null>;
};

export type MyWorkListResponse = {
	items: MyWorkSerializedItem[];
	nextCursor: string | null;
};

export class MyWorkUnavailableError extends Error {
	readonly statusCode = 503;
	readonly code = "my_work_unavailable";
	readonly retryable = true;

	constructor(cause?: unknown) {
		super("Unable to load My Work", { cause });
		this.name = "MyWorkUnavailableError";
	}
}

function isDbExecutor(value: unknown): value is DBExecutor {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { selectFrom?: unknown }).selectFrom === "function"
	);
}

function buildSearchPattern(q: string): string {
	return `%${q}%`;
}

/** Extracts the numeric suffix from either `17` or a canonical `AT-17` key. */
function keyNumberInSearch(q: string): string | null {
	const match = /(?:^|[-\s])(\d+)$/.exec(q.trim());
	return match?.[1] ?? null;
}

function canonicalKeyInSearch(
	q: string,
): { prefix: string; keyNumber: number } | null {
	return parseKeyFromUrl(q.trim().toUpperCase());
}

function boundedPageLimit(value: number | undefined): number {
	return Math.max(1, Math.min(50, Math.trunc(value ?? 50)));
}

function sourceQueryLimit(input: MyWorkSourceQueryInput): number {
	// Fetch one sentinel row per source. The service uses it to preserve a
	// next cursor without hydrating an unbounded history set.
	return Math.min(51, boundedPageLimit(input.limit) + 1);
}

function localDateForTimezone(now: Date, timezone: string | null): string {
	const resolvedTimezone = timezone || "UTC";
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: resolvedTimezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).formatToParts(now);
		const year = parts.find((part) => part.type === "year")?.value ?? "1970";
		const month = parts.find((part) => part.type === "month")?.value ?? "01";
		const day = parts.find((part) => part.type === "day")?.value ?? "01";
		return `${year}-${month}-${day}`;
	} catch {
		return now.toISOString().slice(0, 10);
	}
}

function sourceAlias(source: MyWorkSource): "ti" | "c" {
	return source === "tracker" ? "ti" : "c";
}

function statusGroupExpression() {
	// Keep this CASE in lockstep with normalizeMyWorkStatusCategory. A
	// recognized category wins over a slot; unknown values then fall back to
	// the existing slot vocabulary and finally to Other (4).
	return sql<number>`CASE
		WHEN st.category = 'backlog' THEN 0
		WHEN st.category = 'started' THEN 1
		WHEN st.category = 'completed' THEN 2
		WHEN st.category = 'canceled' THEN 3
		WHEN st.slot IN ('backlog', 'todo') THEN 0
		WHEN st.slot = 'in_progress' THEN 1
		WHEN st.slot = 'done' THEN 2
		WHEN st.slot = 'canceled' THEN 3
		ELSE 4
	END`;
}

function localDateExpression(
	source: MyWorkSource,
	input: MyWorkSourceQueryInput,
) {
	const alias = sourceAlias(source);
	const dates = [...(input.workspaceLocalDates ?? new Map())].filter(([id]) =>
		input.workspaceIds.includes(id),
	);
	if (dates.length === 0) return sql<string>`CURRENT_DATE`;

	const branches = dates.map(
		([workspaceId, date]) =>
			sql`WHEN ${sql.ref(`${alias}.workspace_id`)} = ${workspaceId} THEN ${sql.val(date)}::date`,
	);
	return sql<string>`CASE ${sql.join(branches, sql` `)} ELSE CURRENT_DATE END`;
}

function sourceOrderExpressions(
	source: MyWorkSource,
	input: MyWorkSourceQueryInput,
) {
	const alias = sourceAlias(source);
	const group = statusGroupExpression();
	const dueDate =
		source === "tracker"
			? sql<string | null>`ti.end_date::date`
			: sql<string | null>`c.due_date::date`;
	const updatedAt =
		source === "tracker"
			? sql<Date>`ti.updated_at`
			: sql<Date>`coalesce(c.done_at, c.started_at, c.created_at)`;
	const overdueRank = sql<number>`CASE
		WHEN ${group} < 2
			AND ${dueDate} IS NOT NULL
			AND ${dueDate} < ${localDateExpression(source, input)}
		THEN 0
		ELSE 1
	END`;
	const dueNullRank = sql<number>`CASE WHEN ${dueDate} IS NULL THEN 1 ELSE 0 END`;

	return {
		group,
		overdueRank,
		dueDate,
		dueNullRank,
		updatedAt,
		workspaceId: sql<number>`${sql.ref(`${alias}.workspace_id`)}`,
		keyNumber: sql<number>`${sql.ref(`${alias}.key_number`)}`,
		id: sql<number>`${sql.ref(`${alias}.id`)}`,
	};
}

function andSql(parts: readonly import("kysely").RawBuilder<unknown>[]) {
	return sql<boolean>`(${sql.join(parts, sql` AND `)})`;
}

function sourceCursorPredicate(
	source: MyWorkSource,
	cursor: MyWorkCursor | null | undefined,
	expressions: ReturnType<typeof sourceOrderExpressions>,
): import("kysely").RawBuilder<boolean> | null {
	if (!cursor) return null;
	const keyNumber = Number(cursor.key.slice(cursor.key.lastIndexOf("-") + 1));
	if (!Number.isSafeInteger(keyNumber)) return null;

	const sourceRank = source === "board" ? 0 : 1;
	const cursorSourceRank = cursor.source === "board" ? 0 : 1;
	const cursorOverdueRank = cursor.overdue ? 0 : 1;
	const cursorDueNullRank = cursor.dueDate === null ? 1 : 0;
	const prefix: import("kysely").RawBuilder<unknown>[] = [];
	const terms: import("kysely").RawBuilder<unknown>[] = [];

	terms.push(andSql([...prefix, sql`${expressions.group} > ${cursor.group}`]));
	prefix.push(sql`${expressions.group} = ${cursor.group}`);

	terms.push(
		andSql([...prefix, sql`${expressions.overdueRank} > ${cursorOverdueRank}`]),
	);
	prefix.push(sql`${expressions.overdueRank} = ${cursorOverdueRank}`);

	terms.push(
		andSql([...prefix, sql`${expressions.dueNullRank} > ${cursorDueNullRank}`]),
	);
	prefix.push(sql`${expressions.dueNullRank} = ${cursorDueNullRank}`);

	if (cursor.dueDate === null) {
		prefix.push(sql`${expressions.dueDate} IS NULL`);
	} else {
		terms.push(
			andSql([...prefix, sql`${expressions.dueDate} > ${cursor.dueDate}`]),
		);
		prefix.push(sql`${expressions.dueDate} = ${cursor.dueDate}`);
	}

	terms.push(
		andSql([...prefix, sql`${expressions.updatedAt} < ${cursor.updatedAt}`]),
	);
	prefix.push(sql`${expressions.updatedAt} = ${cursor.updatedAt}`);

	terms.push(
		andSql([
			...prefix,
			sql`${expressions.workspaceId} > ${cursor.workspaceId}`,
		]),
	);
	prefix.push(sql`${expressions.workspaceId} = ${cursor.workspaceId}`);

	if (sourceRank > cursorSourceRank) {
		terms.push(andSql([...prefix, sql`true`]));
	} else if (sourceRank === cursorSourceRank) {
		terms.push(
			andSql([...prefix, sql`${expressions.keyNumber} > ${keyNumber}`]),
		);
		prefix.push(sql`${expressions.keyNumber} = ${keyNumber}`);
		terms.push(andSql([...prefix, sql`${expressions.id} > ${cursor.id}`]));
	}

	return sql<boolean>`(${sql.join(terms, sql` OR `)})`;
}

function canonicalWorkspaceIds(
	input: MyWorkSourceQueryInput,
	canonicalKey: { prefix: string; keyNumber: number },
): number[] {
	return [...(input.workspacePrefixes ?? new Map())]
		.filter(
			([workspaceId, prefix]) =>
				input.workspaceIds.includes(workspaceId) &&
				prefix.toUpperCase() === canonicalKey.prefix,
		)
		.map(([workspaceId]) => workspaceId);
}

function sourceSearchPredicate(
	source: MyWorkSource,
	input: MyWorkSourceQueryInput,
	pattern: string,
	keyNumber: string | null,
) {
	const alias = sourceAlias(source);
	const canonicalKey = canonicalKeyInSearch(input.q);
	const textPredicates = [
		sql<boolean>`${sql.ref(`${alias}.title`)} ILIKE ${pattern}`,
		sql<boolean>`${sql.ref(`${alias}.description`)} ILIKE ${pattern}`,
	];

	if (canonicalKey) {
		const workspaceIds = canonicalWorkspaceIds(input, canonicalKey);
		const keyPredicate =
			workspaceIds.length > 0
				? sql<boolean>`${sql.ref(`${alias}.key_number`)} = ${canonicalKey.keyNumber}
					AND ${sql.ref(`${alias}.workspace_id`)} IN (${sql.join(
						workspaceIds.map((id) => sql.val(id)),
						sql`, `,
					)})`
				: input.workspacePrefixes !== undefined
					? sql<boolean>`false`
					: sql<boolean>`${sql.ref(`${alias}.key_number`)} = ${canonicalKey.keyNumber}`;
		return sql<boolean>`(${sql.join([...textPredicates, keyPredicate], sql` OR `)})`;
	}

	const keyPredicates: import("kysely").RawBuilder<unknown>[] = [
		...textPredicates,
		sql<boolean>`${sql.ref(`${alias}.key_number`)}::text ILIKE ${pattern}`,
	];
	if (keyNumber) {
		keyPredicates.push(
			sql<boolean>`${sql.ref(`${alias}.key_number`)}::text = ${keyNumber}`,
		);
	}
	return sql<boolean>`(${sql.join(keyPredicates, sql` OR `)})`;
}

/** Default set-based source queries. Membership and assignee predicates are
 * part of the source query, not a post-serialization client filter. */
export function createMyWorkDataSource(
	executor: DBExecutor = db,
): MyWorkDataSource {
	return {
		async listAuthorizedWorkspaces(userId) {
			const rows = await executor
				.selectFrom("workspace_members as wm")
				.innerJoin("workspaces as w", "w.id", "wm.workspace_id")
				.leftJoin("workspace_settings as ws", "ws.workspace_id", "w.id")
				.select(["w.id", "w.name", "ws.timezone"])
				.where("wm.user_id", "=", userId)
				.orderBy("w.id", "asc")
				.execute();
			return rows.map((row) => ({
				id: row.id,
				name: row.name,
				timezone: row.timezone ?? null,
			}));
		},

		async listTrackerRows(input) {
			const order = sourceOrderExpressions("tracker", input);
			let query = selectTrackerItemRows(executor)
				.select("ti.workspace_id")
				.where("ti.workspace_id", "in", [...input.workspaceIds])
				.where("ti.deleted_at", "is", null)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("workspace_members as auth_wm")
							.select("auth_wm.workspace_id")
							.whereRef("auth_wm.workspace_id", "=", "ti.workspace_id")
							.where("auth_wm.user_id", "=", input.userId),
					),
				)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("tracker_item_assignees as me_tia")
							.select("me_tia.tracker_item_id")
							.whereRef("me_tia.tracker_item_id", "=", "ti.id")
							.where("me_tia.user_id", "=", input.userId),
					),
				);

			if (input.workspaceId !== undefined) {
				query = query.where("ti.workspace_id", "=", input.workspaceId);
			}
			if (input.scope === "active") {
				query = query.where(sql<boolean>`${order.group} NOT IN (2, 3)`);
			}
			if (input.q) {
				query = query.where(
					sourceSearchPredicate(
						"tracker",
						input,
						buildSearchPattern(input.q),
						keyNumberInSearch(input.q),
					),
				);
			}
			const cursorPredicate = sourceCursorPredicate(
				"tracker",
				input.cursor,
				order,
			);
			if (cursorPredicate) query = query.where(cursorPredicate);

			const rows = await query
				.orderBy(order.group, "asc")
				.orderBy(order.overdueRank, "asc")
				.orderBy(order.dueNullRank, "asc")
				.orderBy(order.dueDate, "asc")
				.orderBy(order.updatedAt, "desc")
				.orderBy(order.workspaceId, "asc")
				.orderBy(order.keyNumber, "asc")
				.orderBy(order.id, "asc")
				.limit(sourceQueryLimit(input))
				.execute();
			return rows as MyWorkTrackerRow[];
		},

		async listBoardRows(input) {
			const order = sourceOrderExpressions("board", input);
			let query = selectBoardWorkItemRows(executor)
				.select("c.workspace_id")
				.where("c.workspace_id", "in", [...input.workspaceIds])
				.where("c.deleted_at", "is", null)
				.where("c.key_number", "is not", null)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("workspace_members as auth_wm")
							.select("auth_wm.workspace_id")
							.whereRef("auth_wm.workspace_id", "=", "c.workspace_id")
							.where("auth_wm.user_id", "=", input.userId),
					),
				)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("card_assignees as me_ca")
							.select("me_ca.card_id")
							.whereRef("me_ca.card_id", "=", "c.id")
							.where("me_ca.user_id", "=", input.userId),
					),
				);

			if (input.workspaceId !== undefined) {
				query = query.where("c.workspace_id", "=", input.workspaceId);
			}
			if (input.scope === "active") {
				query = query.where(sql<boolean>`${order.group} NOT IN (2, 3)`);
			}
			if (input.q) {
				query = query.where(
					sourceSearchPredicate(
						"board",
						input,
						buildSearchPattern(input.q),
						keyNumberInSearch(input.q),
					),
				);
			}
			const cursorPredicate = sourceCursorPredicate(
				"board",
				input.cursor,
				order,
			);
			if (cursorPredicate) query = query.where(cursorPredicate);

			const rows = await query
				.orderBy(order.group, "asc")
				.orderBy(order.overdueRank, "asc")
				.orderBy(order.dueNullRank, "asc")
				.orderBy(order.dueDate, "asc")
				.orderBy(order.updatedAt, "desc")
				.orderBy(order.workspaceId, "asc")
				.orderBy(order.keyNumber, "asc")
				.orderBy(order.id, "asc")
				.limit(sourceQueryLimit(input))
				.execute();
			return rows as MyWorkBoardRow[];
		},

		async getTrackerRow(input) {
			const row = await selectTrackerItemRows(executor)
				.select("ti.workspace_id")
				.where("ti.workspace_id", "=", input.workspaceId)
				.where("ti.key_number", "=", input.keyNumber)
				.where("ti.deleted_at", "is", null)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("workspace_members as auth_wm")
							.select("auth_wm.workspace_id")
							.whereRef("auth_wm.workspace_id", "=", "ti.workspace_id")
							.where("auth_wm.user_id", "=", input.userId),
					),
				)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("tracker_item_assignees as me_tia")
							.select("me_tia.tracker_item_id")
							.whereRef("me_tia.tracker_item_id", "=", "ti.id")
							.where("me_tia.user_id", "=", input.userId),
					),
				)
				.executeTakeFirst();
			return (row as MyWorkTrackerRow | undefined) ?? null;
		},

		async getBoardRow(input) {
			const row = await selectBoardWorkItemRows(executor)
				.select("c.workspace_id")
				.where("c.workspace_id", "=", input.workspaceId)
				.where("c.key_number", "=", input.keyNumber)
				.where("c.deleted_at", "is", null)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("workspace_members as auth_wm")
							.select("auth_wm.workspace_id")
							.whereRef("auth_wm.workspace_id", "=", "c.workspace_id")
							.where("auth_wm.user_id", "=", input.userId),
					),
				)
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("card_assignees as me_ca")
							.select("me_ca.card_id")
							.whereRef("me_ca.card_id", "=", "c.id")
							.where("me_ca.user_id", "=", input.userId),
					),
				)
				.executeTakeFirst();
			return (row as MyWorkBoardRow | undefined) ?? null;
		},
	};
}

export const createDefaultMyWorkDataSource = createMyWorkDataSource;

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

function activeCandidate(candidate: MyWorkCandidate): boolean {
	return !isTerminalMyWorkStatus(
		candidate.row.status_category,
		candidate.row.status_slot,
	);
}

function asUnavailable(error: unknown): MyWorkUnavailableError {
	if (error instanceof MyWorkUnavailableError) return error;
	return new MyWorkUnavailableError(error);
}

export function createMyWorkService(
	options: MyWorkServiceDeps | DBExecutor = {},
): MyWorkService {
	const executor = isDbExecutor(options) ? options : (options.executor ?? db);
	const overrides = isDbExecutor(options) ? {} : options;
	const source: MyWorkDataSource = {
		...createMyWorkDataSource(executor),
		...overrides,
	};
	const usesBoundedSourceQueries =
		!isDbExecutor(options) &&
		options.listTrackerRows === undefined &&
		options.listBoardRows === undefined;
	const customHydrate = !isDbExecutor(options)
		? options.hydrateRows
		: undefined;
	const hydrate =
		customHydrate ??
		((
			candidates: readonly MyWorkCandidate[],
			workspaces: ReadonlyMap<number, MyWorkWorkspace>,
		) => hydrateMyWorkRows(executor, candidates, workspaces));

	const list = async (input: MyWorkListInput): Promise<MyWorkListResponse> => {
		try {
			const workspaces = await source.listAuthorizedWorkspaces(input.userId);
			const requestedWorkspaceIds =
				input.workspaceId === undefined
					? workspaces.map((workspace) => workspace.id)
					: workspaces.some((workspace) => workspace.id === input.workspaceId)
						? [input.workspaceId]
						: [];
			if (requestedWorkspaceIds.length === 0) {
				return { items: [], nextCursor: null };
			}
			const workspaceMap = new Map(
				workspaces.map((workspace) => [workspace.id, workspace]),
			);
			const pageLimit = boundedPageLimit(input.limit);
			const now = input.now ?? new Date();
			const queryInput: MyWorkSourceQueryInput = {
				userId: input.userId,
				workspaceIds: requestedWorkspaceIds,
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

			const [trackerRows, boardRows] = await Promise.all([
				input.source === "board"
					? Promise.resolve([] as MyWorkTrackerRow[])
					: source.listTrackerRows(queryInput),
				input.source === "tracker"
					? Promise.resolve([] as MyWorkBoardRow[])
					: source.listBoardRows(queryInput),
			]);
			const sourceHasMore =
				usesBoundedSourceQueries &&
				(trackerRows.length > pageLimit || boardRows.length > pageLimit);
			let candidates = mergeMyWorkRows(trackerRows, boardRows).filter(
				(candidate) =>
					workspaceMap.has(candidate.row.workspace_id) &&
					(candidate.row.assignees === undefined ||
						candidate.row.assignees.some(
							(assignee) => assignee.id === input.userId,
						)),
			);
			if (queryInput.scope === "active") {
				candidates = candidates.filter(activeCandidate);
			}
			if (queryInput.q) {
				candidates = candidates.filter((candidate) => {
					const workspace = workspaceMap.get(candidate.row.workspace_id);
					return (
						workspace !== undefined &&
						candidateMatchesQuery(candidate, workspace, queryInput.q)
					);
				});
			}
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

	const getDetail = async (
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
			const row =
				input.source === "tracker"
					? await source.getTrackerRow(detailInput)
					: await source.getBoardRow(detailInput);
			if (!row || row.workspace_id !== workspace.id) return null;
			if (
				row.assignees !== undefined &&
				!row.assignees.some((assignee) => assignee.id === input.userId)
			) {
				return null;
			}

			// Re-read membership after the source read. This closes the stale
			// detail window for injected repositories and prevents returning a
			// cached item after membership was revoked.
			const currentWorkspaces = await source.listAuthorizedWorkspaces(
				input.userId,
			);
			const currentWorkspace = currentWorkspaces.find(
				(candidate) => candidate.id === input.workspaceId,
			);
			if (!currentWorkspace) return null;

			// Assignment is a separate authorization boundary from membership.
			// Re-read the source row after the membership check and immediately
			// before hydration/serialization. The default source query includes an
			// EXISTS assignee predicate, so a revoked assignment becomes null;
			// injected sources get the same fail-closed contract.
			const currentRow =
				input.source === "tracker"
					? await source.getTrackerRow(detailInput)
					: await source.getBoardRow(detailInput);
			if (!currentRow || currentRow.workspace_id !== currentWorkspace.id) {
				return null;
			}
			if (
				currentRow.assignees !== undefined &&
				!currentRow.assignees.some((assignee) => assignee.id === input.userId)
			) {
				return null;
			}

			const candidate: MyWorkCandidate =
				input.source === "tracker"
					? { source: "tracker", row: currentRow as MyWorkTrackerRow }
					: { source: "board", row: currentRow as MyWorkBoardRow };
			const hydrated = await hydrate(
				[candidate],
				new Map([[currentWorkspace.id, currentWorkspace]]),
			);
			return hydrated[0] ?? null;
		} catch (error) {
			throw asUnavailable(error);
		}
	};

	return {
		list,
		listMyWork: list,
		getDetail,
		getMyWorkItem: getDetail,
	};
}

export type MyWorkServiceLike =
	| Pick<MyWorkService, "list" | "getDetail">
	| {
			listMyWork: (input: MyWorkListInput) => Promise<MyWorkListResponse>;
			getMyWorkItem: (
				input: MyWorkDetailInput,
			) => Promise<MyWorkSerializedItem | null>;
	  };

export type MyWorkRouterOptions = {
	service?: MyWorkServiceLike;
	deps?: MyWorkServiceDeps;
	dbExec?: DBExecutor;
};

function serviceMethods(service: MyWorkServiceLike) {
	const list = "list" in service ? service.list : service.listMyWork;
	const detail =
		"getDetail" in service ? service.getDetail : service.getMyWorkItem;
	return { list, detail };
}

function queryString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

export type ParsedMyWorkQuery = {
	scope: MyWorkScope;
	q: string;
	workspaceId?: number;
	source?: MyWorkSource;
	cursor: string | null;
	limit: number;
};

export function parseMyWorkQuery(
	query: Request["query"],
): { ok: true; value: ParsedMyWorkQuery } | { ok: false; error: string } {
	const scalarKeys = [
		"scope",
		"q",
		"workspaceId",
		"source",
		"cursor",
		"limit",
	] as const;
	for (const key of scalarKeys) {
		if (query[key] !== undefined && typeof query[key] !== "string") {
			return { ok: false, error: `${key} must be a scalar value` };
		}
	}
	const scopeValue = queryString(query.scope);
	if (scopeValue !== null && scopeValue !== "active" && scopeValue !== "all") {
		return { ok: false, error: "scope must be active or all" };
	}
	const sourceValue = queryString(query.source);
	if (
		sourceValue !== null &&
		sourceValue !== "board" &&
		sourceValue !== "tracker"
	) {
		return { ok: false, error: "source must be board or tracker" };
	}

	let workspaceId: number | undefined;
	const workspaceValue = queryString(query.workspaceId);
	if (workspaceValue !== null) {
		const parsed = Number(workspaceValue);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			return { ok: false, error: "workspaceId must be a positive integer" };
		}
		workspaceId = parsed;
	}

	let limit = 50;
	const limitValue = queryString(query.limit);
	if (limitValue !== null) {
		const parsed = Number(limitValue);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			return { ok: false, error: "limit must be a positive integer" };
		}
		limit = Math.min(50, parsed);
	}

	const cursorValue = queryString(query.cursor);
	if (cursorValue && !decodeMyWorkCursor(cursorValue)) {
		return { ok: false, error: "cursor is invalid" };
	}
	return {
		ok: true,
		value: {
			scope: scopeValue === "all" ? "all" : "active",
			q: queryString(query.q)?.trim() ?? "",
			...(workspaceId === undefined ? {} : { workspaceId }),
			...(sourceValue === null ? {} : { source: sourceValue }),
			cursor: cursorValue || null,
			limit,
		},
	};
}

function routeParam(value: unknown): string {
	return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function sendUnavailable(res: Response): void {
	res.status(503).json({
		error: "Unable to load My Work",
		code: "my_work_unavailable",
		retryable: true,
	});
}

function isMyWorkReadFailure(error: unknown): boolean {
	if (error instanceof MyWorkUnavailableError) return true;
	if (error instanceof Error) return true;
	if (typeof error !== "object" || error === null) return true;
	const candidate = error as {
		retryable?: unknown;
		status?: unknown;
		statusCode?: unknown;
	};
	return (
		candidate.retryable === true ||
		(typeof candidate.status === "number" && candidate.status >= 500) ||
		(typeof candidate.statusCode === "number" && candidate.statusCode >= 500)
	);
}

function requireMyWorkAuth(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	if (!req.user) {
		res.status(401).json({ error: "authentication required" });
		return;
	}
	next();
}

/** Creates the global authenticated router. It is mounted under /api/my-work. */
export function createMyWorkRouter(options: MyWorkRouterOptions = {}): Router {
	const service =
		options.service ??
		createMyWorkService(options.deps ?? options.dbExec ?? {});
	const methods = serviceMethods(service);
	const router = Router();
	router.use(requireMyWorkAuth);

	router.get("/", async (req, res) => {
		const parsed = parseMyWorkQuery(req.query);
		if (!parsed.ok) return res.status(400).json({ error: parsed.error });
		try {
			const result = await methods.list({
				userId: req.user!.id,
				...parsed.value,
			});
			return res.json(result);
		} catch (error) {
			if (isMyWorkReadFailure(error)) {
				sendUnavailable(res);
				return;
			}
			throw error;
		}
	});

	router.get("/:workspaceId/:source/:key", async (req, res) => {
		const workspaceValue = routeParam(req.params.workspaceId);
		const workspaceId = Number(workspaceValue);
		if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
			return res
				.status(400)
				.json({ error: "workspaceId must be a positive integer" });
		}
		const sourceValue = routeParam(req.params.source);
		if (sourceValue !== "board" && sourceValue !== "tracker") {
			return res.status(400).json({ error: "source must be board or tracker" });
		}
		const key = routeParam(req.params.key);
		const parsedKey = parseKeyFromUrl(key);
		if (!parsedKey)
			return res.status(400).json({ error: "invalid work item key" });

		try {
			const result = await methods.detail({
				userId: req.user!.id,
				workspaceId,
				source: sourceValue,
				key,
				keyNumber: parsedKey.keyNumber,
			});
			if (!result) return res.status(404).json({ error: "Not found" });
			return res.json(result);
		} catch (error) {
			if (isMyWorkReadFailure(error)) {
				sendUnavailable(res);
				return;
			}
			throw error;
		}
	});

	return router;
}

export const myWorkRouter = createMyWorkRouter();
