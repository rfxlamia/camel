import { randomUUID } from "node:crypto";
import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { config } from "../config.js";

export interface AttachmentPair {
	thumbnailPath: string;
	originalPath: string;
}

export interface AttachmentPairInput {
	thumbnail: Buffer;
	original: Buffer;
}

export interface AttachmentStorage {
	readonly root: string;
	writePair(input: AttachmentPairInput): Promise<AttachmentPair>;
	writePair(thumbnail: Buffer, original: Buffer): Promise<AttachmentPair>;
	removePair(pair: AttachmentPair): Promise<void>;
	removePairs(pairs: Iterable<AttachmentPair>): Promise<void>;
}

let testStorage: AttachmentStorage | undefined;

/** Returns the production provider, with a narrow seam for route integration tests. */
export function getAttachmentStorage(): AttachmentStorage {
	return testStorage ?? new LocalAttachmentStorage(config.ATTACHMENTS_DIR);
}

export function setAttachmentStorageForTests(
	storage: AttachmentStorage | null,
): void {
	testStorage = storage ?? undefined;
}

export class LocalAttachmentStorage implements AttachmentStorage {
	readonly root: string;

	constructor(root: string) {
		this.root = path.resolve(root);
	}

	async writePair(
		inputOrThumbnail: AttachmentPairInput | Buffer,
		original?: Buffer,
	): Promise<AttachmentPair> {
		const input = Buffer.isBuffer(inputOrThumbnail)
			? { thumbnail: inputOrThumbnail, original }
			: inputOrThumbnail;
		if (!Buffer.isBuffer(input.thumbnail) || !Buffer.isBuffer(input.original)) {
			throw new TypeError("Attachment pair must contain Buffer values");
		}

		const pairId = randomUUID();
		const pairDirectory = path.join(this.root, pairId);
		const pair = {
			thumbnailPath: path.join(pairId, "thumbnail"),
			originalPath: path.join(pairId, "original"),
		};

		await mkdir(pairDirectory, { recursive: true });
		try {
			await writeFile(
				path.join(this.root, pair.thumbnailPath),
				input.thumbnail,
			);
			await writeFile(path.join(this.root, pair.originalPath), input.original);
		} catch (error) {
			try {
				await this.removePair(pair);
			} catch (cleanupError) {
				console.error(
					"Failed to clean up an incomplete attachment pair",
					cleanupError,
				);
			}
			throw error;
		}

		return pair;
	}

	async removePair(pair: AttachmentPair): Promise<void> {
		const thumbnailPath = this.resolvePrivatePath(pair.thumbnailPath);
		const originalPath = this.resolvePrivatePath(pair.originalPath);
		await Promise.all([
			this.unlinkIfPresent(thumbnailPath),
			this.unlinkIfPresent(originalPath),
		]);

		const parentDirectories = new Set([
			path.dirname(thumbnailPath),
			path.dirname(originalPath),
		]);
		for (const directory of parentDirectories) {
			try {
				await rmdir(directory);
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
			}
		}
	}

	async removePairs(pairs: Iterable<AttachmentPair>): Promise<void> {
		const results = await Promise.allSettled(
			[...pairs].map((pair) => this.removePair(pair)),
		);
		for (const result of results) {
			if (result.status === "rejected") {
				console.error("Failed to clean up attachment files", result.reason);
			}
		}
	}

	private resolvePrivatePath(relativePath: string): string {
		if (path.isAbsolute(relativePath)) {
			throw new Error("Attachment paths must be provider-relative");
		}
		const resolved = path.resolve(this.root, relativePath);
		if (
			resolved !== this.root &&
			!resolved.startsWith(`${this.root}${path.sep}`)
		) {
			throw new Error("Attachment path escapes the private storage root");
		}
		return resolved;
	}

	private async unlinkIfPresent(filePath: string): Promise<void> {
		try {
			await unlink(filePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}
