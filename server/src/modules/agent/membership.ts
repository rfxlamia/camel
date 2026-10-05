import type { Request, Response } from "express";
import { lookupMembership } from "../../lib/helpers.js";

/**
 * True when the caller is a member of the workspace. Otherwise sends a 404
 * and returns false, so handlers can `if (!(await assertWorkspaceMember(...))) return;`.
 * (Not the Express middleware of the same purpose in middleware/workspace.ts.)
 */
export async function assertWorkspaceMember(
	req: Request,
	res: Response,
	workspaceId: number,
): Promise<boolean> {
	const membership = await lookupMembership(req.user!.id, workspaceId);
	if (!membership) {
		res.status(404).json({ error: "Not found" });
		return false;
	}
	return true;
}
