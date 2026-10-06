import type { Request } from "express";
import { parseWith } from "../../validators/http.js";
import { positiveIdParam } from "../../validators/schemas.js";
import type { MyWorkScope, MyWorkSource } from "./my-work-types.js";

export type QueryParseResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: string };

const SCALAR_QUERY_KEYS = [
	"scope",
	"q",
	"workspaceId",
	"source",
	"cursor",
	"limit",
] as const;

export function scalarQueryError(query: Request["query"]): string | null {
	for (const key of SCALAR_QUERY_KEYS) {
		if (query[key] !== undefined && typeof query[key] !== "string") {
			return `${key} must be a scalar value`;
		}
	}
	return null;
}

export function parseScopeValue(
	value: string | null,
): QueryParseResult<MyWorkScope | null> {
	if (value !== null && value !== "active" && value !== "all") {
		return { ok: false, error: "scope must be active or all" };
	}
	return { ok: true, value };
}

export function parseSourceValue(
	value: string | null,
): QueryParseResult<MyWorkSource | null> {
	if (value !== null && value !== "board" && value !== "tracker") {
		return { ok: false, error: "source must be board or tracker" };
	}
	return { ok: true, value };
}

// Not `workspaceIdParam`: that schema says "workspaceId must be an integer",
// while My Work's query contract says "...a positive integer". Wording changes
// are out of scope here, so it shares the digits-only primitive instead.
const queryWorkspaceId = positiveIdParam(
	"workspaceId must be a positive integer",
);

export function parseWorkspaceIdValue(
	value: string | null,
): QueryParseResult<number | undefined> {
	if (value === null) return { ok: true, value: undefined };
	const parsed = parseWith(queryWorkspaceId, value);
	if (!parsed.ok) return { ok: false, error: parsed.body.error };
	return { ok: true, value: parsed.data };
}

export function parseLimitValue(
	value: string | null,
): QueryParseResult<number> {
	if (value === null) return { ok: true, value: 50 };
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return { ok: false, error: "limit must be a positive integer" };
	}
	return { ok: true, value: Math.min(50, parsed) };
}
