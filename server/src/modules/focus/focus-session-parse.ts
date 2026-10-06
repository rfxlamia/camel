import { z } from "zod";
import { parseWith } from "../../validators/http.js";
import { intField } from "../../validators/schemas.js";

/** The single legacy 400 body for every malformed focus-session request. */
export const FOCUS_INVALID_BODY = "Invalid request body";

const sessionIdentity = {
	version: intField(FOCUS_INVALID_BODY).optional(),
	sessionId: intField(FOCUS_INVALID_BODY).optional(),
};

const focusPostBody = z.object({
	action: z.enum(["focus", "switch"]),
	source: z.enum(["board", "tracker"]),
	taskId: intField(FOCUS_INVALID_BODY),
	...sessionIdentity,
});

const focusPatchBody = z.object({
	action: z.enum(["start", "pause", "resume", "finish"]),
	version: intField(FOCUS_INVALID_BODY),
	sessionId: intField(FOCUS_INVALID_BODY),
});

export function parseFocusPostBody(body: unknown) {
	return parseWith(focusPostBody, body, { message: FOCUS_INVALID_BODY });
}

export function parseFocusPatchBody(body: unknown) {
	return parseWith(focusPatchBody, body, { message: FOCUS_INVALID_BODY });
}
