import { describe, expect, it } from "vitest";
import { createItemMutationQueue } from "./trackerItemMutationQueue";

describe("createItemMutationQueue", () => {
	it("runs tasks for the same itemId strictly in enqueue order", async () => {
		const queue = createItemMutationQueue();
		let resolveFirst!: (value: string) => void;
		const firstControlled = new Promise<string>((resolve) => {
			resolveFirst = resolve;
		});
		let firstInvoked = false;
		let secondInvoked = false;

		const firstResult = queue.enqueue(1, async () => {
			firstInvoked = true;
			return firstControlled;
		});

		await Promise.resolve();
		expect(firstInvoked).toBe(true);

		const secondResult = queue.enqueue(1, async () => {
			secondInvoked = true;
			return "second";
		});

		expect(secondInvoked).toBe(false);

		resolveFirst("first");
		await expect(firstResult).resolves.toBe("first");
		await expect(secondResult).resolves.toBe("second");
		expect(secondInvoked).toBe(true);
	});

	it("does not delay tasks for different itemIds", async () => {
		const queue = createItemMutationQueue();
		let resolveFirst!: () => void;
		const firstBlocking = new Promise<void>((resolve) => {
			resolveFirst = resolve;
		});
		let secondInvoked = false;

		void queue.enqueue(1, async () => {
			await firstBlocking;
			return "first";
		});

		const secondResult = queue.enqueue(2, async () => {
			secondInvoked = true;
			return "second";
		});

		await Promise.resolve();
		expect(secondInvoked).toBe(true);
		await expect(secondResult).resolves.toBe("second");

		resolveFirst();
	});

	it("runs the next task after a rejection for the same itemId", async () => {
		const queue = createItemMutationQueue();
		let secondInvoked = false;

		const firstResult = queue.enqueue(1, async () => {
			throw new Error("409 conflict");
		});
		const secondResult = queue.enqueue(1, async () => {
			secondInvoked = true;
			return "recovered";
		});

		await expect(firstResult).rejects.toThrow("409 conflict");
		await expect(secondResult).resolves.toBe("recovered");
		expect(secondInvoked).toBe(true);
	});

	it("reports whether an item has queued work", async () => {
		const queue = createItemMutationQueue();
		let release!: () => void;
		const blocking = new Promise<void>((resolve) => {
			release = resolve;
		});

		const result = queue.enqueue(1, () => blocking);
		expect(queue.hasPending(1)).toBe(true);

		release();
		await result;
		await Promise.resolve();
		expect(queue.hasPending(1)).toBe(false);
	});
});
