import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool.js";

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
	const { rows } = await pool.query(
		"SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
		[workspaceId, userId],
	);
	return rows[0]?.role as string | undefined;
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
