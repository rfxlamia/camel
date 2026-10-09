import type { Request, Response } from "express";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { legacyIntegerParam } from "../../validators/schemas.js";

export function validateThreadId(
	req: Request,
	res: Response,
): number | undefined {
	const parsed = parseWith(
		legacyIntegerParam("thread id must be an integer"),
		req.params.id,
	);
	if (!parsed.ok) {
		sendValidationError(res, parsed.body);
		return undefined;
	}
	return parsed.data;
}
