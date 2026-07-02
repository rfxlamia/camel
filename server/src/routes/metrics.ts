import { Router } from "express";
import { computeFlowMetrics, computeMetricsHistory } from "../core/metrics.js";
import { db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";

async function getCardTimeline(workspaceId: number) {
	return db
		.selectFrom("cards")
		.select(["created_at", "started_at", "done_at"])
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null)
		.execute();
}

export const metricsRouter = Router({ mergeParams: true });

metricsRouter.get("/metrics", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const windowDays = req.query.windowDays
		? Number(req.query.windowDays)
		: undefined;
	const rows = await getCardTimeline(workspaceId);
	const metrics = computeFlowMetrics(
		rows.map((r) => ({
			createdAt: r.created_at,
			startedAt: r.started_at,
			doneAt: r.done_at,
		})),
		{ windowDays },
	);
	res.json(metrics);
});

metricsRouter.get(
	"/metrics/history",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const weeks = req.query.weeks ? Number(req.query.weeks) : undefined;
		if (
			weeks !== undefined &&
			(!Number.isInteger(weeks) || weeks < 1 || weeks > 26)
		) {
			return res
				.status(400)
				.json({ error: "weeks must be an integer between 1 and 26" });
		}
		const rows = await getCardTimeline(workspaceId);
		const history = computeMetricsHistory(
			rows.map((r) => ({
				createdAt: r.created_at,
				startedAt: r.started_at,
				doneAt: r.done_at,
			})),
			{ weeks },
		);
		res.json({ weeks: history });
	},
);
