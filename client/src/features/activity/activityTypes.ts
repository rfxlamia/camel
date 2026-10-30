export interface AttachmentActivityPayload {
	attachmentId: number;
	mimeType: string;
	createdAt: string;
}

export interface ActivityEvent {
	id: number;
	type:
		| "create"
		| "update"
		| "move"
		| "delete"
		| "attachment_added"
		| "attachment_removed";
	cardId: number | null;
	cardTitle: string | null;
	fromColumn: string | null;
	toColumn: string | null;
	actor: { username: string; displayName: string } | null;
	createdAt: string;
	payload?: AttachmentActivityPayload | null;
}
