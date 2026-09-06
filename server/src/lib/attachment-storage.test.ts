import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../config.js";
import {
	ATTACHMENT_UPLOAD_PROFILES,
	CARD_CREATE_METADATA_FIELD,
	createAttachmentUpload,
	normalizeAttachmentUploadError,
} from "./attachment-upload.js";
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
		expect(() =>
			resolveConfig({
				...REQUIRED_ENV,
				NODE_ENV: "development",
				ATTACHMENTS_DIR: path.join(publicRoot, "attachments"),
			}),
		).toThrow("ATTACHMENTS_DIR must be outside client/public");
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

type UploadedFile = { buffer?: Buffer; path?: string };

async function createUploadApp(maxPairs: number) {
	const upload = await createAttachmentUpload({ maxPairs });
	const providerInvocation = vi.fn();
	const app = express();
	app.post("/", upload, (req, res) => {
		providerInvocation();
		const files = req.files as Record<string, UploadedFile[]>;
		const metadata = (req.body as Record<string, unknown> | undefined)?.[
			CARD_CREATE_METADATA_FIELD
		];
		res.json({
			count: Object.values(files ?? {}).flat().length,
			memoryBacked: Object.values(files ?? {})
				.flat()
				.every((file) => Buffer.isBuffer(file.buffer) && file.path === undefined),
			...(typeof metadata === "string" ? { metadata } : {}),
		});
	});
	app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
		const normalized = normalizeAttachmentUploadError(error);
		res.status(normalized.status).json(normalized);
	});
	return { app, providerInvocation };
}

function addPairs(
	req: request.Test,
	count: number,
	buffer = Buffer.from("synthetic image bytes"),
) {
	for (let index = 0; index < count; index += 1) {
		req.attach("thumbnail", buffer, `thumbnail-${index}.png`);
		req.attach("original", buffer, `original-${index}.png`);
	}
	return req;
}

describe("createAttachmentUpload", () => {
	it("accepts one card-create metadata JSON part while keeping files in memory", async () => {
		const { app, providerInvocation } = await createUploadApp(3);
		const acceptedResponse = request(app).post("/");
		acceptedResponse.field(CARD_CREATE_METADATA_FIELD, JSON.stringify({ title: "Metadata" }));
		addPairs(acceptedResponse, 3);
		const response = await acceptedResponse;

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			count: 6,
			memoryBacked: true,
			metadata: JSON.stringify({ title: "Metadata" }),
		});
		expect(providerInvocation).toHaveBeenCalledTimes(1);
	});

	it("rejects a fourth card-create pair while keeping accepted files in memory", async () => {
		const { app, providerInvocation } = await createUploadApp(3);
		const acceptedResponse = await addPairs(request(app).post("/"), 3);

		expect(acceptedResponse.status).toBe(200);
		expect(acceptedResponse.body).toEqual({ count: 6, memoryBacked: true });
		expect(providerInvocation).toHaveBeenCalledTimes(1);

		const rejected = await addPairs(request(app).post("/"), 4);
		expect(rejected.status).toBe(413);
		expect(rejected.body.code).toBe("LIMIT_FILE_COUNT");
		expect(providerInvocation).toHaveBeenCalledTimes(1);
	});

	it("rejects a second card-create metadata part at the parts ceiling", async () => {
		const { app, providerInvocation } = await createUploadApp(
			ATTACHMENT_UPLOAD_PROFILES.cardCreate.maxPairs,
		);
		const requestWithDuplicateMetadata = addPairs(request(app).post("/"), 3);
		requestWithDuplicateMetadata.field(CARD_CREATE_METADATA_FIELD, JSON.stringify({ title: "one" }));
		requestWithDuplicateMetadata.field(CARD_CREATE_METADATA_FIELD, JSON.stringify({ title: "two" }));

		const response = await requestWithDuplicateMetadata;
		expect(response.status).toBe(413);
		expect(response.body.code).toBe("LIMIT_PART_COUNT");
		expect(providerInvocation).not.toHaveBeenCalled();
	});

	it("accepts four existing-card pairs but enforces pair, file, and parts ceilings", async () => {
		const { app, providerInvocation } = await createUploadApp(
			ATTACHMENT_UPLOAD_PROFILES.existingCard.maxPairs,
		);
		const acceptedResponse = await addPairs(request(app).post("/"), 4);
		expect(acceptedResponse.status).toBe(200);
		expect(acceptedResponse.body).toEqual({ count: 8, memoryBacked: true });

		const tooManyPairs = await addPairs(request(app).post("/"), 11);
		expect(tooManyPairs.status).toBe(413);
		expect(tooManyPairs.body.code).toBe("LIMIT_FILE_COUNT");

		const tooManyFiles = request(app).post("/");
		for (let index = 0; index < 10; index += 1) {
			tooManyFiles.attach("thumbnail", Buffer.from("thumbnail"), `thumbnail-${index}.png`);
			tooManyFiles.attach("original", Buffer.from("original"), `original-${index}.png`);
		}
		tooManyFiles.attach("original", Buffer.from("original"), "original-overflow.png");
		const tooManyFilesResponse = await tooManyFiles;
		expect(tooManyFilesResponse.status).toBe(413);
		expect(tooManyFilesResponse.body.code).toBe("LIMIT_FILE_COUNT");

		const tooManyParts = addPairs(request(app).post("/"), 10);
		tooManyParts.field(CARD_CREATE_METADATA_FIELD, JSON.stringify({ title: "one" }));
		tooManyParts.field(CARD_CREATE_METADATA_FIELD, JSON.stringify({ title: "two" }));
		const tooManyPartsResponse = await tooManyParts;
		expect(tooManyPartsResponse.status).toBe(413);
		expect(tooManyPartsResponse.body.code).toBe("LIMIT_PART_COUNT");
		expect(providerInvocation).toHaveBeenCalledTimes(1);
	});

	it("rejects files over 10MB before provider invocation for both profiles", async () => {
		for (const maxPairs of [
			ATTACHMENT_UPLOAD_PROFILES.cardCreate.maxPairs,
			ATTACHMENT_UPLOAD_PROFILES.existingCard.maxPairs,
		]) {
			const { app, providerInvocation } = await createUploadApp(maxPairs);
			const oversized = await addPairs(
				request(app).post("/"),
				1,
				Buffer.alloc(ATTACHMENT_UPLOAD_PROFILES.cardCreate.fileSize + 1),
			);
			expect(oversized.status).toBe(413);
			expect(oversized.body.code).toBe("LIMIT_FILE_SIZE");
			expect(providerInvocation).not.toHaveBeenCalled();
		}
	});
});
