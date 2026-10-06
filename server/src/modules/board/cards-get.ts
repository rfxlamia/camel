import { Router } from "express";
import { db } from "../../db/kysely.js";
import {
	createScopedBoardService,
	lookupMembership,
} from "../../lib/helpers.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { workspaceIdParam } from "../../validators/schemas.js";
import { cardIdParam } from "./board-schemas.js";
import { loadCardResponse, selectFullCard } from "./card-read.js";

export const cardsGetRouter = Router({ mergeParams: true });

cardsGetRouter.get("/cards/:id", async (req, res) => {
	const parsedWorkspaceId = parseWith(
		workspaceIdParam,
		(req.params as { workspaceId: string; id: string }).workspaceId,
	);
	if (!parsedWorkspaceId.ok) {
		return sendValidationError(res, parsedWorkspaceId.body);
	}
	const workspaceId = parsedWorkspaceId.data;

	const parsedCardId = parseWith(cardIdParam, req.params.id);
	if (!parsedCardId.ok) return sendValidationError(res, parsedCardId.body);
	const cardId = parsedCardId.data;
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
