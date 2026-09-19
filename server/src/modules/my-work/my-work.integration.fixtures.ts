import {
	ALICE_ID,
	ATLAS_ID,
	BOB_ID,
	cleanupAll,
	type Fixtures,
	type ItemFixture,
	NEBULA_ID,
	ORBIT_ID,
	pool,
	query,
	type StatusIds,
	type WorkspaceFixture,
} from "./my-work.integration.shared.js";

function statusIds(
	rows: Array<{ id: number; slot: string | null }>,
): StatusIds {
	const bySlot = new Map(rows.map((row) => [row.slot, row.id]));
	return {
		backlog: bySlot.get("backlog")!,
		inProgress: bySlot.get("in_progress")!,
		done: bySlot.get("done")!,
		canceled: bySlot.get("canceled")!,
	};
}

async function insertUsers(): Promise<void> {
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
     VALUES
       ($1, 'my-work-alice', 'Alice', 'test'),
       ($2, 'my-work-bob', 'Bob', 'test')`,
		[ALICE_ID, BOB_ID],
	);
}

async function insertStatuses(workspaceId: number): Promise<StatusIds> {
	const rows = await query<{ id: number; slot: string | null }>(
		`INSERT INTO tracker_vocabularies
       (workspace_id, kind, name, position, colour, category, slot)
     VALUES
       ($1, 'status', 'Backlog', 1024, 'blue', 'backlog', 'backlog'),
       ($1, 'status', 'In Progress', 2048, 'blue', 'started', 'in_progress'),
       ($1, 'status', 'Done', 3072, 'blue', 'completed', 'done'),
       ($1, 'status', 'Canceled', 4096, 'blue', 'canceled', 'canceled')
     RETURNING id, slot`,
		[workspaceId],
	);
	return statusIds(rows);
}

async function insertColumns(workspaceId: number) {
	const rows = await query<{ id: number; is_done: boolean }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
     VALUES ($1, 'Todo', 1024, false), ($1, 'Done', 2048, true)
     RETURNING id, is_done`,
		[workspaceId],
	);
	return {
		todoColumnId: rows.find((row) => !row.is_done)!.id,
		doneColumnId: rows.find((row) => row.is_done)!.id,
	};
}

async function createWorkspace(
	id: number,
	name: string,
	ownerId: number,
	memberIds: number[],
): Promise<WorkspaceFixture> {
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal, tracker_key_counter)
     VALUES ($1, $2, $3, false, 0)`,
		[id, name, ownerId],
	);
	for (const memberId of memberIds) {
		await pool.query(
			`INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)`,
			[id, memberId, memberId === ownerId ? "owner" : "member"],
		);
	}
	const statuses = await insertStatuses(id);
	const columns = await insertColumns(id);
	return { id, name, statuses, ...columns };
}

function itemKey(workspace: WorkspaceFixture, keyNumber: number): string {
	return `${workspace.name.slice(0, 2).toUpperCase()}-${keyNumber}`;
}

async function insertBoardCard(
	workspace: WorkspaceFixture,
	keyNumber: number,
	title: string,
	assigneeIds: number[],
	position: number,
): Promise<ItemFixture> {
	const rows = await query<{ id: number; version: number }>(
		`INSERT INTO cards
       (workspace_id, column_id, title, description, position, key_number, status_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, version`,
		[
			workspace.id,
			workspace.todoColumnId,
			title,
			`${title} description`,
			position,
			keyNumber,
			workspace.statuses.backlog,
		],
	);
	const card = rows[0]!;
	for (const userId of assigneeIds) {
		await pool.query(
			"INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2)",
			[card.id, userId],
		);
	}
	return {
		id: card.id,
		keyNumber,
		key: itemKey(workspace, keyNumber),
		version: card.version,
	};
}

async function insertTrackerItem(
	workspace: WorkspaceFixture,
	keyNumber: number,
	title: string,
	assigneeIds: number[],
	position: number,
	statusId = workspace.statuses.inProgress,
): Promise<ItemFixture> {
	const rows = await query<{ id: number; version: number }>(
		`INSERT INTO tracker_items
       (workspace_id, key_number, title, description, status_id, position)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, version`,
		[
			workspace.id,
			keyNumber,
			title,
			`${title} description`,
			statusId,
			position,
		],
	);
	const item = rows[0]!;
	for (const userId of assigneeIds) {
		await pool.query(
			"INSERT INTO tracker_item_assignees (tracker_item_id, user_id) VALUES ($1, $2)",
			[item.id, userId],
		);
	}
	return {
		id: item.id,
		keyNumber,
		key: itemKey(workspace, keyNumber),
		version: item.version,
	};
}

async function atlasItems(atlas: WorkspaceFixture) {
	return {
		atlasShadow: await insertBoardCard(
			atlas,
			17,
			"Atlas board shadow",
			[ALICE_ID],
			1024,
		),
		atlasBoard: await insertBoardCard(
			atlas,
			18,
			"Atlas Board assigned work",
			[ALICE_ID],
			2048,
		),
		atlasTracker: await insertTrackerItem(
			atlas,
			17,
			"Atlas tracker winner",
			[ALICE_ID, BOB_ID],
			1024,
		),
	};
}

async function orbitItems(orbit: WorkspaceFixture) {
	return {
		orbitBoard: await insertBoardCard(
			orbit,
			17,
			"Orbit Board same key",
			[ALICE_ID],
			1024,
		),
		orbitTracker: await insertTrackerItem(
			orbit,
			4,
			"Orbit Tracker assigned work",
			[ALICE_ID, BOB_ID],
			1024,
		),
	};
}

async function nebulaItems(nebula: WorkspaceFixture) {
	return {
		nebulaTracker: await insertTrackerItem(
			nebula,
			9,
			"Nebula secret assigned work",
			[ALICE_ID],
			1024,
		),
	};
}

export async function setupFixtures(): Promise<Fixtures> {
	await cleanupAll();
	await insertUsers();
	const atlas = await createWorkspace(ATLAS_ID, "Atlas", ALICE_ID, [ALICE_ID]);
	const orbit = await createWorkspace(ORBIT_ID, "Orbit", ALICE_ID, [ALICE_ID]);
	const nebula = await createWorkspace(NEBULA_ID, "Nebula", BOB_ID, [BOB_ID]);
	return {
		atlas,
		orbit,
		nebula,
		...(await atlasItems(atlas)),
		...(await orbitItems(orbit)),
		...(await nebulaItems(nebula)),
	};
}
