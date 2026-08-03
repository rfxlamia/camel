import { Router } from "express";
import { sql } from "kysely";
import {
	derivePrefix,
	formatKey,
	parseKeyFromUrl,
} from "../core/tracker-key.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { lookupMembership } from "./helpers.js";
import {
	loadTrackerAssigneesForItems,
	syncTrackerItemAssignees,
	type TrackerItemAssignee,
} from "./tracker-assignees.js";
import { publishEvent } from "../realtime.js";
import { recordTrackerActivity } from "./tracker-activity.js";

export const trackerItemsRouter = Router({ mergeParams: true });

function routeKeyParam(raw: string | string[]): string {
	return Array.isArray(raw) ? (raw[0] ?? "") : raw;
}

type VocabRow = {
	id: number;
	kind: string;
	name: string;
	position: number;
	colour: string;
};

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
	priority_id: number | null;
	priority_name: string | null;
	priority_kind: string | null;
	priority_position: number | null;
	priority_colour: string | null;
};

function serializeVocab(
	row: Pick<VocabRow, "id" | "kind" | "name" | "position" | "colour"> | null,
) {
	if (!row) return null;
	return {
		id: row.id,
		kind: row.kind,
		name: row.name,
		position: row.position,
		colour: row.colour,
	};
}

function serializeItem(
	row: ItemRow,
	prefix: string,
	assignees: TrackerItemAssignee[],
	labels: VocabRow[] = [],
	opts?: { redirectFrom?: string },
) {
	const key = formatKey(prefix, row.key_number);
	const body: Record<string, unknown> = {
		id: row.id,
		key,
		title: row.title,
		description: row.description,
		status: serializeVocab({
			id: row.status_id,
			kind: row.status_kind,
			name: row.status_name,
			position: row.status_position,
			colour: row.status_colour,
		}),
		priority:
			row.priority_id != null
				? serializeVocab({
						id: row.priority_id,
						kind: row.priority_kind!,
						name: row.priority_name!,
						position: row.priority_position!,
						colour: row.priority_colour!,
					})
				: null,
		labels: labels.map((l) => serializeVocab(l)),
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
			"ti.status_id",
			"st.name as status_name",
			"st.kind as status_kind",
			"st.position as status_position",
			"st.colour as status_colour",
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
): Promise<Map<number, VocabRow[]>> {
	const map = new Map<number, VocabRow[]>();
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

		const trimmedTitle = typeof body.title === "string" ? body.title.trim() : "";
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

				const inserted = await trx
					.insertInto("tracker_items")
					.values({
						workspace_id: workspaceId,
						key_number: counterRow.tracker_key_counter,
						title: trimmedTitle,
						description,
						status_id: statusId,
						priority_id: priorityId,
					})
					.returning("id")
					.executeTakeFirstOrThrow();

				if (assigneeIds.length > 0) {
					await syncTrackerItemAssignees(trx, inserted.id, assigneeIds);
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

		const row = await findItemByKeyNumber(
			db,
			workspaceId,
			parsed.keyNumber,
		);
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

		const hasAssigneeIds = body.assigneeIds !== undefined;
		let parsedAssigneeIds: number[] | undefined;
		if (hasAssigneeIds) {
			const parsedAssignees = await parseAssigneeIds(body, workspaceId);
			if ("error" in parsedAssignees) {
				return res.status(400).json({ error: parsedAssignees.error });
			}
			parsedAssigneeIds = parsedAssignees;
		}

		const hasSets = Object.keys(setFields).length > 0;
		if (!hasSets && !hasAssigneeIds) {
			return res.status(400).json({ error: "no updatable fields provided" });
		}

		type TxResult =
			| { kind: "not_found" }
			| { kind: "conflict" }
			| { kind: "ok"; itemId: number };

		const result: TxResult = await db.transaction().execute(async (trx) => {
			if (hasSets) {
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
				if (!hasSets) {
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
							hasAssigneeIds && "assignees",
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
	const payload = e.payload as { title?: string } | null;
	return {
		id: e.id,
		eventType: e.event_type,
		trackerItemId: e.tracker_item_id,
		title: e.current_item_title ?? payload?.title ?? null,
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
