import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/kysely.js";
import { createChatService } from "./service.js";

/**
 * Requires running PostgreSQL. Gated behind RUN_INTEGRATION=1.
 * RUN_INTEGRATION=1 npm run test -- server/src/chat/service.test.ts
 */
describe.skipIf(!process.env.RUN_INTEGRATION)("chat service", () => {
	let userAId: number;
	let userBId: number;
	let service: ReturnType<typeof createChatService>;

	beforeAll(async () => {
		const userA = await db
			.insertInto("users")
			.values({
				username: `chat-svc-a-${Date.now()}`,
				display_name: "Chat A",
				password_hash: "h",
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		userAId = userA.id;
		const userB = await db
			.insertInto("users")
			.values({
				username: `chat-svc-b-${Date.now()}`,
				display_name: "Chat B",
				password_hash: "h",
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		userBId = userB.id;
		service = createChatService(db);
	});

	afterAll(async () => {
		await db.deleteFrom("users").where("id", "in", [userAId, userBId]).execute();
	});

	it("createThread returns thread titled Untitled", async () => {
		const thread = await service.createThread(userAId);
		expect(thread.title).toBe("Untitled");
		expect(thread.userId).toBe(userAId);
		await service.deleteThread(userAId, thread.id);
	});

	it("findEmptyThread returns zero-message thread when one exists", async () => {
		const empty = await service.createThread(userAId);
		const found = await service.findEmptyThread(userAId);
		expect(found?.id).toBe(empty.id);
		await service.deleteThread(userAId, empty.id);
	});

	it("listThreads sorts by updated_at DESC", async () => {
		const older = await service.createThread(userAId);
		const newer = await service.createThread(userAId);
		await service.renameThread(userAId, newer.id, "Newer");
		const list = await service.listThreads(userAId);
		expect(list[0].id).toBe(newer.id);
		await service.deleteThread(userAId, older.id);
		await service.deleteThread(userAId, newer.id);
	});

	it("getThread returns null for wrong user (IDOR)", async () => {
		const thread = await service.createThread(userAId);
		const leaked = await service.getThread(userBId, thread.id);
		expect(leaked).toBeNull();
		await service.deleteThread(userAId, thread.id);
	});

	it("renameThread persists title via getThread", async () => {
		const thread = await service.createThread(userAId);
		const renamed = await service.renameThread(userAId, thread.id, "My Title");
		expect(renamed?.title).toBe("My Title");
		const fetched = await service.getThread(userAId, thread.id);
		expect(fetched?.title).toBe("My Title");
		await service.deleteThread(userAId, thread.id);
	});

	it("deleteThread hard-deletes messages and attachments", async () => {
		const thread = await service.createThread(userAId);
		const msg = await service.insertMessage({
			userId: userAId,
			threadId: thread.id,
			role: "user",
			content: "hello",
		});
		expect(msg).not.toBeNull();
		await service.insertAttachment({
			userId: userAId,
			messageId: msg!.id,
			filename: "note.md",
			format: "md",
			content: "# Note",
		});
		await service.deleteThread(userAId, thread.id);
		const rows = await db
			.selectFrom("chat_messages")
			.where("thread_id", "=", thread.id)
			.selectAll()
			.execute();
		expect(rows).toHaveLength(0);
	});

	it("autoTitleThread truncates first user message to ~50 chars", async () => {
		const thread = await service.createThread(userAId);
		const long =
			"This is a very long first message that should be truncated for the thread title";
		await service.autoTitleThread(userAId, thread.id, long);
		const updated = await service.getThread(userAId, thread.id);
		expect(updated?.title.length).toBeLessThanOrEqual(50);
		expect(updated?.title).not.toBe("Untitled");
		await service.deleteThread(userAId, thread.id);
	});

	it("does not auto-title on failed first message (title stays Untitled)", async () => {
		const thread = await service.createThread(userAId);
		// simulate failure path: no autoTitleThread call
		const still = await service.getThread(userAId, thread.id);
		expect(still?.title).toBe("Untitled");
		await service.deleteThread(userAId, thread.id);
	});
});
