import { Router } from "express";
import { sql } from "kysely";
import {
	neighborsAt,
	POSITION_GAP,
	positionBetween,
	rebalance,
} from "../core/position.js";
import { checkWipLimit } from "../core/wip.js";
import { db, type DBExecutor } from "../db/kysely.js";
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
	type CardAssignee,
} from "./card-assignees.js";
import {
	createScopedBoardService,
	lookupMembership,
	parseWorkspaceId,
	recordActivity,
} from "./helpers.js";

export const cardsRouter = Router({ mergeParams: true });

function selectFullCard(dbExec: DBExecutor) {
	return dbExec.selectFrom("cards as c").select([
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
	]);
}

type FullCardRow = {
	id: number;
	workspace_id: number;
	column_id: number;
	title: string;
	description: string;
	position: number;
	version: number;
	created_at: Date;
	started_at: Date | null;
	done_at: Date | null;
	due_date: string | null;
};

type CardDbRow = {
	id: number;
	column_id: number;
	title: string;
	description: string;
	position: number;
	version: number;
	created_at: string;
	started_at: string | null;
	done_at: string | null;
	due_date: string | null;
};

function toCardDbRow(row: FullCardRow): CardDbRow {
	return {
		id: row.id,
		column_id: row.column_id,
		title: row.title,
		description: row.description,
		position: row.position,
		version: row.version,
		created_at: row.created_at.toISOString(),
		started_at: row.started_at?.toISOString() ?? null,
		done_at: row.done_at?.toISOString() ?? null,
		due_date: row.due_date,
	};
}

function mapCardResponse(c: CardDbRow, assignees: CardAssignee[]) {
	return {
		id: c.id,
		columnId: c.column_id,
		title: c.title,
		description: c.description,
		position: c.position,
		version: c.version,
		createdAt: c.created_at,
		startedAt: c.started_at,
		doneAt: c.done_at,
		dueDate: c.due_date,
		assignees,
	};
}

async function hydrateCard(cardId: number, workspaceId: number) {
	const row = await selectFullCard(db)
		.where("c.id", "=", cardId)
		.where("c.workspace_id", "=", workspaceId)
		.where("c.deleted_at", "is", null)
		.executeTakeFirst();
	if (!row) return null;
	const assigneesByCard = await loadCardAssigneesForCards(db, [cardId]);
	return mapCardResponse(toCardDbRow(row), assigneesByCard.get(cardId) ?? []);
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
			const assigneesByCard = await loadCardAssigneesForCards(db, [cId]);
			return {
				id: row.id,
				workspaceId: row.workspace_id,
				title: row.title,
				columnId: row.column_id,
				description: row.description,
				position: row.position,
				version: row.version,
				createdAt: row.created_at.toISOString(),
				startedAt: row.started_at?.toISOString() ?? null,
				doneAt: row.done_at?.toISOString() ?? null,
				dueDate: row.due_date,
				assignees: assigneesByCard.get(cId) ?? [],
			};
		},
		getBoardRows: async () => [],
		getActivityRows: async () => [],
	}).getCard({ userId: req.user!.id, workspaceId, cardId });

	if ("status" in result) {
		return res.status(result.status).json({ error: result.error });
	}
	res.json(result);
});

cardsRouter.post("/cards", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const { columnId, title, description } = req.body ?? {};
	const titleValidation = validateCardTitle(title ?? "");
	if (!titleValidation.valid) {
		return res.status(400).json({ error: titleValidation.error });
	}
	const descValidation = validateCardDescription(description ?? "");
	if (!descValidation.valid) {
		return res.status(400).json({ error: descValidation.error });
	}
	type CreateResult =
		| { kind: "not_found_column" }
		| { kind: "wip" }
		| { kind: "ok"; cardId: number; autoAssigneeId: number | null };

	const result: CreateResult = await db.transaction().execute(async (trx) => {
		// Lock the column row first so concurrent creates targeting the same
		// column serialize on the WIP count instead of racing past it together.
		const col = await trx
			.selectFrom("columns")
			.select(["id", "wip_limit", "is_signable", "signable_assignee_id"])
			.where("id", "=", Number(columnId))
			.where("workspace_id", "=", workspaceId)
			.forUpdate()
			.executeTakeFirst();
		if (!col) {
			return { kind: "not_found_column" };
		}
		const countRow = await trx
			.selectFrom("cards")
			.select(sql<number>`count(*)::int`.as("n"))
			.where("column_id", "=", Number(columnId))
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.executeTakeFirstOrThrow();
		const wip = checkWipLimit({
			currentCount: countRow.n,
			wipLimit: col.wip_limit,
			isSameColumn: false,
		});
		if (!wip.allowed) {
			return { kind: "wip" };
		}
		const autoAssigneeId =
			col.is_signable && col.signable_assignee_id ? col.signable_assignee_id : null;

		const inserted = await trx
			.insertInto("cards")
			.values({
				column_id: Number(columnId),
				title: titleValidation.trimmed as string,
				description: descValidation.trimmed ?? "",
				position: sql<number>`COALESCE((SELECT MAX(position) FROM cards WHERE column_id = ${Number(columnId)}), 0) + ${POSITION_GAP}`,
				workspace_id: workspaceId,
			})
			.returning("id")
			.executeTakeFirstOrThrow();

		if (autoAssigneeId !== null) {
			await addCardAssignee(trx, inserted.id, autoAssigneeId);
		}
		await recordActivity(trx, req.user!, workspaceId, "create", {
			cardId: inserted.id,
			toColumnId: Number(columnId),
			payload: { cardTitle: titleValidation.trimmed },
		});
		return { kind: "ok", cardId: inserted.id, autoAssigneeId };
	});

	if (result.kind === "not_found_column") {
		return res.status(404).json({ error: "column not found" });
	}
	if (result.kind === "wip") {
		return res.status(409).json({ error: "WIP limit reached for this column" });
	}
	const { cardId, autoAssigneeId } = result;

	await publishEvent(workspaceId, {
		type: "card.created",
		actor: req.user!,
		cardId,
	});

	const card = await hydrateCard(cardId, workspaceId);
	if (autoAssigneeId !== null) {
		emitCardAssigned(
			workspaceId,
			req.user!.id,
			cardId,
			card!.title,
			req.user!.displayName,
			autoAssigneeId,
		);
	}
	res.status(201).json(card);
});

cardsRouter.patch("/cards/:id", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const body = (req.body ?? {}) as Record<string, unknown>;
	const { title, description, version } = body;
	const id = Number(req.params.id);
	if (Number.isNaN(id)) {
		return res.status(400).json({ error: "invalid card id" });
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

	const setFields: {
		title?: string;
		description?: string;
		due_date?: string | null;
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

	const hasSets = Object.keys(setFields).length > 0;
	if (!hasSets && !hasAssigneeIds) {
		return res.status(400).json({ error: "no updatable fields provided" });
	}

	type TxResult =
		| { kind: "not_found" }
		| { kind: "conflict"; card: ReturnType<typeof mapCardResponse> | null }
		| {
				kind: "ok";
				updated: CardDbRow;
				prevDueDate: string | null | undefined;
				prevAssigneeIds: number[];
				assigneeSync?: { added: number[] };
		  };

	const result: TxResult = await db.transaction().execute(async (trx) => {
		const prevRow = await trx
			.selectFrom("cards")
			.select(sql<string | null>`due_date::text`.as("due_date"))
			.where("id", "=", id)
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.executeTakeFirst();
		const prevDueDate = prevRow?.due_date;
		const prevAssigneeIds = await getCardAssigneeIds(trx, id);

		let updated: CardDbRow;
		if (hasSets) {
			const updatedRow = await trx
				.updateTable("cards")
				.set({ ...setFields, version: sql`version + 1` })
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
				const assigneesByCard = await loadCardAssigneesForCards(trx, [id]);
				return {
					kind: "conflict",
					card: mapCardResponse(
						toCardDbRow(current),
						assigneesByCard.get(id) ?? [],
					),
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

		await recordActivity(trx, req.user!, workspaceId, "update", {
			cardId: id,
			payload: {
				cardTitle: updated.title,
				changed: [
					hasTitle && "title",
					hasDescription && "description",
					hasAssigneeIds && "assignees",
					hasDueDate && "dueDate",
				].filter(Boolean),
			},
		});

		return { kind: "ok", updated, prevDueDate, prevAssigneeIds, assigneeSync };
	});

	if (result.kind === "not_found") {
		return res.status(404).json({ error: "card not found" });
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

	await publishEvent(workspaceId, {
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

	res.json(mapCardResponse(updated, assigneesByCard.get(id) ?? []));
});

cardsRouter.delete("/cards/:id", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const id = Number(req.params.id);
	if (Number.isNaN(id)) {
		return res.status(400).json({ error: "invalid card id" });
	}
	const deleted = await db.transaction().execute(async (trx) => {
		const row = await trx
			.updateTable("cards")
			.set({ deleted_at: sql`now()` })
			.where("id", "=", id)
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.returning(["title", "column_id"])
			.executeTakeFirst();
		if (!row) return null;
		await recordActivity(trx, req.user!, workspaceId, "delete", {
			fromColumnId: row.column_id,
			payload: { cardTitle: row.title },
		});
		return row;
	});
	if (!deleted) return res.status(404).json({ error: "card not found" });
	await publishEvent(workspaceId, {
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
		const { toColumnId, index, version } = req.body ?? {};
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
				.select(["id", "column_id", "title", "version", "started_at", "done_at"])
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
				.executeTakeFirst();
			if (!target) return { kind: "not_found_column" };

			const isSameColumn = card.column_id === toColumnId;

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

		await publishEvent(workspaceId, {
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
