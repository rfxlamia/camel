// Anonymized pre-merge "reference workspace": 25 board cards (6 in progress,
// 16 done) plus 53 live tracker items sharing one key sequence, with projects,
// phases, labels, assignees, events and one focus session. Seeded into a
// scratch schema BEFORE the merge runs.
import type { ScratchSchema } from "../db/scratch-schema-test-support.js";
import { rows, seedWorkspace } from "../db/work-item-merge.test-support.js";

export const BOARD_CARDS = 25;
export const TRACKER_ITEMS = 53;
export const IN_PROGRESS = 6;
export const DONE = 16;
export const FOCUS_KEY = 33;

export type LegacyItem = {
	oldId: number;
	key: number;
	title: string;
	description: string;
	statusId: number;
	priorityId: number;
	projectId: number | null;
	phaseId: number | null;
	startDate: string;
	endDate: string;
	version: number;
	position: number;
	assigneeIds: number[];
	labelIds: number[];
	events: number;
	isDone: boolean;
};

export type ReferenceFixture = {
	workspaceId: number;
	userId: number;
	otherUserId: number;
	columnIds: { requested: number; inProgress: number; done: number };
	boardKeys: number[];
	trackerKeys: number[];
	trackerItems: LegacyItem[];
	focusOldId: number;
};

async function vocab(
	s: ScratchSchema,
	wsId: number,
	slot: string,
	category: string,
	position: number,
): Promise<number> {
	const r = await rows(
		s,
		`INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, slot, category)
		 VALUES ($1, 'status', $2, $3, '#000', $4, $5) RETURNING id`,
		[wsId, `Status ${slot}`, position, slot, category],
	);
	return r[0].id;
}

export async function seedReferenceWorkspace(
	s: ScratchSchema,
	tag: string,
): Promise<ReferenceFixture> {
	const ws = await seedWorkspace(s, tag);
	await s.client.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')",
		[ws.id, ws.userId, ws.otherUserId],
	);
	const inProgressStatus = await vocab(s, ws.id, "in_progress", "started", 2);
	const doneStatus = await vocab(s, ws.id, "done", "completed", 3);
	const col = async (
		title: string,
		pos: number,
		wip: number | null,
		isDone: boolean,
	) =>
		(
			await rows(
				s,
				`INSERT INTO columns (workspace_id, title, position, wip_limit, is_done)
				 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
				[ws.id, title, pos, wip, isDone],
			)
		)[0].id as number;
	const columnIds = {
		requested: await col("Requested", 1024, null, false),
		inProgress: await col("In Progress", 2048, 8, false),
		done: await col("Finished", 3072, null, true),
	};

	const [project] = await rows(
		s,
		"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'Project One', 1024) RETURNING id",
		[ws.id],
	);
	const phases: number[] = [];
	for (const [i, name] of ["Phase A", "Phase B"].entries()) {
		const [p] = await rows(
			s,
			"INSERT INTO tracker_phases (project_id, name, position) VALUES ($1, $2, $3) RETURNING id",
			[project.id, name, 1024 * (i + 1)],
		);
		phases.push(p.id);
	}

	const boardKeys: number[] = [];
	const trackerKeys: number[] = [];
	const trackerItems: LegacyItem[] = [];
	let boardIndex = 0;
	for (let k = 1; k <= BOARD_CARDS + TRACKER_ITEMS; k++) {
		if (k % 3 === 1 && boardKeys.length < BOARD_CARDS) {
			boardKeys.push(k);
			const state =
				boardIndex < DONE
					? "done"
					: boardIndex < DONE + IN_PROGRESS
						? "progress"
						: "new";
			const columnId =
				state === "done"
					? columnIds.done
					: state === "progress"
						? columnIds.inProgress
						: columnIds.requested;
			const statusId =
				state === "done"
					? doneStatus
					: state === "progress"
						? inProgressStatus
						: ws.statusId;
			const [card] = await rows(
				s,
				`INSERT INTO cards (workspace_id, column_id, title, position, key_number, status_id, version,
				                    created_at, started_at, done_at)
				 VALUES ($1, $2, $3, $4, $5, $6, 2, '2026-01-01T00:00:00Z', $7, $8) RETURNING id`,
				[
					ws.id,
					columnId,
					`card-${k}`,
					1024 * (boardIndex + 1),
					k,
					statusId,
					state === "new" ? null : "2026-01-02T00:00:00Z",
					state === "done" ? "2026-01-05T00:00:00Z" : null,
				],
			);
			await s.client.query(
				"INSERT INTO card_events (card_id, to_column_id, workspace_id, actor_id) VALUES ($1, $2, $3, $4)",
				[card.id, columnId, ws.id, ws.userId],
			);
			boardIndex++;
			continue;
		}
		trackerKeys.push(k);
		const focus = k === FOCUS_KEY;
		const withProject = focus || k % 4 === 0;
		const item: LegacyItem = {
			oldId: 0,
			key: k,
			title: `item-${k}`,
			description: `description ${k}`,
			statusId:
				k % 5 === 0 ? doneStatus : k % 2 === 0 ? inProgressStatus : ws.statusId,
			priorityId: ws.priorityId,
			projectId: withProject ? project.id : null,
			phaseId: withProject ? phases[k % 2] : null,
			startDate: "2026-03-01",
			endDate: "2026-03-09",
			version: 3,
			position: 1024 * k,
			assigneeIds: focus
				? [ws.userId, ws.otherUserId]
				: k % 3 === 0
					? [ws.userId]
					: [],
			labelIds: focus || k % 7 === 0 ? [ws.labelId] : [],
			events: focus ? 5 : k % 6 === 0 ? 1 : 0,
			isDone: k % 5 === 0,
		};
		const [row] = await rows(
			s,
			`INSERT INTO tracker_items (workspace_id, key_number, title, description, status_id, priority_id,
			   project_id, phase_id, start_date, end_date, version, position, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
			   '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z') RETURNING id`,
			[
				ws.id,
				k,
				item.title,
				item.description,
				item.statusId,
				item.priorityId,
				item.projectId,
				item.phaseId,
				item.startDate,
				item.endDate,
				item.version,
				item.position,
			],
		);
		item.oldId = row.id;
		for (const u of item.assigneeIds) {
			await s.client.query(
				"INSERT INTO tracker_item_assignees (tracker_item_id, user_id) VALUES ($1, $2)",
				[item.oldId, u],
			);
		}
		for (const l of item.labelIds) {
			await s.client.query(
				"INSERT INTO tracker_item_labels (tracker_item_id, vocabulary_id) VALUES ($1, $2)",
				[item.oldId, l],
			);
		}
		for (let e = 0; e < item.events; e++) {
			await s.client.query(
				`INSERT INTO tracker_events (tracker_item_id, actor_id, event_type, payload, workspace_id, created_at)
				 VALUES ($1, $2, 'tracker_item_updated', $3::jsonb, $4, $5)`,
				[
					item.oldId,
					ws.userId,
					JSON.stringify({ n: e }),
					ws.id,
					`2026-01-0${e + 2}T00:00:00Z`,
				],
			);
		}
		trackerItems.push(item);
	}

	// One soft-deleted row per table; neither may surface in any list.
	const lastKey = BOARD_CARDS + TRACKER_ITEMS;
	await s.client.query(
		`INSERT INTO tracker_items (workspace_id, key_number, title, status_id, deleted_at)
		 VALUES ($1, $2, 'gone-item', $3, now())`,
		[ws.id, lastKey + 1, ws.statusId],
	);
	await s.client.query(
		`INSERT INTO cards (workspace_id, column_id, title, position, key_number, status_id, deleted_at)
		 VALUES ($1, $2, 'gone-card', 99999, $3, $4, now())`,
		[ws.id, columnIds.requested, lastKey + 2, ws.statusId],
	);
	await s.client.query(
		"UPDATE workspaces SET tracker_key_counter = $2 WHERE id = $1",
		[ws.id, lastKey + 2],
	);

	const focusOldId = trackerItems.find((i) => i.key === FOCUS_KEY)!.oldId;
	await s.client.query(
		`INSERT INTO focus_sessions (user_id, workspace_id, task_source, task_id, task_key, return_path, state)
		 VALUES ($1, $2, 'tracker', $3, $4, $5, 'ready')`,
		[
			ws.userId,
			ws.id,
			focusOldId,
			`REF-${FOCUS_KEY}`,
			`/tracker/REF-${FOCUS_KEY}`,
		],
	);

	return {
		workspaceId: ws.id,
		userId: ws.userId,
		otherUserId: ws.otherUserId,
		columnIds,
		boardKeys,
		trackerKeys,
		trackerItems,
		focusOldId,
	};
}
