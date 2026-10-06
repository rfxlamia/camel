import { z } from "zod";
import { parseKeyFromUrl } from "../../core/tracker-key.js";
import { parseWith } from "../../validators/http.js";
import {
	intField,
	positiveIdParam,
	requiredVersion,
	trimmedRequired,
} from "../../validators/schemas.js";
import { routeKeyParam } from "./tracker-item-route-helpers.js";

const TRACKER_KEY_MESSAGE = "invalid tracker key";

/** `:key` route param (e.g. `CT-42`) parsed into `{ prefix, keyNumber }`. */
const trackerKeyParam = z.string().transform((raw, ctx) => {
	const parsed = parseKeyFromUrl(raw);
	if (!parsed) {
		ctx.issues.push({
			code: "custom",
			message: TRACKER_KEY_MESSAGE,
			input: raw,
		});
		return z.NEVER;
	}
	return parsed;
});

export function parseTrackerKey(raw: string | string[]) {
	return parseWith(trackerKeyParam, routeKeyParam(raw));
}

export const VOCAB_KINDS = ["status", "priority", "label"] as const;

export const vocabularyKind = z.enum(VOCAB_KINDS, {
	error: "kind must be status, priority, or label",
});

/** Reorder neighbours: each key, when present, must be a string; one is required. */
export const reorderNeighborKeys = z
	.object(
		{
			beforeKey: z.string({ error: "beforeKey must be a string" }).optional(),
			afterKey: z.string({ error: "afterKey must be a string" }).optional(),
		},
		// A JSON array body used to destructure to two undefineds, so keep that message.
		{ error: "beforeKey or afterKey is required" },
	)
	.refine(
		(value) => value.beforeKey !== undefined || value.afterKey !== undefined,
		{
			error: "beforeKey or afterKey is required",
		},
	);

export const projectIdParam = positiveIdParam("invalid project id");
export const phaseIdParam = positiveIdParam("invalid phase id");
export const nameField = trimmedRequired("name is required");
export { requiredVersion };
export const titleField = trimmedRequired("title is required");
export const statusIdField = intField("statusId must be an integer");
