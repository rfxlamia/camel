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

/** Required optimistic-lock `version`; a missing value fails like a bad one. */
export const requiredVersion = z
	.number({ error: VERSION_MESSAGE })
	.int({ error: VERSION_MESSAGE });

/** Digits-only safe positive integer route param with a caller-chosen message. */
export function positiveIdParam(message: string) {
	return z
		.string({ error: message })
		.regex(/^\d+$/, { error: message })
		.transform(Number)
		.refine((value) => Number.isSafeInteger(value) && value > 0, {
			error: message,
		});
}

/**
 * Exists only to keep #197 behavior-preserving; replaced by workspaceIdParam in #198.
 */
export function legacyIntegerParam(message: string) {
	return z
		.unknown()
		.transform((value) => Number(value))
		.refine(Number.isInteger, { error: message });
}

/** Non-empty string after trim; returns the trimmed value. */
export function trimmedRequired(message: string) {
	return z
		.string({ error: message })
		.transform((value) => value.trim())
		.refine((value) => value.length > 0, { error: message });
}

/** Integer body field (`statusId`, ...). */
export function intField(message: string) {
	return z.number({ error: message }).int({ error: message });
}

/** Integer-or-null body field (`priorityId`, ...). */
export function intOrNullField(message: string) {
	return intField(message).nullable();
}

/** Finite number body field (`position`, ...). */
export function finiteNumber(message: string) {
	return z.number({ error: message });
}

/** Strict positive-integer route param (digits only); `null` when invalid. */
export function parsePositiveIntegerParam(
	value: string | undefined,
): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
