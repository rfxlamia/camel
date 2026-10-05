import type { NextFunction, Request, Response } from "express";
import { lookupMembership } from "../lib/helpers.js";
import { parseWith, sendValidationError } from "../validators/http.js";
import { workspaceIdParam } from "../validators/schemas.js";

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
		const parsedId = parseWith(
			workspaceIdParam,
			typeof rawId === "string" ? rawId : "",
		);
		if (!parsedId.ok) return sendValidationError(res, parsedId.body);
		const workspaceId = parsedId.data;

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
