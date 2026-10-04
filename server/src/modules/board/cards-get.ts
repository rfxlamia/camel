import { Router } from "express";
import { db } from "../../db/kysely.js";
import {
	createScopedBoardService,
	lookupMembership,
	parseWorkspaceId,
} from "../../lib/helpers.js";
import { loadCardResponse, selectFullCard } from "./card-read.js";

export const cardsGetRouter = Router({ mergeParams: true });

cardsGetRouter.get("/cards/:id", async (req, res) => {
	const workspaceId = parseWorkspaceId(
		(req.params as { workspaceId: string; id: string }).workspaceId,
	);
	if (workspaceId === null) {
		return res.status(400).json({ error: "workspaceId must be an integer" });
	}

	const cardId = Number(req.params.id);
	if (Number.isNaN(cardId)) {
		return res.status(400).json({ error: "invalid card id" });
	}
	const result = await createScopedBoardService({
		getMembership: async (wsId, userId) => {
			const r = await lookupMembership(userId, wsId);
			return r ? { role: r } : null;
		},
		getCardById: async (wsId, cId) => {
			const row = await selectFullCard(db)
				.where("c.id", "=", cId)
				.where("c.workspace_id", "=", wsId)
				.where("c.deleted_at", "is", null)
				.executeTakeFirst();
			if (!row) return null;
			return {
				...(await loadCardResponse(db, wsId, row)),
				workspaceId: row.workspace_id,
			};
		},
		getBoardRows: async () => [],
		getActivityRows: async () => [],
	}).getCard({ userId: req.user!.id, workspaceId, cardId });

	if ("status" in result && typeof result.status === "number") {
		return res
			.status(result.status)
			.json({ error: "error" in result ? result.error : "Not found" });
	}
	res.json(result);
});
