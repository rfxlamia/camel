import type { Request, Response } from "express";
import { db } from "../../db/kysely.js";

export async function lookupMembership(
	userId: number,
	workspaceId: number,
): Promise<string | null> {
	const row = await db
		.selectFrom("workspace_members")
		.select("role")
		.where("user_id", "=", userId)
		.where("workspace_id", "=", workspaceId)
		.executeTakeFirst();
	return row?.role ?? null;
}

// Helper: check workspace membership and short-circuit with 404
export async function requireWorkspaceMember(
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
