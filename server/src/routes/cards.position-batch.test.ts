import { describe, expect, it, vi } from "vitest";
import type { DBExecutor } from "../db/kysely.js";
import { batchUpdateCardPositions } from "./cards.js";

describe("batchUpdateCardPositions", () => {
	it("skips query execution for an empty batch", async () => {
		const executeQuery = vi.fn();
		const dbExec = { executeQuery } as unknown as DBExecutor;

		await batchUpdateCardPositions(dbExec, 1, 1, []);

		expect(executeQuery).not.toHaveBeenCalled();
	});
});
