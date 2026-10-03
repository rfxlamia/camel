import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger, requestContext } from "../lib/logger.js";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

declare global {
	// biome-ignore lint/style/noNamespace: Express augmentation
	namespace Express {
		interface Request {
			id?: string;
		}
	}
}

// Assigns a correlation id, exposes it as X-Request-Id, binds it to the async
// context so logger calls anywhere downstream include it, and logs one line
// per completed request.
export function requestContextMiddleware() {
	return (req: Request, res: Response, next: NextFunction): void => {
		const inbound = req.get("x-request-id");
		const requestId =
			inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
		req.id = requestId;
		res.setHeader("X-Request-Id", requestId);

		const start = process.hrtime.bigint();
		res.on("finish", () => {
			logger.info(
				{
					method: req.method,
					path: req.path,
					status: res.statusCode,
					durationMs: Number(process.hrtime.bigint() - start) / 1e6,
				},
				"request completed",
			);
		});

		requestContext.run({ requestId }, next);
	};
}
