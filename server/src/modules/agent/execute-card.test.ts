import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunChatTurn = vi.fn();
vi.mock("../chat/index.js", () => ({
	runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
}));

describe("executeCard reasoning flag", () => {
	beforeEach(() => {
		mockRunChatTurn.mockReset();
		mockRunChatTurn.mockResolvedValue({ output: "ok" });
	});

	it.each([
		true,
		false,
	])("passes reasoning=%s through as thinking", async (flag) => {
		const { executeCard } = await import("./execute-card.js");
		await executeCard("sys {original_intent}", "intent", [], flag, vi.fn());
		expect(mockRunChatTurn).toHaveBeenCalledWith(
			expect.objectContaining({ thinking: flag }),
		);
	});
});
