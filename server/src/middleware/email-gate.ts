import type { NextFunction, Request, Response } from "express";

export function requireEmailVerified(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	if (!req.user) {
		next();
		return;
	}
	if (!req.user.emailVerified) {
		res.status(403).json({ needsEmailVerification: true });
		return;
	}
	next();
}
