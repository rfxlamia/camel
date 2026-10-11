import { describe, expect, it, vi } from "vitest";
import { listenAfterRecovery } from "./startup.js";

describe("listenAfterRecovery", () => {
	it("awaits recovery before opening the HTTP listener", async () => {
		const order: string[] = [];
		const result = await listenAfterRecovery(
			async () => {
				order.push("recovery");
			},
			() => {
				order.push("listen");
				return "server";
			},
		);

		expect(order).toEqual(["recovery", "listen"]);
		expect(result).toBe("server");
	});

	it("does not open the HTTP listener when recovery fails", async () => {
		const listen = vi.fn(() => "server");
		await expect(
			listenAfterRecovery(async () => {
				throw new Error("database unavailable");
			}, listen),
		).rejects.toThrow("database unavailable");
		expect(listen).not.toHaveBeenCalled();
	});
});
