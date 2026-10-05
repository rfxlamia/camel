import { z } from "zod";

const WORKSPACE_ID_MESSAGE = "workspaceId must be an integer";
const VERSION_MESSAGE = "version must be an integer";

/** `:workspaceId` route param: any string `Number()` turns into an integer. */
export const workspaceIdParam = z
	.string({ error: WORKSPACE_ID_MESSAGE })
	.transform((raw) => Number(raw))
	.refine((value) => Number.isInteger(value), { error: WORKSPACE_ID_MESSAGE });

/** Optional optimistic-lock `version` from a request body. */
export const optionalVersion = z
	.unknown()
	.refine((value) => value === undefined || Number.isInteger(value), {
		error: VERSION_MESSAGE,
	}) as z.ZodType<number | undefined>;

/** Strict positive-integer route param (digits only); `null` when invalid. */
export function parsePositiveIntegerParam(
	value: string | undefined,
): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
