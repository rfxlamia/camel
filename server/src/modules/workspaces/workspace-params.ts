import { z } from "zod";
import { validateWorkspaceName } from "../../validators/input-length.js";
import { positiveIdParam } from "../../validators/schemas.js";

export const MEMBER_PARAMS_MESSAGE = "workspaceId and userId must be integers";
export const INVITE_PARAMS_MESSAGE =
	"workspaceId and inviteId must be integers";

/** `:workspaceId/:userId` route params, one combined legacy message. */
export const memberParams = z.object({
	workspaceId: positiveIdParam(MEMBER_PARAMS_MESSAGE),
	userId: positiveIdParam(MEMBER_PARAMS_MESSAGE),
});

/** `:workspaceId/:inviteId` route params, one combined legacy message. */
export const inviteParams = z.object({
	workspaceId: positiveIdParam(INVITE_PARAMS_MESSAGE),
	inviteId: positiveIdParam(INVITE_PARAMS_MESSAGE),
});

/** Workspace `name` body field; yields the trimmed name, keeps legacy errors. */
export const workspaceNameBody = z.unknown().transform((value, ctx) => {
	const result = validateWorkspaceName(value as string);
	if (!result.valid) {
		ctx.addIssue({ code: "custom", message: result.error ?? "Invalid name" });
		return z.NEVER;
	}
	return result.trimmed as string;
});

/** Role accepted when changing a member's role. */
export const memberRoleBody = z.enum(["admin", "member"], {
	error: 'role must be "admin" or "member"',
});
