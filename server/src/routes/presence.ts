import { Router } from "express";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import {
	clearPresence,
	heartbeat,
	onlineUsers,
	sseHandler,
} from "../realtime.js";

type WorkspaceRouteParams = { workspaceId: string };

function parseWorkspaceId(raw: string): number | null {
	const workspaceId = Number(raw);
	return Number.isInteger(workspaceId) ? workspaceId : null;
}

export const presenceRouter = Router({ mergeParams: true });

presenceRouter.post(
	"/presence/heartbeat",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		await heartbeat(workspaceId, req.user!);
		res.json({ ok: true });
	},
);

presenceRouter.get("/presence", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	res.json({ users: await onlineUsers(workspaceId, req.user!) });
});

presenceRouter.delete("/presence", async (req, res) => {
	const workspaceId = parseWorkspaceId(
		(req.params as WorkspaceRouteParams).workspaceId,
	);
	if (workspaceId === null) {
		return res.status(400).json({ error: "workspaceId must be an integer" });
	}

	await clearPresence(workspaceId, req.user!.id);
	res.status(204).end();
});

presenceRouter.get(
	"/events/stream",
	requireWorkspaceMember,
	async (req, res) => {
		sseHandler(req, res);
	},
);
