import type { DBExecutor } from "../db/kysely.js";

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
	dbExec: DBExecutor,
	cardIds: number[],
): Promise<Map<number, CardAssignee[]>> {
	const map = new Map<number, CardAssignee[]>();
	if (cardIds.length === 0) return map;

	const rows = await dbExec
		.selectFrom("card_assignees as ca")
		.innerJoin("users as u", "u.id", "ca.user_id")
		.select(["ca.card_id", "u.id", "u.username", "u.display_name"])
		.where("ca.card_id", "in", cardIds)
		.orderBy("ca.card_id")
		.orderBy("u.display_name")
		.execute();

	for (const row of rows) {
		const cardId = row.card_id;
		const list = map.get(cardId) ?? [];
		list.push({
			id: row.id,
			username: row.username as string,
			displayName: row.display_name,
		});
		map.set(cardId, list);
	}
	return map;
}

export async function getCardAssigneeIds(
	dbExec: DBExecutor,
	cardId: number,
): Promise<number[]> {
	const rows = await dbExec
		.selectFrom("card_assignees")
		.select("user_id")
		.where("card_id", "=", cardId)
		.orderBy("user_id")
		.execute();
	return rows.map((r) => r.user_id);
}

/** Returns true when a new row was inserted (assignee was not already on the card). */
export async function addCardAssignee(
	dbExec: DBExecutor,
	cardId: number,
	userId: number,
): Promise<boolean> {
	const result = await dbExec
		.insertInto("card_assignees")
		.values({ card_id: cardId, user_id: userId })
		.onConflict((oc) => oc.doNothing())
		.executeTakeFirst();
	return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
}

export async function syncCardAssignees(
	dbExec: DBExecutor,
	cardId: number,
	assigneeIds: number[],
): Promise<{ prev: number[]; added: number[]; removed: number[] }> {
	const prev = await getCardAssigneeIds(dbExec, cardId);
	const { added, removed } = diffAssigneeIds(prev, assigneeIds);

	if (removed.length > 0) {
		await dbExec
			.deleteFrom("card_assignees")
			.where("card_id", "=", cardId)
			.where("user_id", "in", removed)
			.execute();
	}
	for (const userId of added) {
		await dbExec
			.insertInto("card_assignees")
			.values({ card_id: cardId, user_id: userId })
			.onConflict((oc) => oc.doNothing())
			.execute();
	}

	return { prev, added, removed };
}
