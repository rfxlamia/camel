import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";

export interface TimeoutOptions {
	timeout?: number;
	keepAliveTimeout?: number;
	headersTimeout?: number;
}

export function requestTimeout(timeoutMs: number = 30000) {
	return (req: Request, res: Response, next: NextFunction): void => {
		if (timeoutMs <= 0) {
			return next();
		}

		const timeout = setTimeout(() => {
			if (!res.headersSent) {
				res.status(503).json({ error: "Request timeout" });
			}
		}, timeoutMs);

		res.on("finish", () => {
			clearTimeout(timeout);
		});

		res.on("close", () => {
			clearTimeout(timeout);
		});

		next();
	};
}

export function serverTimeout(
	server: Server,
	options: TimeoutOptions = {},
): void {
	const {
		timeout = 30000,
		keepAliveTimeout = 65000,
		headersTimeout = 66000,
	} = options;

	server.timeout = timeout;
	server.keepAliveTimeout = keepAliveTimeout;
	server.headersTimeout = headersTimeout;

	console.log(`[server] Timeout configuration:`, {
		requestTimeout: `${timeout}ms`,
		keepAliveTimeout: `${keepAliveTimeout}ms`,
		headersTimeout: `${headersTimeout}ms`,
	});
}

export function llmTimeout(timeoutMs: number = 60000) {
	return (req: Request, res: Response, next: NextFunction): void => {
		req.setTimeout(timeoutMs);
		next();
	};
}
