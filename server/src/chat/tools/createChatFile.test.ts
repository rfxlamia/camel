import "dotenv/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ARTIFACT_BYTES } from "../../agent/artifact.js";
import { db } from "../../db/kysely.js";
import { createChatService } from "../service.js";
import { makeCreateChatFile } from "./createChatFile.js";

describe.skipIf(!process.env.RUN_INTEGRATION)("createChatFile", () => {
	let userId: number;
	let threadId: number;
	let messageId: number;
	let service: ReturnType<typeof createChatService>;

	beforeEach(async () => {
		const user = await db
			.insertInto("users")
			.values({
				username: `chat-file-${Date.now()}`,
				display_name: "File",
				password_hash: "h",
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		userId = user.id;
		service = createChatService(db);
		const thread = await service.createThread(userId);
		threadId = thread.id;
		const msg = await service.insertMessage({
			threadId,
			role: "assistant",
			content: "Here is your file",
		});
		messageId = msg.id;
	});

	afterEach(async () => {
		await db.deleteFrom("users").where("id", "=", userId).execute();
	});

	it("inserts chat_attachments row with LLM-supplied md content", async () => {
		const tool = makeCreateChatFile({
			messageId,
			insertAttachment: (row) => service.insertAttachment(row),
		});
		const result = await tool.execute({
			filename: "report.md",
			content: "# Report\nBody",
			format: "md",
		});
		expect(result.ok).toBe(true);
		const row = await db
			.selectFrom("chat_attachments")
			.where("message_id", "=", messageId)
			.selectAll()
			.executeTakeFirst();
		expect(row?.filename).toBe("report.md");
		expect(row?.content).toContain("# Report");
	});

	it("returns TOO_LARGE when content exceeds MAX_ARTIFACT_BYTES", async () => {
		const tool = makeCreateChatFile({
			messageId,
			insertAttachment: vi.fn(),
		});
		const huge = "x".repeat(MAX_ARTIFACT_BYTES + 1);
		const result = await tool.execute({
			filename: "big.txt",
			content: huge,
			format: "txt",
		});
		expect(result.ok).toBe(false);
		expect(result.errorCode).toBe("TOO_LARGE");
	});

	it("returns EMPTY_CONTENT for blank content", async () => {
		const tool = makeCreateChatFile({ messageId, insertAttachment: vi.fn() });
		const result = await tool.execute({
			filename: "empty.md",
			content: "   ",
			format: "md",
		});
		expect(result.ok).toBe(false);
		expect(result.errorCode).toBe("EMPTY_CONTENT");
	});
});
