export type VocabularyRow = {
	id: number;
	kind: string;
	name: string;
	position: number;
	colour: string;
	category?: string | null;
	slot?: string | null;
	created_at?: Date | string;
};

export function serializeVocabulary(row: VocabularyRow) {
	const body: Record<string, unknown> = {
		id: row.id,
		kind: row.kind,
		name: row.name,
		position: row.position,
		colour: row.colour,
	};
	if (row.category !== undefined) body.category = row.category;
	if (row.slot !== undefined) body.slot = row.slot;
	if (row.created_at !== undefined) body.createdAt = row.created_at;
	return body;
}
