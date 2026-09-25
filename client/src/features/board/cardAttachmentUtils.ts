import type { CardAttachment } from "../../types";

export function orderCardAttachments(
	attachments: CardAttachment[],
): CardAttachment[] {
	return [...attachments].sort((a, b) => {
		const createdAtOrder =
			new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
		return createdAtOrder !== 0 ? createdAtOrder : a.id - b.id;
	});
}
