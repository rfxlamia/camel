import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import { LocalAttachmentStorage } from "./attachment-storage.js";

const REQUIRED_ENV = {
	DATABASE_URL: "postgresql://localhost:5432/test",
	ANTHROPIC_API_KEY: "test-key",
};

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("LocalAttachmentStorage", () => {
	it("writes and removes an opaque thumbnail/original pair below the configured private root", async () => {
		const root = await mkdtemp(path.join(process.cwd(), "attachment-storage-test-"));
		temporaryRoots.push(root);
		const configured = resolveConfig({
			...REQUIRED_ENV,
			NODE_ENV: "production",
			ATTACHMENTS_DIR: root,
		});
		const storage = new LocalAttachmentStorage(configured.ATTACHMENTS_DIR);
		const thumbnail = Buffer.from("\x89PNG thumbnail bytes");
		const original = Buffer.from("\x89PNG original bytes");

		expect(storage.root).toBe(root);
		const pair = await storage.writePair(thumbnail, original);

		expect(pair.thumbnailPath).not.toContain("public");
		expect(pair.originalPath).not.toContain("public");
		expect(pair.thumbnailPath).not.toContain("../../");
		expect(pair.originalPath).not.toContain("original.png");
		expect(path.isAbsolute(pair.thumbnailPath)).toBe(false);
		expect(path.isAbsolute(pair.originalPath)).toBe(false);

		const thumbnailPath = path.join(root, pair.thumbnailPath);
		const originalPath = path.join(root, pair.originalPath);
		expect(await readFile(thumbnailPath)).toEqual(thumbnail);
		expect(await readFile(originalPath)).toEqual(original);
		expect(path.resolve(thumbnailPath).startsWith(path.resolve(root) + path.sep)).toBe(true);
		expect(path.resolve(originalPath).startsWith(path.resolve(root) + path.sep)).toBe(true);

		await storage.removePair(pair);
		await expect(readFile(thumbnailPath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(originalPath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(storage.removePair(pair)).resolves.toBeUndefined();
	});

	it("defaults to private roots outside public uploads in development and container production", () => {
		const development = resolveConfig({ ...REQUIRED_ENV, NODE_ENV: "development" });
		const containerProduction = resolveConfig({
			...REQUIRED_ENV,
			NODE_ENV: "production",
		});
		const publicRoot = path.resolve(
			fileURLToPath(new URL("../../../client/public", import.meta.url)),
		);

		expect(development.ATTACHMENTS_DIR).toBe(
			fileURLToPath(new URL("../../private-uploads", import.meta.url)),
		);
		expect(containerProduction.ATTACHMENTS_DIR).toBe(
			"/app/server/private-uploads",
		);
		expect(path.resolve(development.ATTACHMENTS_DIR).startsWith(publicRoot + path.sep)).toBe(
			false,
		);
		expect(
			path.resolve(containerProduction.ATTACHMENTS_DIR).startsWith(publicRoot + path.sep),
		).toBe(false);
		expect(development.ATTACHMENTS_DIR).not.toContain("UPLOADS_DIR");
		expect(containerProduction.ATTACHMENTS_DIR).not.toContain("UPLOADS_DIR");
	});

	it("supports best-effort bulk cleanup without failing the caller", async () => {
		const root = await mkdtemp(path.join(process.cwd(), "attachment-storage-test-"));
		temporaryRoots.push(root);
		const storage = new LocalAttachmentStorage(root);
		const pair = await storage.writePair(Buffer.from("thumbnail"), Buffer.from("original"));

		await expect(
			storage.removePairs([pair, pair, { thumbnailPath: "missing", originalPath: "missing" }]),
		).resolves.toBeUndefined();
	});
});
