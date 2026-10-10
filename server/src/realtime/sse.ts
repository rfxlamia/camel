import type { Request, Response } from "express";
import { parseWith, sendValidationError } from "../validators/http.js";
import { workspaceIdParam } from "../validators/schemas.js";
import type { PublishableEvent, SseClient } from "./types.js";

const KEEP_ALIVE_MS = 25_000;

function shouldDeliver(client: SseClient, event: PublishableEvent): boolean {
	return (
		event.type !== "focus_session.updated" || client.userId === event.userId
	);
}

export function createSseManager() {
	const clientsByWorkspace = new Map<number, Set<SseClient>>();
	let isShuttingDown = false;

	function addClient(client: SseClient): void {
		let set = clientsByWorkspace.get(client.workspaceId);
		if (!set) {
			set = new Set();
			clientsByWorkspace.set(client.workspaceId, set);
		}
		set.add(client);
	}

	function removeClient(client: SseClient): void {
		const set = clientsByWorkspace.get(client.workspaceId);
		if (!set) return;
		set.delete(client);
		if (set.size === 0) clientsByWorkspace.delete(client.workspaceId);
	}

	function fanOut(
		workspaceId: number,
		message: string,
		event: PublishableEvent,
	): void {
		for (const client of clientsByWorkspace.get(workspaceId) ?? []) {
			if (shouldDeliver(client, event)) {
				client.res.write(`data: ${message}\n\n`);
			}
		}
	}

	function handler(req: Request, res: Response): void {
		const parsedWorkspaceId = parseWith(
			workspaceIdParam,
			req.params.workspaceId,
		);
		if (!parsedWorkspaceId.ok) {
			sendValidationError(res, parsedWorkspaceId.body);
			return;
		}
		const workspaceId = parsedWorkspaceId.data;

		if (isShuttingDown) {
			res.status(503).json({ error: "Server is shutting down" });
			return;
		}

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.write(": connected\n\n");

		const keepAlive = setInterval(() => res.write(": ping\n\n"), KEEP_ALIVE_MS);
		const client: SseClient = {
			workspaceId,
			userId: req.user?.id,
			res,
			keepAlive,
		};
		addClient(client);

		req.on("close", () => {
			clearInterval(keepAlive);
			removeClient(client);
		});
	}

	function shutdown(): void {
		isShuttingDown = true;
		for (const set of clientsByWorkspace.values()) {
			for (const client of set) {
				try {
					clearInterval(client.keepAlive);
					client.res.end();
				} catch {
					// best-effort: client may already be closed
				}
			}
		}
		clientsByWorkspace.clear();
	}

	return { handler, fanOut, shutdown };
}
