import { ApiError } from "../api";
import type { PreparedImagePair } from "../shared/imageAttachments";
import type { BoardCreatePayload } from "../shared/taskCreateContracts";
import {
	createInitialTaskMetadataDraft,
	selectTaskMetadataPayload,
} from "../shared/taskMetadataDraft";

export const STAGE_CAP_MESSAGE = "Max 3 images per card";
export const UPLOAD_RETRY_MESSAGE = "Upload failed. Try again.";

export type StagedImage =
	| {
			id: string;
			kind: "valid";
			name: string;
			prepared: PreparedImagePair;
			previewUrl: string;
	  }
	| {
			id: string;
			kind: "invalid";
			name: string;
			file: File;
			error: string;
	  }
	| {
			id: string;
			kind: "loading";
			name: string;
	  }
	| {
			id: string;
			kind: "network-error";
			name: string;
			prepared: PreparedImagePair;
			previewUrl: string;
			error: string;
	  };

export function createStageId(): string {
	return crypto.randomUUID();
}

/** Counts every staged slot, including in-flight loading entries. */
export function countStagedSlots(entries: StagedImage[]): number {
	return entries.length;
}

export function mapStagedImagesToAttachments(
	stagedImages: StagedImage[],
): PreparedImagePair[] {
	return stagedImages
		.filter(
			(
				entry,
			): entry is Extract<StagedImage, { kind: "valid" | "network-error" }> =>
				entry.kind === "valid" || entry.kind === "network-error",
		)
		.map((entry) => entry.prepared);
}

export function buildBoardPayload(
	columnId: number,
	title: string,
	draft: ReturnType<typeof createInitialTaskMetadataDraft>,
	stagedImages: StagedImage[],
): BoardCreatePayload {
	const metadata = selectTaskMetadataPayload(draft);
	const {
		statusId: _statusId,
		startDate: _startDate,
		endDate: _endDate,
		...boardMetadata
	} = metadata;
	const attachments = mapStagedImagesToAttachments(stagedImages);
	return {
		columnId,
		title,
		...boardMetadata,
		...(attachments.length > 0 ? { attachments } : {}),
	};
}

export function markStagedUploadFailure(
	entries: StagedImage[],
	error: string,
): StagedImage[] {
	return entries.map((entry) => {
		if (entry.kind !== "valid") return entry;
		return { ...entry, kind: "network-error", error };
	});
}

export function hasUnreadyStagedImages(entries: StagedImage[]): boolean {
	return entries.some(
		(entry) => entry.kind === "invalid" || entry.kind === "loading",
	);
}

export function uploadFailureMessage(err: unknown): string {
	if (err instanceof ApiError) return err.message;
	if (err instanceof Error && err.message) return err.message;
	return UPLOAD_RETRY_MESSAGE;
}
