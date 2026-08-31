import { Router } from "express";
import { sql } from "kysely";
import { neighborsAt, positionBetween, rebalance } from "../core/position.js";
import {
	derivePrefix,
	formatKey,
	parseKeyFromUrl,
} from "../core/tracker-key.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { publishEvent } from "../realtime.js";
import { diffIds } from "../core/diff-ids.js";
import { recordTrackerActivity } from "./tracker-activity.js";
import {
	loadTrackerAssigneesForItems,
	syncTrackerItemAssignees,
	type TrackerItemAssignee,
} from "./tracker-assignees.js";
import {
	parseAssigneeIds,
	parseDateRange,
	parseLabelIds,
	parseProjectPhase,
} from "./tracker-item-parsers.js";
import {
	serializeVocabulary,
	type VocabularyRow,
} from "./vocabulary-response.js";

export const trackerItemsRouter = Router({ mergeParams: true });

function routeKeyParam(raw: string | string[]): string {
	return Array.isArray(raw) ? (raw[0] ?? "") : raw;
}

type ItemRow = {
	id: number;
	key_number: number;
	title: string;
	description: string;
	version: number;
	created_at: Date;
	updated_at: Date;
	status_id: number;
	status_name: string;
	status_kind: string;
	status_position: number;
	status_colour: string;
	status_category: string | null;
	status_slot: string | null;
	priority_id: number | null;
	priority_name: string | null;
	priority_kind: string | null;
	priority_position: number | null;
	priority_colour: string | null;
	project_id: number | null;
	phase_id: number | null;
	start_date: Date | string | null;
	end_date: Date | string | null;
	completed_at: Date | null;
	position: number | null;
};

function formatDateOnly(value: Date | string | null): string | null {
	if (value == null) return null;
	if (typeof value === "string") return value.slice(0, 10);
	return value.toISOString().slice(0, 10);
}

function serializeItem(
	row: ItemRow,
	prefix: string,
	assignees: TrackerItemAssignee[],
	labels: VocabularyRow[] = [],
	opts?: { redirectFrom?: string },
) {
	const key = formatKey(prefix, row.key_number);
	const body: Record<string, unknown> = {
		id: row.id,
		key,
		title: row.title,
		description: row.description,
		projectId: row.project_id,
		phaseId: row.phase_id,
		startDate: formatDateOnly(row.start_date),
		endDate: formatDateOnly(row.end_date),
		completedAt: row.completed_at?.toISOString() ?? null,
		position: row.position,
		status: serializeVocabulary({
			id: row.status_id,
			kind: row.status_kind,
			name: row.status_name,
			position: row.status_position,
			colour: row.status_colour,
			category: row.status_category,
			slot: row.status_slot,
		}),
		priority:
			row.priority_id != null
				? serializeVocabulary({
						id: row.priority_id,
						kind: row.priority_kind!,
						name: row.priority_name!,
						position: row.priority_position!,
						colour: row.priority_colour!,
					})
				: null,
		labels: labels.map(serializeVocabulary),
		assignees,
		version: row.version,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString(),
	};
	if (opts?.redirectFrom) {
		body.canonicalKey = key;
		body.redirectFrom = opts.redirectFrom;
	}
	return body;
}

function selectItemRows(dbExec: DBExecutor) {
	return dbExec
		.selectFrom("tracker_items as ti")
		.innerJoin("tracker_vocabularies as st", "st.id", "ti.status_id")
		.leftJoin("tracker_vocabularies as pr", "pr.id", "ti.priority_id")
		.select([
			"ti.id",
			"ti.key_number",
			"ti.title",
			"ti.description",
			"ti.version",
			"ti.created_at",
			"ti.updated_at",
			"ti.project_id",
			"ti.phase_id",
			"ti.start_date",
			"ti.end_date",
			"ti.completed_at",
			"ti.position",
			"ti.status_id",
			"st.name as status_name",
			"st.kind as status_kind",
			"st.position as status_position",
			"st.colour as status_colour",
			"st.category as status_category",
			"st.slot as status_slot",
			"ti.priority_id",
			"pr.name as priority_name",
			"pr.kind as priority_kind",
			"pr.position as priority_position",
			"pr.colour as priority_colour",
		]);
}

async function getWorkspacePrefix(workspaceId: number): Promise<string | null> {
	const ws = await db
		.selectFrom("workspaces")
		.select("name")
		.where("id", "=", workspaceId)
		.executeTakeFirst();
	if (!ws) return null;
	return derivePrefix(ws.name);
}

async function loadLabelsForItems(
	dbExec: DBExecutor,
	itemIds: number[],
): Promise<Map<number, VocabularyRow[]>> {
	const map = new Map<number, VocabularyRow[]>();
	if (itemIds.length === 0) return map;

	const rows = await dbExec
		.selectFrom("tracker_item_labels as til")
		.innerJoin("tracker_vocabularies as tv", "tv.id", "til.vocabulary_id")
		.select([
			"til.tracker_item_id",
			"tv.id",
			"tv.kind",
			"tv.name",
			"tv.position",
			"tv.colour",
		])
		.where("til.tracker_item_id", "in", itemIds)
		.orderBy("til.tracker_item_id")
		.orderBy("tv.position")
		.execute();

	for (const row of rows) {
		const list = map.get(row.tracker_item_id) ?? [];
		list.push({
			id: row.id,
			kind: row.kind,
			name: row.name,
			position: row.position,
			colour: row.colour,
		});
		map.set(row.tracker_item_id, list);
	}
	return map;
}

async function hydrateItems(
	dbExec: DBExecutor,
	rows: ItemRow[],
	prefix: string,
) {
	const ids = rows.map((r) => r.id);
	const assigneesByItem = await loadTrackerAssigneesForItems(dbExec, ids);
	const labelsByItem = await loadLabelsForItems(dbExec, ids);
	return rows.map((row) =>
		serializeItem(
			row,
			prefix,
			assigneesByItem.get(row.id) ?? [],
			labelsByItem.get(row.id) ?? [],
		),
	);
}

async function findItemByKeyNumber(
	dbExec: DBExecutor,
	workspaceId: number,
	keyNumber: number,
) {
	return selectItemRows(dbExec)
		.where("ti.workspace_id", "=", workspaceId)
		.where("ti.key_number", "=", keyNumber)
		.where("ti.deleted_at", "is", null)
		.executeTakeFirst();
}

async function getTrackerItemLabelIds(
	dbExec: DBExecutor,
	trackerItemId: number,
): Promise<number[]> {
	const rows = await dbExec
		.selectFrom("tracker_item_labels")
		.select("vocabulary_id")
		.where("tracker_item_id", "=", trackerItemId)
		.orderBy("vocabulary_id")
		.execute();
	return rows.map((r) => r.vocabulary_id);
}

async function syncTrackerItemLabels(
	dbExec: DBExecutor,
	trackerItemId: number,
	labelIds: number[],
): Promise<void> {
	const prev = await getTrackerItemLabelIds(dbExec, trackerItemId);
	const { added, removed } = diffIds(prev, labelIds);

	if (removed.length > 0) {
		await dbExec
			.deleteFrom("tracker_item_labels")
			.where("tracker_item_id", "=", trackerItemId)
			.where("vocabulary_id", "in", removed)
			.execute();
	}
	for (const vocabularyId of added) {
		await dbExec
			.insertInto("tracker_item_labels")
			.values({ tracker_item_id: trackerItemId, vocabulary_id: vocabularyId })
			.onConflict((oc) => oc.doNothing())
			.execute();
	}
}

async function getBacklogStatusId(
	dbExec: DBExecutor,
	workspaceId: number,
): Promise<number> {
	const row = await dbExec
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.where(sql`lower(name)`, "=", "backlog")
		.executeTakeFirst();
	if (!row) {
		throw new Error("Backlog status not found for workspace");
	}
	return row.id;
}

async function getStatusCategory(
	dbExec: DBExecutor,
	workspaceId: number,
	statusId: number,
): Promise<string | null> {
	const row = await dbExec
		.selectFrom("tracker_vocabularies")
		.select("category")
		.where("id", "=", statusId)
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.executeTakeFirst();
	return row?.category ?? null;
}

async function endOfBucketPosition(
	dbExec: DBExecutor,
	workspaceId: number,
	projectId: number | null,
	phaseId: number | null,
): Promise<number> {
	let query = dbExec
		.selectFrom("tracker_items")
		.select(sql<number | null>`max(position)`.as("max_position"))
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null);

	if (projectId === null) {
		query = query.where("project_id", "is", null);
	} else {
		query = query.where("project_id", "=", projectId);
	}

	if (phaseId === null) {
		query = query.where("phase_id", "is", null);
	} else {
		query = query.where("phase_id", "=", phaseId);
	}

	const row = await query.executeTakeFirst();
	return positionBetween(row?.max_position ?? null, null);
}

async function loadBucketSiblings(
	dbExec: DBExecutor,
	workspaceId: number,
	projectId: number | null,
	phaseId: number | null,
	excludeId: number,
): Promise<Array<{ id: number; position: number }>> {
	let query = dbExec
		.selectFrom("tracker_items")
		.select([
			"id",
			sql<number>`COALESCE(position, 1e15)`.as("position"),
		])
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null)
		.where("id", "<>", excludeId)
		.orderBy(sql`COALESCE(position, 1e15)`)
		.orderBy("id")
		.forUpdate();

	if (projectId === null) {
		query = query.where("project_id", "is", null);
	} else {
		query = query.where("project_id", "=", projectId);
	}

	if (phaseId === null) {
		query = query.where("phase_id", "is", null);
	} else {
		query = query.where("phase_id", "=", phaseId);
	}

	return query.execute();
}

trackerItemsRouter.get(
	"/tracker/items",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const prefix = await getWorkspacePrefix(workspaceId);
		if (!prefix) return res.status(404).json({ error: "Not found" });

		const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

		let query = selectItemRows(db)
			.where("ti.workspace_id", "=", workspaceId)
			.where("ti.deleted_at", "is", null)
			.orderBy("ti.created_at", "asc");

		if (q) {
			const pattern = `%${q}%`;
			query = query.where((eb) =>
				eb.or([
					eb("ti.title", "ilike", pattern),
					eb("ti.description", "ilike", pattern),
					eb(sql`ti.key_number::text`, "ilike", pattern),
				]),
			);
		}

		const rows = await query.execute();
		res.json(await hydrateItems(db, rows, prefix));
	},
);

trackerItemsRouter.post(
	"/tracker/items",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;
		const body = req.body ?? {};

		const trimmedTitle =
			typeof body.title === "string" ? body.title.trim() : "";
		if (!trimmedTitle) {
			return res.status(400).json({ error: "title is required" });
		}

		const description =
			typeof body.description === "string" ? body.description : "";

		let assigneeIds: number[] = [];
		if (body.assigneeIds !== undefined) {
			const parsed = await parseAssigneeIds(body, workspaceId);
			if ("error" in parsed) {
				return res.status(400).json({ error: parsed.error });
			}
			assigneeIds = parsed;
		}

		let labelIds: number[] = [];
		if (body.labelIds !== undefined) {
			const parsed = await parseLabelIds(body, workspaceId);
			if ("error" in parsed) {
				return res.status(400).json({ error: parsed.error });
			}
			labelIds = parsed;
		}

		let projectId: number | null = null;
		let phaseId: number | null = null;
		if ("projectId" in body || "phaseId" in body) {
			const parsed = await parseProjectPhase(body, workspaceId);
			if ("error" in parsed) {
				return res.status(400).json({ error: parsed.error });
			}
			if (parsed.projectId !== undefined) projectId = parsed.projectId;
			if (parsed.phaseId !== undefined) phaseId = parsed.phaseId;
		}

		let startDate: string | null | undefined;
		let endDate: string | null | undefined;
		if ("startDate" in body || "endDate" in body) {
			const parsed = parseDateRange(body);
			if ("error" in parsed) {
				return res.status(400).json({ error: parsed.error });
			}
			if ("startDate" in body) startDate = parsed.startDate;
			if ("endDate" in body) endDate = parsed.endDate;
		}

		const prefix = await getWorkspacePrefix(workspaceId);
		if (!prefix) return res.status(404).json({ error: "Not found" });

		try {
			const created = await db.transaction().execute(async (trx) => {
				const counterRow = await trx
					.updateTable("workspaces")
					.set({
						tracker_key_counter: sql`tracker_key_counter + 1`,
					})
					.where("id", "=", workspaceId)
					.returning("tracker_key_counter")
					.executeTakeFirstOrThrow();

				const statusId =
					typeof body.statusId === "number" && Number.isInteger(body.statusId)
						? body.statusId
						: await getBacklogStatusId(trx, workspaceId);

				const priorityId =
					body.priorityId === null || body.priorityId === undefined
						? null
						: Number.isInteger(body.priorityId)
							? body.priorityId
							: null;

				const statusCategory = await getStatusCategory(
					trx,
					workspaceId,
					statusId,
				);
				const position = await endOfBucketPosition(
					trx,
					workspaceId,
					projectId,
					phaseId,
				);

				const insertValues: Record<string, unknown> = {
					workspace_id: workspaceId,
					key_number: counterRow.tracker_key_counter,
					title: trimmedTitle,
					description,
					status_id: statusId,
					priority_id: priorityId,
					project_id: projectId,
					phase_id: phaseId,
					position,
				};
				if (startDate !== undefined) insertValues.start_date = startDate;
				if (endDate !== undefined) insertValues.end_date = endDate;
				if (statusCategory === "completed") {
					insertValues.completed_at = sql`now()`;
				}

				const inserted = await trx
					.insertInto("tracker_items")
					.values(insertValues as never)
					.returning("id")
					.executeTakeFirstOrThrow();

				if (assigneeIds.length > 0) {
					await syncTrackerItemAssignees(trx, inserted.id, assigneeIds);
				}

				if (labelIds.length > 0) {
					await syncTrackerItemLabels(trx, inserted.id, labelIds);
				}

				await recordTrackerActivity(
					trx,
					actor,
					workspaceId,
					"tracker_item_created",
					{
						trackerItemId: inserted.id,
						payload: {
							title: trimmedTitle,
							key: formatKey(prefix, counterRow.tracker_key_counter),
						},
					},
				);

				return inserted.id;
			});

			const row = await findItemByKeyNumber(
				db,
				workspaceId,
				(
					await db
						.selectFrom("tracker_items")
						.select("key_number")
						.where("id", "=", created)
						.executeTakeFirstOrThrow()
				).key_number,
			);
			if (!row) return res.status(500).json({ error: "create failed" });

			const [item] = await hydrateItems(db, [row], prefix);
			await publishEvent(workspaceId, {
				type: "tracker.created",
				actor,
				trackerItemId: created,
			});
			res.status(201).json(item);
		} catch (err) {
			if (err instanceof Error && err.message.includes("Backlog")) {
				return res.status(500).json({ error: err.message });
			}
			throw err;
		}
	},
);

trackerItemsRouter.get(
	"/tracker/items/:key",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const parsed = parseKeyFromUrl(routeKeyParam(req.params.key));
		if (!parsed) {
			return res.status(400).json({ error: "invalid tracker key" });
		}

		const prefix = await getWorkspacePrefix(workspaceId);
		if (!prefix) return res.status(404).json({ error: "Not found" });

		const row = await findItemByKeyNumber(db, workspaceId, parsed.keyNumber);
		if (!row) return res.status(404).json({ error: "Not found" });

		const redirectFrom =
			parsed.prefix !== prefix
				? formatKey(parsed.prefix, parsed.keyNumber)
				: undefined;

		const [item] = await hydrateItems(db, [row], prefix);
		if (redirectFrom) {
			res.json({ ...item, canonicalKey: item.key, redirectFrom });
			return;
		}
		res.json(item);
	},
);

trackerItemsRouter.patch(
	"/tracker/items/:key/position",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;
		const parsed = parseKeyFromUrl(routeKeyParam(req.params.key));
		if (!parsed) {
			return res.status(400).json({ error: "invalid tracker key" });
		}

		const body = req.body ?? {};
		if ("projectId" in body || "phaseId" in body) {
			return res
				.status(400)
				.json({ error: "cross-bucket move not allowed on reorder" });
		}

		const { beforeId, afterId } = body as {
			beforeId?: unknown;
			afterId?: unknown;
		};
		if (beforeId !== undefined && !Number.isInteger(beforeId)) {
			return res.status(400).json({ error: "beforeId must be an integer" });
		}
		if (afterId !== undefined && !Number.isInteger(afterId)) {
			return res.status(400).json({ error: "afterId must be an integer" });
		}
		if (beforeId === undefined && afterId === undefined) {
			return res
				.status(400)
				.json({ error: "beforeId or afterId is required" });
		}

		const prefix = await getWorkspacePrefix(workspaceId);
		if (!prefix) return res.status(404).json({ error: "Not found" });

		const existing = await findItemByKeyNumber(
			db,
			workspaceId,
			parsed.keyNumber,
		);
		if (!existing) return res.status(404).json({ error: "Not found" });

		type ReorderResult =
			| { kind: "bad_neighbors" }
			| { kind: "ok" };

		const result: ReorderResult = await db.transaction().execute(async (trx) => {
			const siblings = await loadBucketSiblings(
				trx,
				workspaceId,
				existing.project_id,
				existing.phase_id,
				existing.id,
			);

			let index: number;
			if (beforeId !== undefined) {
				const idx = siblings.findIndex((s) => s.id === beforeId);
				if (idx === -1) return { kind: "bad_neighbors" };
				index = idx + 1;
			} else {
				const idx = siblings.findIndex((s) => s.id === afterId);
				if (idx === -1) return { kind: "bad_neighbors" };
				index = idx;
			}

			let position: number;
			try {
				const positions = siblings.map((s) => Number(s.position));
				const { before, after } = neighborsAt(positions, index);
				position = positionBetween(before, after);
			} catch {
				const fresh = rebalance(siblings.length);
				for (let i = 0; i < siblings.length; i++) {
					await trx
						.updateTable("tracker_items")
						.set({ position: fresh[i] })
						.where("id", "=", siblings[i].id)
						.execute();
				}
				const { before, after } = neighborsAt(fresh, index);
				position = positionBetween(before, after);
			}

			await trx
				.updateTable("tracker_items")
				.set({ position })
				.where("id", "=", existing.id)
				.execute();

			await recordTrackerActivity(
				trx,
				actor,
				workspaceId,
				"tracker_item_updated",
				{
					trackerItemId: existing.id,
					payload: {
						title: existing.title,
						changed: ["position"],
					},
				},
			);

			return { kind: "ok" };
		});

		if (result.kind === "bad_neighbors") {
			return res.status(400).json({ error: "neighbor not in bucket" });
		}

		const row = await findItemByKeyNumber(db, workspaceId, parsed.keyNumber);
		if (!row) return res.status(404).json({ error: "Not found" });

		const redirectFrom =
			parsed.prefix !== prefix
				? formatKey(parsed.prefix, parsed.keyNumber)
				: undefined;
		const [item] = await hydrateItems(db, [row], prefix);
		await publishEvent(workspaceId, {
			type: "tracker.updated",
			actor,
			trackerItemId: existing.id,
		});
		if (redirectFrom) {
			res.json({ ...item, canonicalKey: item.key, redirectFrom });
			return;
		}
		res.json(item);
	},
);

trackerItemsRouter.patch(
	"/tracker/items/:key",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;
		const parsed = parseKeyFromUrl(routeKeyParam(req.params.key));
		if (!parsed) {
			return res.status(400).json({ error: "invalid tracker key" });
		}

		const body = req.body ?? {};
		const { version } = body as { version?: unknown };
		if (version !== undefined && !Number.isInteger(version)) {
			return res.status(400).json({ error: "version must be an integer" });
		}

		const prefix = await getWorkspacePrefix(workspaceId);
		if (!prefix) return res.status(404).json({ error: "Not found" });

		const existing = await findItemByKeyNumber(
			db,
			workspaceId,
			parsed.keyNumber,
		);
		if (!existing) return res.status(404).json({ error: "Not found" });

		const setFields: Record<string, unknown> = {};
		if (typeof body.title === "string") {
			const trimmed = body.title.trim();
			if (!trimmed) {
				return res.status(400).json({ error: "title is required" });
			}
			setFields.title = trimmed;
		}
		if (typeof body.description === "string") {
			setFields.description = body.description;
		}
		if (body.statusId !== undefined) {
			if (!Number.isInteger(body.statusId)) {
				return res.status(400).json({ error: "statusId must be an integer" });
			}
			setFields.status_id = body.statusId;
		}
		if (body.priorityId !== undefined) {
			if (body.priorityId !== null && !Number.isInteger(body.priorityId)) {
				return res
					.status(400)
					.json({ error: "priorityId must be an integer or null" });
			}
			setFields.priority_id = body.priorityId;
		}

		const hasProjectPhase = "projectId" in body || "phaseId" in body;
		let parsedProjectPhase:
			| { projectId?: number | null; phaseId?: number | null }
			| undefined;
		if (hasProjectPhase) {
			const parsed = await parseProjectPhase(body, workspaceId);
			if ("error" in parsed) {
				return res.status(400).json({ error: parsed.error });
			}
			parsedProjectPhase = parsed;
			if (parsed.projectId !== undefined) {
				setFields.project_id = parsed.projectId;
			}
			if (parsed.phaseId !== undefined) {
				setFields.phase_id = parsed.phaseId;
			}
		}

		const hasDates = "startDate" in body || "endDate" in body;
		if (hasDates) {
			const parsed = parseDateRange(body);
			if ("error" in parsed) {
				return res.status(400).json({ error: parsed.error });
			}
			if ("startDate" in body) setFields.start_date = parsed.startDate;
			if ("endDate" in body) setFields.end_date = parsed.endDate;
		}

		let newProjectId = existing.project_id;
		let newPhaseId = existing.phase_id;
		if (parsedProjectPhase) {
			if (parsedProjectPhase.projectId !== undefined) {
				newProjectId = parsedProjectPhase.projectId;
			}
			if (parsedProjectPhase.phaseId !== undefined) {
				newPhaseId = parsedProjectPhase.phaseId;
			}
		}
		const bucketChanged =
			hasProjectPhase &&
			(newProjectId !== existing.project_id ||
				newPhaseId !== existing.phase_id);

		const hasAssigneeIds = body.assigneeIds !== undefined;
		let parsedAssigneeIds: number[] | undefined;
		if (hasAssigneeIds) {
			const parsedAssignees = await parseAssigneeIds(body, workspaceId);
			if ("error" in parsedAssignees) {
				return res.status(400).json({ error: parsedAssignees.error });
			}
			parsedAssigneeIds = parsedAssignees;
		}

		const hasLabelIds = body.labelIds !== undefined;
		let parsedLabelIds: number[] | undefined;
		if (hasLabelIds) {
			const parsedLabels = await parseLabelIds(body, workspaceId);
			if ("error" in parsedLabels) {
				return res.status(400).json({ error: parsedLabels.error });
			}
			parsedLabelIds = parsedLabels;
		}

		const hasSets = Object.keys(setFields).length > 0;
		if (!hasSets && !hasAssigneeIds && !hasLabelIds) {
			return res.status(400).json({ error: "no updatable fields provided" });
		}

		type TxResult =
			| { kind: "not_found" }
			| { kind: "conflict" }
			| { kind: "ok"; itemId: number };

		const result: TxResult = await db.transaction().execute(async (trx) => {
			if (bucketChanged) {
				setFields.position = await endOfBucketPosition(
					trx,
					workspaceId,
					newProjectId,
					newPhaseId,
				);
			}

			if (body.statusId !== undefined) {
				const targetCategory = await getStatusCategory(
					trx,
					workspaceId,
					body.statusId as number,
				);
				if (targetCategory === "completed") {
					setFields.completed_at = sql`COALESCE(completed_at, now())`;
				} else {
					setFields.completed_at = null;
				}
			}

			const hasSetsNow = Object.keys(setFields).length > 0;

			if (hasSetsNow) {
				const updated = await trx
					.updateTable("tracker_items")
					.set({
						...setFields,
						version: sql`version + 1`,
						updated_at: sql`now()`,
					})
					.where("id", "=", existing.id)
					.where("workspace_id", "=", workspaceId)
					.where("deleted_at", "is", null)
					.$if(version !== undefined, (qb) =>
						qb.where("version", "=", version as number),
					)
					.returning("id")
					.executeTakeFirst();

				if (!updated) {
					const current = await trx
						.selectFrom("tracker_items")
						.select("id")
						.where("id", "=", existing.id)
						.where("workspace_id", "=", workspaceId)
						.where("deleted_at", "is", null)
						.executeTakeFirst();
					return current ? { kind: "conflict" } : { kind: "not_found" };
				}
			} else if (version !== undefined) {
				const current = await trx
					.selectFrom("tracker_items")
					.select("version")
					.where("id", "=", existing.id)
					.where("workspace_id", "=", workspaceId)
					.where("deleted_at", "is", null)
					.executeTakeFirst();
				if (!current) return { kind: "not_found" };
				if (current.version !== version) return { kind: "conflict" };
			}

			if (hasAssigneeIds && parsedAssigneeIds !== undefined) {
				await syncTrackerItemAssignees(trx, existing.id, parsedAssigneeIds);
				if (!hasSetsNow) {
					await trx
						.updateTable("tracker_items")
						.set({ version: sql`version + 1`, updated_at: sql`now()` })
						.where("id", "=", existing.id)
						.where("workspace_id", "=", workspaceId)
						.where("deleted_at", "is", null)
						.$if(version !== undefined, (qb) =>
							qb.where("version", "=", version as number),
						)
						.execute();
				}
			}

			if (hasLabelIds && parsedLabelIds !== undefined) {
				await syncTrackerItemLabels(trx, existing.id, parsedLabelIds);
				if (!hasSetsNow && !hasAssigneeIds) {
					await trx
						.updateTable("tracker_items")
						.set({ version: sql`version + 1`, updated_at: sql`now()` })
						.where("id", "=", existing.id)
						.where("workspace_id", "=", workspaceId)
						.where("deleted_at", "is", null)
						.$if(version !== undefined, (qb) =>
							qb.where("version", "=", version as number),
						)
						.execute();
				}
			}

			await recordTrackerActivity(
				trx,
				actor,
				workspaceId,
				"tracker_item_updated",
				{
					trackerItemId: existing.id,
					payload: {
						title:
							typeof setFields.title === "string"
								? setFields.title
								: existing.title,
						changed: [
							setFields.title !== undefined && "title",
							setFields.description !== undefined && "description",
							setFields.status_id !== undefined && "status",
							setFields.priority_id !== undefined && "priority",
							setFields.project_id !== undefined && "project",
							setFields.phase_id !== undefined && "phase",
							(setFields.start_date !== undefined ||
								setFields.end_date !== undefined) &&
								"schedule",
							hasAssigneeIds && "assignees",
							hasLabelIds && "labels",
						].filter(Boolean),
					},
				},
			);

			return { kind: "ok", itemId: existing.id };
		});

		if (result.kind === "not_found") {
			return res.status(404).json({ error: "Not found" });
		}
		if (result.kind === "conflict") {
			return res.status(409).json({
				error: "Someone else updated this item first.",
				code: "version_conflict",
			});
		}

		const row = await findItemByKeyNumber(db, workspaceId, parsed.keyNumber);
		if (!row) return res.status(404).json({ error: "Not found" });

		const redirectFrom =
			parsed.prefix !== prefix
				? formatKey(parsed.prefix, parsed.keyNumber)
				: undefined;
		const [item] = await hydrateItems(db, [row], prefix);
		await publishEvent(workspaceId, {
			type: "tracker.updated",
			actor,
			trackerItemId: existing.id,
		});
		if (redirectFrom) {
			res.json({ ...item, canonicalKey: item.key, redirectFrom });
			return;
		}
		res.json(item);
	},
);

trackerItemsRouter.delete(
	"/tracker/items/:key",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;
		const parsed = parseKeyFromUrl(routeKeyParam(req.params.key));
		if (!parsed) {
			return res.status(400).json({ error: "invalid tracker key" });
		}

		const { version } = (req.body ?? {}) as { version?: unknown };
		if (version !== undefined && !Number.isInteger(version)) {
			return res.status(400).json({ error: "version must be an integer" });
		}

		const existing = await findItemByKeyNumber(
			db,
			workspaceId,
			parsed.keyNumber,
		);
		if (!existing) return res.status(404).json({ error: "Not found" });

		type DeleteResult =
			| { kind: "not_found" }
			| { kind: "conflict" }
			| { kind: "ok" };

		const result: DeleteResult = await db.transaction().execute(async (trx) => {
			const row = await trx
				.updateTable("tracker_items")
				.set({ deleted_at: sql`now()`, updated_at: sql`now()` })
				.where("id", "=", existing.id)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.$if(version !== undefined, (qb) =>
					qb.where("version", "=", version as number),
				)
				.returning(["id", "title"])
				.executeTakeFirst();

			if (!row) {
				const current = await trx
					.selectFrom("tracker_items")
					.select("id")
					.where("id", "=", existing.id)
					.where("workspace_id", "=", workspaceId)
					.where("deleted_at", "is", null)
					.executeTakeFirst();
				return current ? { kind: "conflict" } : { kind: "not_found" };
			}

			await recordTrackerActivity(
				trx,
				actor,
				workspaceId,
				"tracker_item_deleted",
				{
					trackerItemId: row.id,
					payload: { title: row.title },
				},
			);

			return { kind: "ok" };
		});

		if (result.kind === "not_found") {
			return res.status(404).json({ error: "Not found" });
		}
		if (result.kind === "conflict") {
			return res.status(409).json({
				error: "Someone else updated this item first.",
				code: "version_conflict",
			});
		}

		await publishEvent(workspaceId, {
			type: "tracker.deleted",
			actor,
			trackerItemId: existing.id,
		});
		res.status(204).send();
	},
);

function trackerEventSelect() {
	return db
		.selectFrom("tracker_events as e")
		.leftJoin("users as u", "u.id", "e.actor_id")
		.leftJoin("tracker_items as ti", (join) =>
			join
				.onRef("ti.id", "=", "e.tracker_item_id")
				.on("ti.deleted_at", "is", null),
		)
		.select([
			"e.id",
			"e.event_type",
			"e.payload",
			"e.created_at",
			"e.tracker_item_id",
			"u.username",
			"u.display_name",
			"ti.title as current_item_title",
		]);
}

function toTrackerEvent(e: {
	id: number;
	event_type: string;
	payload: unknown;
	created_at: Date;
	tracker_item_id: number | null;
	username: string | null;
	display_name: string | null;
	current_item_title: string | null;
}) {
	const payload = e.payload as
		| { title?: string }
		| Record<string, unknown>
		| null;
	return {
		id: e.id,
		eventType: e.event_type,
		trackerItemId: e.tracker_item_id,
		title: e.current_item_title ?? payload?.title ?? null,
		payload: payload ?? null,
		actor: e.username
			? { username: e.username, displayName: e.display_name }
			: null,
		createdAt: e.created_at.toISOString(),
	};
}

trackerItemsRouter.get(
	"/tracker/items/:key/events",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const parsed = parseKeyFromUrl(routeKeyParam(req.params.key));
		if (!parsed) {
			return res.status(400).json({ error: "invalid tracker key" });
		}

		const item = await findItemByKeyNumber(db, workspaceId, parsed.keyNumber);
		if (!item) return res.status(404).json({ error: "Not found" });

		const rows = await trackerEventSelect()
			.where("e.tracker_item_id", "=", item.id)
			.where("e.workspace_id", "=", workspaceId)
			.orderBy("e.created_at", "desc")
			.orderBy("e.id", "desc")
			.execute();

		res.json({ events: rows.map(toTrackerEvent) });
	},
);
