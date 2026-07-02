import type { NextFunction, Request, Response } from "express";
import { db } from "../db/kysely.js";

declare global {
	// biome-ignore lint/style/noNamespace: Express augmentation
	namespace Express {
		interface Request {
			workspace?: {
				workspaceId: number;
				role: string;
			};
		}
	}
}

function parseWorkspaceId(raw: string): number | null {
	const workspaceId = Number(raw);
	return Number.isInteger(workspaceId) ? workspaceId : null;
}

async function lookupMembership(
	userId: number,
	workspaceId: number,
): Promise<string | undefined> {
	const row = await db
		.selectFrom("workspace_members")
		.select("role")
		.where("workspace_id", "=", workspaceId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return row?.role;
}

/**
 * Middleware: validates workspaceId param, checks membership, attaches workspace info to req.
 * Returns 400 if workspaceId is invalid, 404 if user is not a member.
 */
export async function requireWorkspaceMember(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const rawId = req.params.workspaceId;
		const workspaceId = parseWorkspaceId(
			typeof rawId === "string" ? rawId : "",
		);
		if (workspaceId === null) {
			return res.status(400).json({ error: "workspaceId must be an integer" });
		}

		const role = await lookupMembership(req.user!.id, workspaceId);
		if (!role) {
			return res.status(404).json({ error: "Not found" });
		}

		req.workspace = { workspaceId, role };
		next();
	} catch (err) {
		next(err);
	}
}
