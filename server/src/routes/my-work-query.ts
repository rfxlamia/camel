import { type RawBuilder, sql } from "kysely";
import { parseKeyFromUrl } from "../core/tracker-key.js";
import { myWorkCursorKeyNumber } from "./my-work-cursor.js";
import type {
	MyWorkCursor,
	MyWorkScope,
	MyWorkSource,
	MyWorkSourceQueryInput,
} from "./my-work-types.js";

export function buildSearchPattern(q: string): string {
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

export function boundedPageLimit(value: number | undefined): number {
	return Math.max(1, Math.min(50, Math.trunc(value ?? 50)));
}

/** Fetches one sentinel row per source so the service can expose a cursor. */
export function sourceQueryLimit(input: MyWorkSourceQueryInput): number {
	return Math.min(51, boundedPageLimit(input.limit) + 1);
}

export function localDateForTimezone(
	now: Date,
	timezone: string | null,
): string {
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

/** SQL status ordering kept in lockstep with response status normalization. */
function statusGroupExpression() {
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

export function sourceOrderExpressions(
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

function andSql(parts: readonly RawBuilder<unknown>[]): RawBuilder<boolean> {
	return sql<boolean>`(${sql.join(parts, sql` AND `)})`;
}

function appendCursorTerm(
	terms: RawBuilder<unknown>[],
	prefix: RawBuilder<unknown>[],
	greater: RawBuilder<unknown>,
	equal: RawBuilder<unknown>,
): void {
	terms.push(andSql([...prefix, greater]));
	prefix.push(equal);
}

function cursorKeyNumber(cursor: MyWorkCursor): number | null {
	return myWorkCursorKeyNumber(cursor);
}

type CursorPredicateParts = {
	prefix: RawBuilder<unknown>[];
	terms: RawBuilder<unknown>[];
};

function baseCursorPredicateParts(
	cursor: MyWorkCursor,
	expressions: ReturnType<typeof sourceOrderExpressions>,
): CursorPredicateParts {
	const prefix: RawBuilder<unknown>[] = [];
	const terms: RawBuilder<unknown>[] = [];
	appendCursorTerm(
		terms,
		prefix,
		sql`${expressions.group} > ${cursor.group}`,
		sql`${expressions.group} = ${cursor.group}`,
	);
	appendCursorTerm(
		terms,
		prefix,
		sql`${expressions.overdueRank} > ${cursor.overdue ? 0 : 1}`,
		sql`${expressions.overdueRank} = ${cursor.overdue ? 0 : 1}`,
	);
	appendCursorTerm(
		terms,
		prefix,
		sql`${expressions.dueNullRank} > ${cursor.dueDate === null ? 1 : 0}`,
		sql`${expressions.dueNullRank} = ${cursor.dueDate === null ? 1 : 0}`,
	);
	if (cursor.dueDate === null) {
		prefix.push(sql`${expressions.dueDate} IS NULL`);
	} else {
		appendCursorTerm(
			terms,
			prefix,
			sql`${expressions.dueDate} > ${cursor.dueDate}`,
			sql`${expressions.dueDate} = ${cursor.dueDate}`,
		);
	}
	appendCursorTerm(
		terms,
		prefix,
		sql`${expressions.updatedAt} < ${cursor.updatedAt}`,
		sql`${expressions.updatedAt} = ${cursor.updatedAt}`,
	);
	appendCursorTerm(
		terms,
		prefix,
		sql`${expressions.workspaceId} > ${cursor.workspaceId}`,
		sql`${expressions.workspaceId} = ${cursor.workspaceId}`,
	);
	return { prefix, terms };
}

function appendSourceCursorPredicate(
	source: MyWorkSource,
	cursor: MyWorkCursor,
	keyNumber: number,
	expressions: ReturnType<typeof sourceOrderExpressions>,
	parts: CursorPredicateParts,
): void {
	const sourceRank = source === "board" ? 0 : 1;
	const cursorSourceRank = cursor.source === "board" ? 0 : 1;
	if (sourceRank > cursorSourceRank) {
		parts.terms.push(andSql([...parts.prefix, sql`true`]));
	} else if (sourceRank === cursorSourceRank) {
		appendCursorTerm(
			parts.terms,
			parts.prefix,
			sql`${expressions.keyNumber} > ${keyNumber}`,
			sql`${expressions.keyNumber} = ${keyNumber}`,
		);
		parts.terms.push(
			andSql([...parts.prefix, sql`${expressions.id} > ${cursor.id}`]),
		);
	}
}

/** Builds the lexicographic predicate for one source's ordered page. */
export function sourceCursorPredicate(
	source: MyWorkSource,
	cursor: MyWorkCursor | null | undefined,
	expressions: ReturnType<typeof sourceOrderExpressions>,
): RawBuilder<boolean> | null {
	if (!cursor) return null;
	const keyNumber = cursorKeyNumber(cursor);
	if (keyNumber === null) return null;
	const parts = baseCursorPredicateParts(cursor, expressions);
	appendSourceCursorPredicate(source, cursor, keyNumber, expressions, parts);
	return sql<boolean>`(${sql.join(parts.terms, sql` OR `)})`;
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

export function sourceSearchPredicate(
	source: MyWorkSource,
	input: MyWorkSourceQueryInput,
	pattern: string,
): RawBuilder<boolean> {
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

	const keyPredicates: RawBuilder<unknown>[] = [
		...textPredicates,
		sql<boolean>`${sql.ref(`${alias}.key_number`)}::text ILIKE ${buildSearchPattern(input.q)}`,
	];
	const keyNumber = keyNumberInSearch(input.q);
	if (keyNumber) {
		keyPredicates.push(
			sql<boolean>`${sql.ref(`${alias}.key_number`)}::text = ${keyNumber}`,
		);
	}
	return sql<boolean>`(${sql.join(keyPredicates, sql` OR `)})`;
}
