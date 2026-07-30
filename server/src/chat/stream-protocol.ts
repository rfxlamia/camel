import type { Response } from "express";
import type { ToolEvent } from "../agent/tools/types.js";

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
