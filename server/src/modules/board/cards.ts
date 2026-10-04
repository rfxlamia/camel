import { Router } from "express";
import { requireWorkspaceMember } from "../../middleware/workspace.js";
import { createCard } from "./card-create.js";
import { cardCreateMultipartMiddleware } from "./card-create-multipart.js";
import { cardsDeleteRouter } from "./cards-delete.js";
import { cardsGetRouter } from "./cards-get.js";
import { cardsMoveRouter } from "./cards-move.js";
import { cardsUpdateRouter } from "./cards-update.js";

export { batchUpdateCardPositions } from "./card-positions.js";

export const cardsRouter = Router({ mergeParams: true });

cardsRouter.use(cardsGetRouter);
cardsRouter.post(
	"/cards",
	requireWorkspaceMember,
	cardCreateMultipartMiddleware,
	createCard,
);
cardsRouter.use(cardsUpdateRouter);
cardsRouter.use(cardsDeleteRouter);
cardsRouter.use(cardsMoveRouter);
