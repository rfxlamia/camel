import type { Response } from "express";
import { logger } from "../../lib/logger.js";
import type { ToolEvent } from "../agent/index.js";

export type StreamEvent =
	| { type: "token"; text: string }
	| { type: "thinking"; text: string }
	| { type: "tool_event"; event: ToolEvent }
	| { type: "done"; messageId: number }
	| { type: "error"; message: string; retryable?: boolean };

export function setStreamHeaders(res: Response): void {
	res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("X-Accel-Buffering", "no");
}

export function writeStreamEvent(res: Response, event: StreamEvent): void {
	res.write(`${JSON.stringify(event)}\n`);
}

/**
 * Write an event without throwing. Returns false when the client already
 * disconnected (or the write fails), so callers can keep cleaning up instead
 * of letting a second throw escape and hang the response.
 */
export function safeWriteStreamEvent(
	res: Response,
	event: StreamEvent,
): boolean {
	if (res.writableEnded || res.destroyed) return false;
	try {
		writeStreamEvent(res, event);
		return true;
	} catch (err) {
		// Disconnects are filtered above; anything thrown here is unexpected.
		logger.warn({ err }, "stream write failed");
		return false;
	}
}

/** End the response without throwing if it is already closed. */
export function safeEndStream(res: Response): void {
	if (res.writableEnded || res.destroyed) return;
	try {
		res.end();
	} catch {
		// client already gone — nothing left to flush
	}
}
