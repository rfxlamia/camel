import type {
	AttachmentPair,
	AttachmentStorage,
} from "../lib/attachment-storage.js";

/** Removes committed attachment files without turning a successful mutation into a failure. */
export async function removeAttachmentPairsBestEffort(
	storage: AttachmentStorage,
	pairs: Iterable<AttachmentPair>,
): Promise<void> {
	const results = await Promise.allSettled(
		[...pairs].map((pair) => storage.removePair(pair)),
	);
	for (const result of results) {
		if (result.status === "rejected") {
			console.error("Failed to clean up attachment files", result.reason);
		}
	}
}
