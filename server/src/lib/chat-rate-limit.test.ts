import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkChatLimit, resetChatLimitForTesting } from "./chat-rate-limit.js";

describe("chat rate limit", () => {
	beforeEach(() => resetChatLimitForTesting());
	afterEach(() => resetChatLimitForTesting());

	it("locks the second message inside the window", async () => {
		expect((await checkChatLimit(1)).isLocked).toBe(false);
		expect((await checkChatLimit(1)).isLocked).toBe(true);
	});
});
