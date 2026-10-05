import { z } from "zod";

const WORKSPACE_ID_MESSAGE = "workspaceId must be an integer";
const VERSION_MESSAGE = "version must be an integer";

/** `:workspaceId` route param: digits only, safe integer, greater than zero. */
export const workspaceIdParam = z
	.string({ error: WORKSPACE_ID_MESSAGE })
	.regex(/^\d+$/, { error: WORKSPACE_ID_MESSAGE })
	.transform(Number)
	.refine((value) => Number.isSafeInteger(value) && value > 0, {
		error: WORKSPACE_ID_MESSAGE,
	});

/** Optional optimistic-lock `version` from a request body. */
export const optionalVersion = z
	.number({ error: VERSION_MESSAGE })
	.int({ error: VERSION_MESSAGE })
	.optional();

/** Strict positive-integer route param (digits only); `null` when invalid. */
export function parsePositiveIntegerParam(
	value: string | undefined,
): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
