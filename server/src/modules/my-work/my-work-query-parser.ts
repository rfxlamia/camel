import type { Request } from "express";
import { parseWith } from "../../validators/http.js";
import { workspaceIdParam } from "../../validators/schemas.js";
import {
	parseLimitValue,
	parseScopeValue,
	parseSourceValue,
	scalarQueryError,
} from "./my-work-query-parser-helpers.js";
import { decodeMyWorkCursor } from "./my-work-response-pagination.js";
import type {
	MyWorkScope,
	MyWorkSource,
	ParsedMyWorkQuery,
} from "./my-work-types.js";

function queryString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

export function parseMyWorkQuery(
	query: Request["query"],
): { ok: true; value: ParsedMyWorkQuery } | { ok: false; error: string } {
	const scalarError = scalarQueryError(query);
	if (scalarError) return { ok: false, error: scalarError };

	const scope = parseScopeValue(queryString(query.scope));
	if (!scope.ok) return scope;
	const source = parseSourceValue(queryString(query.source));
	if (!source.ok) return source;
	const workspaceIdRaw = queryString(query.workspaceId);
	let workspaceId: number | undefined;
	if (workspaceIdRaw === null) {
		workspaceId = undefined;
	} else {
		const parsedWorkspace = parseWith(workspaceIdParam, workspaceIdRaw);
		if (!parsedWorkspace.ok) {
			return { ok: false, error: parsedWorkspace.body.error };
		}
		workspaceId = parsedWorkspace.data;
	}
	const limit = parseLimitValue(queryString(query.limit));
	if (!limit.ok) return limit;

	const cursor = queryString(query.cursor);
	if (cursor && !decodeMyWorkCursor(cursor)) {
		return { ok: false, error: "cursor is invalid" };
	}
	return {
		ok: true,
		value: {
			scope: scope.value === "all" ? "all" : "active",
			q: queryString(query.q)?.trim() ?? "",
			...(workspaceId === undefined ? {} : { workspaceId }),
			...(source.value === null ? {} : { source: source.value }),
			cursor: cursor || null,
			limit: limit.value,
		},
	};
}

export type { MyWorkScope, MyWorkSource, ParsedMyWorkQuery };
