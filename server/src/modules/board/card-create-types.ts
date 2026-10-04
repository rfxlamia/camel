import type { AuthUser } from "../../auth.js";
import type { AttachmentPair } from "../../lib/attachment-storage.js";
import type { hydrateCardResponses } from "../../lib/card-response.js";
import type { NormalizedTaskCreateMetadata } from "../../lib/work-item-create-metadata.js";

export type CreateBody = Record<string, unknown>;
export type UploadedFile = Express.Multer.File;
export type PreparedAttachment = {
	thumbnail: UploadedFile;
	original: UploadedFile;
	mimeType: string;
};
export type Column = {
	id: number;
	wip_limit: number | null;
	is_signable: boolean;
	signable_assignee_id: number | null;
};
export type HydratedCard = Awaited<
	ReturnType<typeof hydrateCardResponses>
>[number];
export type CreateResult =
	| { kind: "not_found_column" }
	| { kind: "wip" }
	| { kind: "bad_request"; fieldErrors: Record<string, string> }
	| {
			kind: "ok";
			card: HydratedCard;
			assignmentIds: number[];
			attachments: Array<{ id: number; mimeType: string; createdAt: string }>;
	  };
export type PreparedCreate =
	| { kind: "not_found_column" }
	| { kind: "wip" }
	| { kind: "bad_request"; fieldErrors: Record<string, string> }
	| {
			kind: "ready";
			column: Column;
			metadata: NormalizedTaskCreateMetadata;
			dueDate: string | null;
	  };

export type CreateInput = {
	workspaceId: number;
	columnId: number;
	body: CreateBody;
	actor: AuthUser;
	title: string;
	description: string;
};

export type WrittenAttachment = {
	pair: AttachmentPair;
	mimeType: string;
	thumbnailSize: number;
	originalSize: number;
};

export type CreatedAttachmentRow = {
	id: number;
	mime_type: string;
	created_at: Date;
};

export type PreparedRequest =
	| { kind: "bad_request"; error: string }
	| { kind: "ready"; input: CreateInput; attachments: PreparedAttachment[] };
