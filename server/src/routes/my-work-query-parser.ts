import type { Request } from "express";
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
			...(sourceValue === null ? {} : { source: sourceValue as MyWorkSource }),
			cursor: cursorValue || null,
			limit,
		},
	};
}

export type { MyWorkScope, MyWorkSource, ParsedMyWorkQuery };
