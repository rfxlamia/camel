import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("chat-schema.sql", () => {
	const sql = readFileSync(join(here, "chat-schema.sql"), "utf8");

	it("defines chat_threads with user_id, title, updated_at (no workspace_id)", () => {
		expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS chat_threads/i);
		expect(sql).toMatch(/user_id.*REFERENCES users/i);
		expect(sql).toMatch(/\btitle\b/i);
		expect(sql).toMatch(/\bupdated_at\b/i);
		expect(sql).not.toMatch(/\bworkspace_id\b/i);
	});

	it("defines chat_messages with thread_id, role, content, thinking, tool_trace JSONB", () => {
		expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS chat_messages/i);
		expect(sql).toMatch(/thread_id.*REFERENCES chat_threads/i);
		expect(sql).toMatch(/\brole\b/i);
		expect(sql).toMatch(/\bcontent\b/i);
		expect(sql).toMatch(/\bthinking\b/i);
		expect(sql).toMatch(/tool_trace.*JSONB/i);
		expect(sql).toMatch(/role.*CHECK.*user.*assistant.*error/i);
	});

	it("defines chat_attachments with message_id, filename, format, content", () => {
		expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS chat_attachments/i);
		expect(sql).toMatch(/message_id.*REFERENCES chat_messages/i);
		expect(sql).toMatch(/\bfilename\b/i);
		expect(sql).toMatch(/format.*CHECK.*md.*txt.*csv/i);
		expect(sql).toMatch(/\bcontent\b/i);
	});

	it("CASCADE deletes thread → messages → attachments", () => {
		expect(sql).toMatch(/chat_messages[\s\S]*ON DELETE CASCADE/i);
		expect(sql).toMatch(/chat_attachments[\s\S]*ON DELETE CASCADE/i);
	});

	it("indexes user_id+updated_at, thread_id, message_id", () => {
		expect(sql).toMatch(/idx_chat_threads_user_updated/i);
		expect(sql).toMatch(/idx_chat_messages_thread/i);
		expect(sql).toMatch(/idx_chat_attachments_message/i);
	});
});

describe("migrate.ts wiring", () => {
	it("applies chat-schema.sql after agent-schema.sql", () => {
		const migrateSrc = readFileSync(join(here, "migrate.ts"), "utf8");
		expect(migrateSrc).toMatch(/chat-schema\.sql/);
		expect(migrateSrc).toMatch(/agent-schema\.sql[\s\S]*chat-schema\.sql/);
	});
});

describe("Kysely types", () => {
	it("registers ChatThreads, ChatMessages, ChatAttachments on Database", async () => {
		const { Database } = await import("./types.js");
		type DB = Database;
		type Tables = keyof DB;
		const _threads: Tables = "chat_threads";
		const _messages: Tables = "chat_messages";
		const _attachments: Tables = "chat_attachments";
		expect(_threads).toBe("chat_threads");
	});
});
