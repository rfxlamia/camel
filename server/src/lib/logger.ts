import { AsyncLocalStorage } from "node:async_hooks";
import "dotenv/config";
import pino, { type DestinationStream, type LoggerOptions } from "pino";

interface RequestContext {
	requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

const isTest = process.env.NODE_ENV === "test";
const isDevelopment = process.env.NODE_ENV === "development";

// Reads process.env directly (not config.ts): config exits the process on
// invalid env, and its failures must be reportable before the logger exists.
export function createLogger(destination?: DestinationStream) {
	const options: LoggerOptions = {
		level: process.env.LOG_LEVEL ?? (isTest ? "silent" : "info"),
		// Attach the current request id to every record, however deep the call site.
		mixin: () => {
			const ctx = requestContext.getStore();
			return ctx ? { requestId: ctx.requestId } : {};
		},
		...(isDevelopment &&
			!destination && {
				transport: { target: "pino-pretty" },
			}),
	};
	return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();
