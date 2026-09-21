import { describe, expect, it, vi } from "vitest";
import { executeWithRetry } from "./retry.js";

function httpError(status: number, message = "HTTP error"): Error {
	const err = new Error(message);
	(err as Error & { status: number }).status = status;
	return err;
}

describe("executeWithRetry", () => {
	it("503 twice then success resolves after delays [1000, 2000]", async () => {
		const sleepFn = vi.fn().mockResolvedValue(undefined);
		let attempts = 0;

		const fn = vi.fn(async () => {
			attempts++;
			if (attempts <= 2) {
				throw httpError(503, "Service Unavailable");
			}
			return "ok";
		});

		const result = await executeWithRetry(fn, { sleepFn });

		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(3);
		expect(sleepFn).toHaveBeenCalledTimes(2);
		expect(sleepFn).toHaveBeenNthCalledWith(1, 1000);
		expect(sleepFn).toHaveBeenNthCalledWith(2, 2000);
	});

	it("422 failure rejects immediately with retryable false and no sleep", async () => {
		const sleepFn = vi.fn().mockResolvedValue(undefined);
		const fn = vi.fn(async () => {
			throw httpError(422, "Unprocessable Entity");
		});

		await expect(executeWithRetry(fn, { sleepFn })).rejects.toMatchObject({
			retryable: false,
			status: 422,
		});
		expect(fn).toHaveBeenCalledTimes(1);
		expect(sleepFn).not.toHaveBeenCalled();
	});

	it("500 always rejects after 10 attempts with retryable true", async () => {
		const sleepFn = vi.fn().mockResolvedValue(undefined);
		const fn = vi.fn(async () => {
			throw httpError(500, "Internal Server Error");
		});

		await expect(executeWithRetry(fn, { sleepFn })).rejects.toMatchObject({
			retryable: true,
			status: 500,
		});
		expect(fn).toHaveBeenCalledTimes(10);
		expect(sleepFn).toHaveBeenCalledTimes(9);
	});
});
