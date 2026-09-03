import { Router } from "express";
import { sql } from "kysely";
import {
	mapColumnSlots,
	statusIdForSlot,
} from "../core/column-status-map.js";
import {
	neighborsAt,
	POSITION_GAP,
	positionBetween,
	rebalance,
} from "../core/position.js";
import { checkWipLimit } from "../core/wip.js";
import { derivePrefix, formatKey } from "../core/tracker-key.js";
import { type DBExecutor, db } from "../db/kysely.js";
import type { AuthUser } from "../auth.js";
import { domainBus, EVENTS } from "../events.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { publishEvent } from "../realtime.js";
import {
	validateCardDescription,
	validateCardTitle,
	validateDueDate,
} from "../validators/input-length.js";
import {
	addCardAssignee,
	getCardAssigneeIds,
	loadCardAssigneesForCards,
	syncCardAssignees,
} from "./card-assignees.js";
import { createCard } from "./card-create.js";
import { syncCardLabels } from "./card-labels.js";
import {
	buildCardResponse,
	type CardResponseRow,
	loadCardLabelsForCards,
} from "./card-response.js";
import {
	createScopedBoardService,
	lookupMembership,
	parseWorkspaceId,
	recordActivity,
} from "./helpers.js";
import {
	parseCardProjectPhase,
	parseLabelIds,
	parsePriorityId,
} from "./tracker-item-parsers.js";

export const cardsRouter = Router({ mergeParams: true });

type FullCardRow = CardResponseRow & { workspace_id: number };
type CardDbRow = CardResponseRow;

function toCardDbRow(row: FullCardRow): CardDbRow {
	return { ...row };
}

const mapCardResponse = buildCardResponse;

export function selectFullCard(dbExec: DBExecutor) {
	return dbExec
		.selectFrom("cards as c")
		.innerJoin("workspaces as w", "w.id", "c.workspace_id")
		.leftJoin("tracker_vocabularies as st", (join) =>
			join.onRef("st.id", "=", "c.status_id").on("st.kind", "=", "status"),
		)
		.leftJoin("tracker_vocabularies as pr", (join) =>
			join.onRef("pr.id", "=", "c.priority_id").on("pr.kind", "=", "priority"),
		)
		.leftJoin("tracker_projects as tpr", (join) =>
			join
				.onRef("tpr.id", "=", "c.project_id")
				.on("tpr.deleted_at", "is", null),
		)
		.leftJoin("tracker_phases as tph", (join) =>
			join
				.onRef("tph.id", "=", "c.phase_id")
				.on("tph.deleted_at", "is", null),
		)
		.select([
			"c.id",
			"c.workspace_id",
			"c.column_id",
			"c.title",
			"c.description",
			"c.position",
			"c.version",
			"c.created_at",
			"c.started_at",
			"c.done_at",
			sql<string | null>`c.due_date::text`.as("due_date"),
			"c.key_number",
			"w.name as workspace_name",
			"c.status_id",
			"st.kind as status_kind",
			"st.name as status_name",
			"st.position as status_position",
			"st.colour as status_colour",
			"st.category as status_category",
			"st.slot as status_slot",
			"c.priority_id",
			"pr.kind as priority_kind",
			"pr.name as priority_name",
			"pr.position as priority_position",
			"pr.colour as priority_colour",
			"c.project_id",
			"tpr.name as project_name",
			"c.phase_id",
			"tph.name as phase_name",
		]);
}

async function cardEventPayload(
	cardId: number,
	workspaceId: number,
): Promise<Record<string, unknown>> {
	const row = await db
		.selectFrom("cards as c")
		.innerJoin("workspaces as w", "w.id", "c.workspace_id")
		.select(["c.key_number", "w.name as workspace_name"])
		.where("c.id", "=", cardId)
		.where("c.workspace_id", "=", workspaceId)
		.executeTakeFirst();
	if (row?.key_number == null || row.workspace_name == null) return {};
	return {
		key: formatKey(derivePrefix(row.workspace_name), row.key_number),
	};
}

async function publishCardWorkspaceEvent(
	workspaceId: number,
	event: {
		type:
			| "card.created"
			| "card.updated"
			| "card.moved"
			| "card.reordered"
			| "card.deleted";
		actor: AuthUser;
		cardId: number;
	},
) {
	await publishEvent(workspaceId, {
		...event,
		payload: await cardEventPayload(event.cardId, workspaceId),
	});
}

async function hydrateCard(cardId: number, workspaceId: number) {
	const row = await selectFullCard(db)
		.where("c.id", "=", cardId)
		.where("c.workspace_id", "=", workspaceId)
		.where("c.deleted_at", "is", null)
		.executeTakeFirst();
	if (!row) return null;
	const [assigneesByCard, labelsByCard] = await Promise.all([
		loadCardAssigneesForCards(db, [cardId]),
		loadCardLabelsForCards(db, [cardId]),
	]);
	return buildCardResponse(row, {
		assignees: assigneesByCard.get(cardId) ?? [],
		labels: labelsByCard.get(cardId) ?? [],
	});
}

function emitCardAssigned(
	workspaceId: number,
	actorId: number,
	cardId: number,
	cardTitle: string,
	actorDisplayName: string,
	assigneeId: number,
) {
	domainBus.emit(EVENTS.CARD_ASSIGNED, {
		type: EVENTS.CARD_ASSIGNED,
		workspaceId,
		actorId,
		payload: { cardId, assigneeId, cardTitle, actorDisplayName },
	});
}

function emitDueDateChange(
	workspaceId: number,
	actorId: number,
	cardId: number,
	cardTitle: string,
	actorDisplayName: string,
	assigneeIds: number[],
	oldDueDate: string | null,
	newDueDate: string | null,
) {
	for (const assigneeId of assigneeIds) {
		if (newDueDate != null) {
			domainBus.emit(EVENTS.CARD_DUE_DATE_CHANGED, {
				type: EVENTS.CARD_DUE_DATE_CHANGED,
				workspaceId,
				actorId,
				payload: {
					cardId,
					assigneeId,
					cardTitle,
					actorDisplayName,
					oldDueDate,
					newDueDate,
				},
			});
		} else {
			domainBus.emit(EVENTS.CARD_DUE_DATE_REMOVED, {
				type: EVENTS.CARD_DUE_DATE_REMOVED,
				workspaceId,
				actorId,
				payload: {
					cardId,
					assigneeId,
					cardTitle,
					actorDisplayName,
					oldDueDate,
				},
			});
		}
	}
}

async function parseAssigneeIds(
	body: Record<string, unknown>,
	workspaceId: number,
): Promise<number[] | { error: string }> {
	const raw = body.assigneeIds;
	if (!Array.isArray(raw)) {
		return { error: "assigneeIds must be an array of integers" };
	}
	const ids: number[] = [];
	for (const id of raw) {
		if (!Number.isInteger(id)) {
			return { error: "assigneeIds must be an array of integers" };
		}
		ids.push(id as number);
	}
	for (const userId of [...new Set(ids)]) {
		const role = await lookupMembership(userId, workspaceId);
		if (!role) {
			return { error: "assignee must be a member of this workspace" };
		}
	}
	return ids;
}

cardsRouter.get("/cards/:id", async (req, res) => {
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
			const [assigneesByCard, labelsByCard] = await Promise.all([
				loadCardAssigneesForCards(db, [cId]),
				loadCardLabelsForCards(db, [cId]),
			]);
			return {
				...buildCardResponse(row, {
					assignees: assigneesByCard.get(cId) ?? [],
					labels: labelsByCard.get(cId) ?? [],
				}),
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

cardsRouter.post("/cards", requireWorkspaceMember, createCard);

cardsRouter.patch("/cards/:id", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const body = (req.body ?? {}) as Record<string, unknown>;
	const { title, description, version } = body;
	const id = Number(req.params.id);
	if (Number.isNaN(id)) {
		return res.status(400).json({ error: "invalid card id" });
	}
	if ("statusId" in body) {
		return res
			.status(400)
			.json({ error: "statusId is not accepted for card updates" });
	}
	if (version !== undefined && !Number.isInteger(version)) {
		return res.status(400).json({ error: "version must be an integer" });
	}

	// Presence (not null) decides whether a field is touched: an explicit null
	// clears a nullable column, an absent key leaves it untouched.
	const hasTitle = "title" in body;
	const hasDescription = "description" in body;
	const hasAssigneeIds = "assigneeIds" in body;
	const hasDueDate = "dueDate" in body;
	const hasPriorityId = "priorityId" in body;
	const hasLabelIds = "labelIds" in body;
	const hasProjectPhase = "projectId" in body || "phaseId" in body;

	const setFields: {
		title?: string;
		description?: string;
		due_date?: string | null;
		priority_id?: number | null;
		project_id?: number | null;
		phase_id?: number | null;
	} = {};

	if (hasTitle) {
		const v = validateCardTitle(title as string);
		if (!v.valid) return res.status(400).json({ error: v.error });
		setFields.title = v.trimmed as string;
	}
	if (hasDescription) {
		const v = validateCardDescription(description as string);
		if (!v.valid) return res.status(400).json({ error: v.error });
		setFields.description = v.trimmed as string;
	}
	if (hasDueDate) {
		const dueDate = body.dueDate;
		if (dueDate === null) {
			setFields.due_date = null;
		} else {
			const v = validateDueDate(dueDate as string);
			if (!v.valid) return res.status(400).json({ error: v.error });
			setFields.due_date = v.trimmed as string;
		}
	}

	let parsedAssigneeIds: number[] | undefined;
	if (hasAssigneeIds) {
		const parsed = await parseAssigneeIds(body, workspaceId);
		if ("error" in parsed) {
			return res.status(400).json({ error: parsed.error });
		}
		parsedAssigneeIds = parsed;
	}

	if (hasPriorityId) {
		const parsed = await parsePriorityId(body, workspaceId);
		if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
			return res.status(400).json({ error: parsed.error });
		}
		setFields.priority_id = parsed;
	}

	let parsedLabelIds: number[] | undefined;
	if (hasLabelIds) {
		const parsed = await parseLabelIds(body, workspaceId);
		if ("error" in parsed) {
			return res.status(400).json({ error: parsed.error });
		}
		parsedLabelIds = parsed;
	}

	const hasSets = Object.keys(setFields).length > 0 || hasProjectPhase;
	if (!hasSets && !hasAssigneeIds && !hasLabelIds) {
		return res.status(400).json({ error: "no updatable fields provided" });
	}

	type TxResult =
		| { kind: "not_found" }
		| { kind: "bad_request"; error: string }
		| { kind: "conflict"; card: ReturnType<typeof mapCardResponse> | null }
		| {
				kind: "ok";
				updated: CardDbRow;
				prevDueDate: string | null | undefined;
				prevAssigneeIds: number[];
				assigneeSync?: { added: number[] };
		  };

	const result: TxResult = await db.transaction().execute(async (trx) => {
		const lockedRow = await trx
			.selectFrom("cards")
			.select([
				sql<string | null>`due_date::text`.as("due_date"),
				"project_id",
			])
			.where("id", "=", id)
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.forUpdate()
			.executeTakeFirst();
		if (!lockedRow) {
			return { kind: "not_found" };
		}
		const prevDueDate = lockedRow.due_date;
		const prevAssigneeIds = await getCardAssigneeIds(trx, id);

		const trxSetFields = { ...setFields };
		if (hasProjectPhase) {
			const parsed = await parseCardProjectPhase(
				body,
				workspaceId,
				lockedRow.project_id,
			);
			if ("error" in parsed) {
				return { kind: "bad_request", error: parsed.error };
			}
			if (parsed.projectId !== undefined) {
				trxSetFields.project_id = parsed.projectId;
			}
			if (parsed.phaseId !== undefined) {
				trxSetFields.phase_id = parsed.phaseId;
			}
		}

		let updated: CardDbRow;
		if (hasSets) {
			const updatedRow = await trx
				.updateTable("cards")
				.set({ ...trxSetFields, version: sql`version + 1` })
				.where("id", "=", id)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.$if(version !== undefined, (qb) =>
					qb.where("version", "=", version as number),
				)
				.returning([
					"id",
					"column_id",
					"title",
					"description",
					"position",
					"version",
					"created_at",
					"started_at",
					"done_at",
					sql<string | null>`due_date::text`.as("due_date"),
				])
				.executeTakeFirst();

			if (!updatedRow) {
				const current = await selectFullCard(trx)
					.where("c.id", "=", id)
					.where("c.workspace_id", "=", workspaceId)
					.where("c.deleted_at", "is", null)
					.executeTakeFirst();
				if (!current) return { kind: "not_found" };
				const [assigneesByCard, labelsByCard] = await Promise.all([
					loadCardAssigneesForCards(trx, [id]),
					loadCardLabelsForCards(trx, [id]),
				]);
				return {
					kind: "conflict",
					card: mapCardResponse(toCardDbRow(current), {
						assignees: assigneesByCard.get(id) ?? [],
						labels: labelsByCard.get(id) ?? [],
					}),
				};
			}
			updated = {
				id: updatedRow.id,
				column_id: updatedRow.column_id,
				title: updatedRow.title,
				description: updatedRow.description,
				position: updatedRow.position,
				version: updatedRow.version,
				created_at: updatedRow.created_at.toISOString(),
				started_at: updatedRow.started_at?.toISOString() ?? null,
				done_at: updatedRow.done_at?.toISOString() ?? null,
				due_date: updatedRow.due_date,
			};
		} else {
			const current = await selectFullCard(trx)
				.where("c.id", "=", id)
				.where("c.workspace_id", "=", workspaceId)
				.where("c.deleted_at", "is", null)
				.executeTakeFirst();
			if (!current) return { kind: "not_found" };
			updated = toCardDbRow(current);

			const bump = await trx
				.updateTable("cards")
				.set({ version: sql`version + 1` })
				.where("id", "=", id)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.$if(version !== undefined, (qb) =>
					qb.where("version", "=", version as number),
				)
				.returning("version")
				.executeTakeFirst();
			if (!bump) return { kind: "conflict", card: null };
			updated.version = bump.version;
		}

		let assigneeSync: { added: number[] } | undefined;
		if (hasAssigneeIds && parsedAssigneeIds !== undefined) {
			assigneeSync = await syncCardAssignees(trx, id, parsedAssigneeIds);
		}

		if (hasLabelIds && parsedLabelIds !== undefined) {
			await syncCardLabels(trx, id, parsedLabelIds);
		}

		await recordActivity(trx, req.user!, workspaceId, "update", {
			cardId: id,
			payload: {
				cardTitle: updated.title,
				changed: [
					hasTitle && "title",
					hasDescription && "description",
					hasAssigneeIds && "assignees",
					hasDueDate && "dueDate",
					hasPriorityId && "priority",
					hasLabelIds && "labels",
					hasProjectPhase && "project",
					hasProjectPhase && "phase",
				].filter(Boolean),
			},
		});

		return { kind: "ok", updated, prevDueDate, prevAssigneeIds, assigneeSync };
	});

	if (result.kind === "not_found") {
		return res.status(404).json({ error: "card not found" });
	}
	if (result.kind === "bad_request") {
		return res.status(400).json({ error: result.error });
	}
	if (result.kind === "conflict") {
		if (result.card) {
			return res.status(409).json({
				error: "Someone else updated this card first.",
				code: "version_conflict",
				card: result.card,
			});
		}
		return res.status(409).json({
			error: "Someone else updated this card first.",
			code: "version_conflict",
		});
	}

	const { updated, prevDueDate, prevAssigneeIds, assigneeSync } = result;

	await publishCardWorkspaceEvent(workspaceId, {
		type: "card.updated",
		actor: req.user!,
		cardId: id,
	});

	const assigneesByCard = await loadCardAssigneesForCards(db, [id]);
	const currentAssigneeIds = (assigneesByCard.get(id) ?? []).map((a) => a.id);

	if (assigneeSync) {
		for (const assigneeId of assigneeSync.added) {
			emitCardAssigned(
				workspaceId,
				req.user!.id,
				id,
				updated.title,
				req.user!.displayName,
				assigneeId,
			);
		}
	}

	if (hasDueDate && updated.due_date !== (prevDueDate ?? null)) {
		emitDueDateChange(
			workspaceId,
			req.user!.id,
			id,
			updated.title,
			req.user!.displayName,
			currentAssigneeIds.length > 0 ? currentAssigneeIds : prevAssigneeIds,
			prevDueDate ?? null,
			updated.due_date,
		);
	}

	const responseRow = await selectFullCard(db)
		.where("c.id", "=", id)
		.where("c.workspace_id", "=", workspaceId)
		.where("c.deleted_at", "is", null)
		.executeTakeFirst();
	if (!responseRow) return res.status(404).json({ error: "card not found" });
	const labelsByCard = await loadCardLabelsForCards(db, [id]);
	res.json(
		mapCardResponse(responseRow, {
			assignees: assigneesByCard.get(id) ?? [],
			labels: labelsByCard.get(id) ?? [],
		}),
	);
});

cardsRouter.delete("/cards/:id", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const id = Number(req.params.id);
	if (Number.isNaN(id)) {
		return res.status(400).json({ error: "invalid card id" });
	}
	const { version } = (req.body ?? {}) as { version?: unknown };
	if (version !== undefined && !Number.isInteger(version)) {
		return res.status(400).json({ error: "version must be an integer" });
	}

	type DeleteResult =
		| { kind: "not_found" }
		| { kind: "conflict" }
		| { kind: "ok"; title: string; column_id: number };

	const result: DeleteResult = await db.transaction().execute(async (trx) => {
		const row = await trx
			.updateTable("cards")
			.set({ deleted_at: sql`now()` })
			.where("id", "=", id)
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.$if(version !== undefined, (qb) =>
				qb.where("version", "=", version as number),
			)
			.returning(["title", "column_id"])
			.executeTakeFirst();
		if (!row) {
			const current = await trx
				.selectFrom("cards")
				.select("id")
				.where("id", "=", id)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.executeTakeFirst();
			return current ? { kind: "conflict" } : { kind: "not_found" };
		}
		await recordActivity(trx, req.user!, workspaceId, "delete", {
			fromColumnId: row.column_id,
			payload: { cardTitle: row.title },
		});
		return { kind: "ok", title: row.title, column_id: row.column_id };
	});

	if (result.kind === "not_found") {
		return res.status(404).json({ error: "card not found" });
	}
	if (result.kind === "conflict") {
		return res.status(409).json({
			error: "Someone else updated this card first.",
			code: "version_conflict",
		});
	}

	await publishCardWorkspaceEvent(workspaceId, {
		type: "card.deleted",
		actor: req.user!,
		cardId: id,
	});
	domainBus.emit(EVENTS.CARD_DELETED, {
		type: EVENTS.CARD_DELETED,
		workspaceId,
		actorId: req.user!.id,
		payload: { cardId: id },
	});
	res.status(204).end();
});

// ---- Move (the WIP-enforced core flow) --------------------------------------

cardsRouter.post(
	"/cards/:id/move",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const cardId = Number(req.params.id);
		if (Number.isNaN(cardId)) {
			return res.status(400).json({ error: "invalid card id" });
		}
		const { toColumnId, index, version, statusId } = req.body ?? {};
		if (statusId !== undefined) {
			return res
				.status(400)
				.json({ error: "statusId is not accepted for card moves" });
		}
		if (
			!Number.isInteger(toColumnId) ||
			!Number.isInteger(index) ||
			index < 0
		) {
			return res
				.status(400)
				.json({ error: "toColumnId and index are required" });
		}
		if (version !== undefined && !Number.isInteger(version)) {
			return res.status(400).json({ error: "version must be an integer" });
		}

		type MoveResult =
			| { kind: "not_found_card" }
			| { kind: "conflict" }
			| { kind: "not_found_column" }
			| { kind: "wip"; reason?: string }
			| {
					kind: "ok";
					isSameColumn: boolean;
					cardTitle: string;
					addedSignableAssignee: number | null;
			  };

		const result: MoveResult = await db.transaction().execute(async (trx) => {
			const card = await trx
				.selectFrom("cards")
				.select([
					"id",
					"column_id",
					"title",
					"version",
					"started_at",
					"done_at",
				])
				.where("id", "=", cardId)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.forUpdate()
				.executeTakeFirst();
			if (!card) return { kind: "not_found_card" };

			if (version !== undefined && card.version !== version) {
				return { kind: "conflict" };
			}

			const target = await trx
				.selectFrom("columns")
				.select([
					"id",
					"board_id",
					"wip_limit",
					"is_done",
					"is_signable",
					"signable_assignee_id",
					sql<boolean>`(position = (SELECT MIN(position) FROM columns WHERE workspace_id = ${workspaceId}))`.as(
						"is_first",
					),
				])
				.where("id", "=", toColumnId)
				.where("workspace_id", "=", workspaceId)
				.forUpdate()
				.executeTakeFirst();
			if (!target) return { kind: "not_found_column" };

			const isSameColumn = card.column_id === toColumnId;

			let destinationStatusId: number | undefined;
			if (!isSameColumn) {
				const siblingColumns = await trx
					.selectFrom("columns")
					.select(["id", "position", "is_done"])
					.where("workspace_id", "=", workspaceId)
					.where(
						sql<boolean>`board_id IS NOT DISTINCT FROM ${target.board_id}`,
					)
					.orderBy("position")
					.orderBy("id")
					.execute();

				const slot = mapColumnSlots(siblingColumns).get(toColumnId);
				if (!slot) {
					throw new Error(
						"Destination column is not in the workspace board geometry",
					);
				}

				const statusRows = await trx
					.selectFrom("tracker_vocabularies")
					.select(["id", "kind", "slot"])
					.where("workspace_id", "=", workspaceId)
					.where("kind", "=", "status")
					.execute();
				const resolvedStatusId = statusIdForSlot(statusRows, slot);
				if (resolvedStatusId === null) {
					throw new Error(`Status vocabulary missing for slot: ${slot}`);
				}
				destinationStatusId = resolvedStatusId;
			}

			const siblings = await trx
				.selectFrom("cards")
				.select(["id", "position"])
				.where("column_id", "=", toColumnId)
				.where("workspace_id", "=", workspaceId)
				.where("id", "<>", cardId)
				.where("deleted_at", "is", null)
				.orderBy("position")
				.forUpdate()
				.execute();

			const wip = checkWipLimit({
				currentCount: siblings.length,
				wipLimit: target.wip_limit,
				isSameColumn,
			});
			if (!wip.allowed) return { kind: "wip", reason: wip.reason };

			let position: number;
			try {
				const { before, after } = neighborsAt(
					siblings.map((s) => Number(s.position)),
					index,
				);
				position = positionBetween(before, after);
			} catch {
				const fresh = rebalance(siblings.length);
				for (let i = 0; i < siblings.length; i++) {
					await trx
						.updateTable("cards")
						.set({ position: fresh[i] })
						.where("id", "=", siblings[i].id)
						.execute();
				}
				const { before, after } = neighborsAt(fresh, index);
				position = positionBetween(before, after);
			}

			await trx
				.updateTable("cards")
				.set({
					column_id: toColumnId,
					position,
					version: sql`version + 1`,
					...(destinationStatusId !== undefined
						? { status_id: destinationStatusId }
						: {}),
					started_at: sql`CASE WHEN started_at IS NULL AND (${target.is_done} OR NOT ${target.is_first}) THEN now() ELSE started_at END`,
					done_at: sql`CASE WHEN ${target.is_done} THEN COALESCE(done_at, now()) ELSE NULL END`,
				})
				.where("id", "=", cardId)
				.execute();

			let addedSignableAssignee: number | null = null;
			if (
				target.is_signable &&
				target.signable_assignee_id != null &&
				!isSameColumn
			) {
				const added = await addCardAssignee(
					trx,
					cardId,
					target.signable_assignee_id,
				);
				if (added) {
					addedSignableAssignee = target.signable_assignee_id;
				}
			}

			await recordActivity(
				trx,
				req.user!,
				workspaceId,
				isSameColumn ? "reorder" : "move",
				{
					cardId,
					fromColumnId: card.column_id,
					toColumnId,
					payload: { cardTitle: card.title },
				},
			);

			return {
				kind: "ok",
				isSameColumn,
				cardTitle: card.title,
				addedSignableAssignee,
			};
		});

		if (result.kind === "not_found_card") {
			return res.status(404).json({ error: "card not found" });
		}
		if (result.kind === "conflict") {
			return res.status(409).json({
				error: "Someone else moved this card first.",
				code: "version_conflict",
			});
		}
		if (result.kind === "not_found_column") {
			return res.status(404).json({ error: "column not found" });
		}
		if (result.kind === "wip") {
			return res.status(409).json({
				error: "WIP limit reached for this column",
				reason: result.reason,
			});
		}

		await publishCardWorkspaceEvent(workspaceId, {
			type: result.isSameColumn ? "card.reordered" : "card.moved",
			actor: req.user!,
			cardId,
		});

		if (result.addedSignableAssignee !== null) {
			emitCardAssigned(
				workspaceId,
				req.user!.id,
				cardId,
				result.cardTitle,
				req.user!.displayName,
				result.addedSignableAssignee,
			);
		}

		const cardResponse = await hydrateCard(cardId, workspaceId);
		res.json(cardResponse);
	},
);
