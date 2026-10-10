import type { Response } from "express";
import { z } from "zod";
import { parseWith, sendValidationError } from "../../validators/http.js";
import {
	legacyIntegerParam,
	workspaceIdParam,
} from "../../validators/schemas.js";
import { resolveMessageAction } from "./message-action.js";

export function parseAgentBoardParams(
	workspaceId: unknown,
	boardId: unknown,
	res: Response,
) {
	const parsedWorkspace = parseWith(workspaceIdParam, workspaceId);
	if (!parsedWorkspace.ok) {
		sendValidationError(res, parsedWorkspace.body);
		return undefined;
	}
	const parsedBoard = parseWith(legacyIntegerParam("Invalid params"), boardId);
	if (!parsedBoard.ok) {
		sendValidationError(res, parsedBoard.body);
		return undefined;
	}
	return {
		workspaceId: parsedWorkspace.data,
		boardId: parsedBoard.data,
	};
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
