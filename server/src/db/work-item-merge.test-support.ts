import type { ScratchSchema } from "./scratch-schema-test-support.js";

export type Ws = {
	id: number;
	userId: number;
	otherUserId: number;
	statusId: number;
	priorityId: number;
	labelId: number;
};

// biome-ignore lint/suspicious/noExplicitAny: test helper returns loosely typed rows
export async function rows<T = Record<string, any>>(
	s: ScratchSchema,
	sql: string,
	values: unknown[] = [],
): Promise<T[]> {
	return (await s.client.query(sql, values)).rows as T[];
}

export async function seedWorkspace(
	s: ScratchSchema,
	tag: string,
): Promise<Ws> {
	const [user] = await rows(
		s,
		"INSERT INTO users (username, display_name, password_hash) VALUES ($1, 'U', 'x') RETURNING id",
		[`${tag}-a`],
	);
	const [other] = await rows(
		s,
		"INSERT INTO users (username, display_name, password_hash) VALUES ($1, 'U2', 'x') RETURNING id",
		[`${tag}-b`],
	);
	const [ws] = await rows(
		s,
		"INSERT INTO workspaces (name, owner_user_id) VALUES ($1, $2) RETURNING id",
		[tag, user.id],
	);
	const vocab = async (kind: string, name: string, slot: string | null) =>
		(
			await rows(
				s,
				"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, slot) VALUES ($1, $2, $3, 1, '#000', $4) RETURNING id",
				[ws.id, kind, name, slot],
			)
		)[0].id as number;
	return {
		id: ws.id,
		userId: user.id,
		otherUserId: other.id,
		statusId: await vocab("status", `Todo-${tag}`, "todo"),
		priorityId: await vocab("priority", `High-${tag}`, null),
		labelId: await vocab("label", `Bug-${tag}`, null),
	};
}

export async function seedItem(
	s: ScratchSchema,
	ws: Ws,
	key: number,
	extra: { deletedAt?: string | null } = {},
): Promise<number> {
	const [item] = await rows(
		s,
		`INSERT INTO tracker_items
		 (workspace_id, key_number, title, description, status_id, priority_id, version,
		  deleted_at, created_at, updated_at, start_date, end_date, completed_at, position)
		 VALUES ($1, $2, $3, 'desc', $4, $5, 3, $6, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z',
		         '2026-03-01', '2026-03-09', '2026-03-05T00:00:00Z', 2048)
		 RETURNING id`,
		[
			ws.id,
			key,
			`item-${key}`,
			ws.statusId,
			ws.priorityId,
			extra.deletedAt ?? null,
		],
	);
	return item.id;
}

export async function seedEvents(
	s: ScratchSchema,
	ws: Ws,
	itemId: number | null,
	count: number,
	type = "tracker_item_updated",
	payload: unknown = { n: 1 },
) {
	for (let i = 0; i < count; i++) {
		await s.client.query(
			`INSERT INTO tracker_events (tracker_item_id, actor_id, event_type, payload, workspace_id, created_at)
			 VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
			[
				itemId,
				ws.userId,
				type,
				JSON.stringify(payload),
				ws.id,
				`2026-01-0${i + 2}T00:00:00Z`,
			],
		);
	}
}
