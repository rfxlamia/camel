import { describe, expect, it, vi } from "vitest";
import { createChatToolFactory } from "./factory.js";

describe("createChatToolFactory", () => {
	it("resolves web_search, query_board_data, create_file", () => {
		const factory = createChatToolFactory({
			userId: 1,
			threadId: 2,
			messageId: 3,
			workspaceId: 7,
			insertAttachment: vi.fn(),
		});
		const tools = factory.resolveTools([
			"web_search",
			"query_board_data",
			"create_file",
		]);
		expect(tools.map((t) => t.name)).toEqual([
			"web_search",
			"query_board_data",
			"create_file",
		]);
	});

	it("query_board_data requires workspaceId in ctx", async () => {
		const factory = createChatToolFactory({
			userId: 1,
			threadId: 2,
			messageId: 3,
			insertAttachment: vi.fn(),
		});
		const tools = factory.resolveTools(["query_board_data"]);
		const tool = tools[0];
		const result = await tool.execute({
			workspaceId: undefined,
			query: "cards",
		});
		expect(result.ok).toBe(false);
	});
});
