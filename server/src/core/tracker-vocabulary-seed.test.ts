import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_TRACKER_VOCABULARY,
	seedTrackerVocabulary,
} from "./tracker-vocabulary-seed.js";
import { POSITION_GAP } from "./position.js";

describe("DEFAULT_TRACKER_VOCABULARY", () => {
	it("has exactly 5 statuses, 3 priorities and 3 labels", () => {
		const byKind = (kind: string) =>
			DEFAULT_TRACKER_VOCABULARY.filter((row) => row.kind === kind);
		expect(byKind("status")).toHaveLength(5);
		expect(byKind("priority")).toHaveLength(3);
		expect(byKind("label")).toHaveLength(3);
	});

	it("assigns the correct category to every seeded status", () => {
		const byName = (name: string) =>
			DEFAULT_TRACKER_VOCABULARY.find(
				(row) => row.kind === "status" && row.name === name,
			);
		expect(byName("Backlog")?.category).toBe("backlog");
		expect(byName("Todo")?.category).toBe("backlog");
		expect(byName("In Progress")?.category).toBe("started");
		expect(byName("Done")?.category).toBe("completed");
		expect(byName("Canceled")?.category).toBe("canceled");
	});

	it("carries no category on priorities or labels", () => {
		for (const row of DEFAULT_TRACKER_VOCABULARY) {
			if (row.kind !== "status") {
				expect(row.category ?? null).toBeNull();
			}
		}
	});

	it("positions are multiples of POSITION_GAP and strictly increasing per kind", () => {
		for (const kind of ["status", "priority", "label"] as const) {
			const positions = DEFAULT_TRACKER_VOCABULARY.filter(
				(row) => row.kind === kind,
			).map((row) => row.position);
			for (const p of positions) expect(p % POSITION_GAP).toBe(0);
			for (let i = 1; i < positions.length; i++) {
				expect(positions[i]).toBeGreaterThan(positions[i - 1]);
			}
		}
	});
});

describe("seedTrackerVocabulary", () => {
	it("issues one insert carrying all 11 rows tagged with the given workspace id", async () => {
		const execute = vi.fn().mockResolvedValue(undefined);
		const values = vi.fn().mockReturnValue({ execute });
		const insertInto = vi.fn().mockReturnValue({ values });
		const trx = { insertInto } as any;

		await seedTrackerVocabulary(trx, 42);

		expect(insertInto).toHaveBeenCalledWith("tracker_vocabularies");
		expect(insertInto).toHaveBeenCalledTimes(1);
		expect(values).toHaveBeenCalledTimes(1);
		const rows = values.mock.calls[0][0] as Array<{ workspace_id: number }>;
		expect(rows).toHaveLength(11);
		expect(rows.every((row) => row.workspace_id === 42)).toBe(true);
		expect(execute).toHaveBeenCalledOnce();
	});
});
