import type { Queryable } from "./helpers.js";

export type CardAssignee = {
	id: number;
	username: string;
	displayName: string;
};

/** Compute added/removed assignee IDs between two sets (dedupes `next`). */
export function diffAssigneeIds(
	prev: number[],
	next: number[],
): { added: number[]; removed: number[] } {
	const unique = [...new Set(next)];
	const prevSet = new Set(prev);
	const nextSet = new Set(unique);
	return {
		added: unique.filter((id) => !prevSet.has(id)),
		removed: prev.filter((id) => !nextSet.has(id)),
	};
}

export async function loadCardAssigneesForCards(
	db: Queryable,
	cardIds: number[],
): Promise<Map<number, CardAssignee[]>> {
	const map = new Map<number, CardAssignee[]>();
	if (cardIds.length === 0) return map;

	const { rows } = await db.query(
		`SELECT ca.card_id, u.id, u.username, u.display_name
     FROM card_assignees ca
     JOIN users u ON u.id = ca.user_id
     WHERE ca.card_id = ANY($1::int[])
     ORDER BY ca.card_id, u.display_name`,
		[cardIds],
	);

	for (const row of rows) {
		const cardId = row.card_id as number;
		const list = map.get(cardId) ?? [];
		list.push({
			id: row.id as number,
			username: row.username as string,
			displayName: row.display_name as string,
		});
		map.set(cardId, list);
	}
	return map;
}

export async function getCardAssigneeIds(
	db: Queryable,
	cardId: number,
): Promise<number[]> {
	const { rows } = await db.query(
		`SELECT user_id FROM card_assignees WHERE card_id = $1 ORDER BY user_id`,
		[cardId],
	);
	return rows.map((r) => r.user_id as number);
}

/** Returns true when a new row was inserted (assignee was not already on the card). */
export async function addCardAssignee(
	db: Queryable,
	cardId: number,
	userId: number,
): Promise<boolean> {
	const { rowCount } = await db.query(
		`INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
		[cardId, userId],
	);
	return (rowCount ?? 0) > 0;
}

export async function syncCardAssignees(
	db: Queryable,
	cardId: number,
	assigneeIds: number[],
): Promise<{ prev: number[]; added: number[]; removed: number[] }> {
	const prev = await getCardAssigneeIds(db, cardId);
	const { added, removed } = diffAssigneeIds(prev, assigneeIds);

	if (removed.length > 0) {
		await db.query(
			`DELETE FROM card_assignees WHERE card_id = $1 AND user_id = ANY($2::int[])`,
			[cardId, removed],
		);
	}
	for (const userId of added) {
		await db.query(
			`INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
			[cardId, userId],
		);
	}

	return { prev, added, removed };
}
