import type { Response } from "express";
import { z } from "zod";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { legacyIntegerParam } from "../../validators/schemas.js";
import { resolveMessageAction } from "./message-action.js";

const boardParams = z.object({
	workspaceId: legacyIntegerParam("Invalid params"),
	boardId: legacyIntegerParam("Invalid params"),
});

export function parseAgentBoardParams(
	workspaceId: unknown,
	boardId: unknown,
	res: Response,
) {
	const parsed = parseWith(boardParams, { workspaceId, boardId });
	if (parsed.ok) return parsed.data;
	sendValidationError(res, parsed.body);
	return undefined;
}

const messageAction = z
	.unknown()
	.transform(resolveMessageAction)
	.pipe(
		z.custom<
			Exclude<ReturnType<typeof resolveMessageAction>, { kind: "invalid" }>
		>(
			(action) =>
				typeof action === "object" &&
				action !== null &&
				"kind" in action &&
				action.kind !== "invalid",
			{ error: "message or action is required" },
		),
	);

export function parseAgentMessageAction(body: unknown) {
	return parseWith(messageAction, body);
}
