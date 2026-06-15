/** Count numbered search hits in web_search tool_result content (e.g. "1. Title"). */
export function countSearchResults(content: string): number {
	if (/no results found/i.test(content)) return 0;
	const matches = content.match(/^\d+\./gm);
	return matches?.length ?? 0;
}

export function parseToolCallInput(
	input: unknown,
): { query?: string; resultCount?: number } {
	if (typeof input === "string") {
		return input ? { query: input } : {};
	}
	if (input && typeof input === "object") {
		const obj = input as Record<string, unknown>;
		const query = typeof obj.query === "string" ? obj.query : undefined;
		const resultCount =
			typeof obj.resultCount === "number" ? obj.resultCount : undefined;
		return { query, resultCount };
	}
	return {};
}

export interface ToolTraceRow {
	column_slug: string;
	tool_name: string;
	input: unknown;
	result: string | null;
	error_code: string | null;
	attempt: number | null;
	created_at: string | null;
}

export interface MergedToolTraceItem {
	columnSlug: string;
	toolName: string;
	query?: string;
	resultCount?: number;
	errorCode?: string;
	attempt?: number;
	createdAt?: string;
	reasoningText?: string;
}

/** Merge started/result/failed DB rows (and reasoning rows) into logical trace steps. */
export function mergeToolTraceRows(
	rows: ToolTraceRow[],
): MergedToolTraceItem[] {
	const items: MergedToolTraceItem[] = [];
	let pending: MergedToolTraceItem | null = null;

	for (const r of rows) {
		if (r.tool_name === "_reasoning") {
			items.push({
				columnSlug: r.column_slug,
				toolName: "_reasoning",
				reasoningText: r.result ?? undefined,
				createdAt: r.created_at ?? undefined,
			});
			continue;
		}

		const { query, resultCount: inputCount } = parseToolCallInput(r.input);
		const base: MergedToolTraceItem = {
			columnSlug: r.column_slug,
			toolName: r.tool_name,
			query,
			attempt: r.attempt ?? undefined,
			createdAt: r.created_at ?? undefined,
		};

		const isStarted =
			!r.error_code && (r.result === null || r.result === "" || r.result === "started");
		const isOkResult = r.result === "ok" || r.result === "success";

		if (isStarted) {
			if (pending) items.push(pending);
			pending = base;
			continue;
		}

		if (
			pending &&
			pending.toolName === r.tool_name &&
			pending.columnSlug === r.column_slug
		) {
			let resultCount = inputCount;
			if (resultCount === undefined && r.result && r.result !== "ok") {
				const parsed = Number(r.result);
				if (!Number.isNaN(parsed)) resultCount = parsed;
			}
			if (resultCount === undefined && isOkResult) resultCount = 0;

			items.push({
				...pending,
				query: pending.query ?? query,
				resultCount,
				errorCode: r.error_code ?? undefined,
				attempt: r.attempt ?? pending.attempt,
				createdAt: r.created_at ?? pending.createdAt,
			});
			pending = null;
			continue;
		}

		if (pending) {
			items.push(pending);
			pending = null;
		}

		let resultCount = inputCount;
		if (resultCount === undefined && r.result && !isOkResult) {
			const parsed = Number(r.result);
			if (!Number.isNaN(parsed)) resultCount = parsed;
		}

		items.push({
			...base,
			resultCount,
			errorCode: r.error_code ?? undefined,
		});
	}

	if (pending) items.push(pending);
	return items;
}
