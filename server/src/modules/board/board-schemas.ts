import { positiveIdParam } from "../../validators/schemas.js";

export const cardIdParam = positiveIdParam("invalid card id");
export const columnIdParam = positiveIdParam("invalid column id");
