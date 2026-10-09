import { z } from "zod";
import { type ParseResult, parseWith } from "../../validators/http.js";
import { workspaceIdParam } from "../../validators/schemas.js";
import { validateBoardName } from "./settings-validation.js";

type WorkspaceRouteParams = { workspaceId: string };

export function parseWorkspaceId(params: unknown): ParseResult<number> {
	return parseWith(
		workspaceIdParam,
		(params as WorkspaceRouteParams).workspaceId,
	);
}

/** String board name; wraps validateBoardName so its rules stay in one place. */
export function boardNameField(typeMessage: string) {
	return z
		.string({ error: typeMessage })
		.superRefine((value, ctx) => {
			const result = validateBoardName(value);
			if (!result.valid)
				ctx.addIssue({ code: "custom", message: result.error });
		})
		.transform((value) => value.trim());
}

/** String logo path, trimmed; empty after trim fails with `emptyMessage`. */
export function logoPathField(typeMessage: string, emptyMessage: string) {
	return z
		.string({ error: typeMessage })
		.transform((value) => value.trim())
		.refine((value) => value.length > 0, { error: emptyMessage });
}
