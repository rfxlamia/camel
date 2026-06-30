import type { Request, Response } from "express";
import { pool } from "../db/pool.js";

interface SseClient {
	userId: number;
	workspaceId: number;
	lastEventId: number;
	res: Response;
	keepAlive: ReturnType<typeof setInterval>;
}

const clients = new Set<SseClient>();

export async function sseNotificationHandler(
	req: Request,
	res: Response,
): Promise<void> {
	const userId = (req.user as { id: number }).id;
	const workspaceId = Number(
		(req.params as { workspaceId: string }).workspaceId,
	);
	const lastEventId = Number(req.headers["last-event-id"] ?? 0) || 0;

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	res.write(": connected\n\n");

	if (lastEventId > 0) {
		const { rows } = await pool.query(
			`SELECT * FROM notifications
       WHERE user_id = $1 AND workspace_id = $2 AND id > $3
       ORDER BY id`,
			[userId, workspaceId, lastEventId],
		);
		for (const row of rows) {
			res.write(
				`id: ${row.id}\nevent: notification.created\ndata: ${JSON.stringify(row)}\n\n`,
			);
		}
	}

	const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
	const client: SseClient = { userId, workspaceId, lastEventId, res, keepAlive };
	clients.add(client);

	req.on("close", () => {
		clearInterval(keepAlive);
		clients.delete(client);
	});
}

export function pushNotificationToUser(
	userId: number,
	workspaceId: number,
	notification: Record<string, unknown>,
): void {
	const event = `id: ${notification.id}\nevent: notification.created\ndata: ${JSON.stringify(notification)}\n\n`;
	for (const client of clients) {
		if (client.userId === userId && client.workspaceId === workspaceId) {
			client.res.write(event);
		}
	}
}

export function pushReadEvent(
	userId: number,
	workspaceId: number,
	notificationId: number,
): void {
	const event = `event: notification.read\ndata: ${JSON.stringify({ id: notificationId })}\n\n`;
	for (const client of clients) {
		if (client.userId === userId && client.workspaceId === workspaceId) {
			client.res.write(event);
		}
	}
}

export function pushReadAllEvent(userId: number, workspaceId: number): void {
	const event = `event: notifications.read-all\ndata: {}\n\n`;
	for (const client of clients) {
		if (client.userId === userId && client.workspaceId === workspaceId) {
			client.res.write(event);
		}
	}
}
