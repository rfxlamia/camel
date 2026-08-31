import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	selectRows: [] as { vocabulary_id: number }[],
	insertCalls: [] as { card_id: number; vocabulary_id: number }[],
	deleteCalls: [] as { card_id: number; removed: number[] }[],
}));

function createMockDbExec() {
	const selectChain: Record<string, unknown> = {};
	selectChain.select = vi.fn(() => selectChain);
	selectChain.where = vi.fn(() => selectChain);
	selectChain.orderBy = vi.fn(() => selectChain);
	selectChain.execute = vi.fn(async () => mocks.selectRows);

	const deleteChain: Record<string, unknown> = {};
	deleteChain.where = vi.fn(() => deleteChain);
	deleteChain.execute = vi.fn(async () => undefined);

	const insertChain: Record<string, unknown> = {};
	insertChain.values = vi.fn((v: { card_id: number; vocabulary_id: number }) => {
		mocks.insertCalls.push(v);
		return insertChain;
	});
	insertChain.onConflict = vi.fn(() => insertChain);
	insertChain.execute = vi.fn(async () => undefined);

	return {
		selectFrom: vi.fn((table: string) => {
			if (table === "card_labels") {
				return {
					select: selectChain.select,
					where: selectChain.where,
					orderBy: selectChain.orderBy,
					deleteFrom: vi.fn(() => ({
						where: vi.fn((...args: unknown[]) => {
							if (args[0] === "vocabulary_id" && args[1] === "in") {
								mocks.deleteCalls.push({
									card_id: 0,
									removed: args[2] as number[],
								});
							}
							return deleteChain;
						}),
					})),
					insertInto: vi.fn(() => insertChain),
				};
			}
			throw new Error(`unexpected table ${table}`);
		}),
		deleteFrom: vi.fn((table: string) => {
			if (table === "card_labels") {
				return {
					where: vi.fn((col: string, _op: string, cardId: number) => {
						if (col === "card_id") {
							mocks.deleteCalls.push({ card_id: cardId, removed: [] });
						}
						return {
							where: vi.fn((...args: unknown[]) => {
								if (args[0] === "vocabulary_id" && args[1] === "in") {
									const last = mocks.deleteCalls[mocks.deleteCalls.length - 1];
									last.removed = args[2] as number[];
								}
								return deleteChain;
							}),
						};
					}),
				};
			}
			throw new Error(`unexpected table ${table}`);
		}),
		insertInto: vi.fn((table: string) => {
			if (table === "card_labels") return insertChain;
			throw new Error(`unexpected table ${table}`);
		}),
	};
}

import { syncCardLabels } from "./card-labels.js";

describe("syncCardLabels", () => {
	beforeEach(() => {
		mocks.selectRows = [];
		mocks.insertCalls = [];
		mocks.deleteCalls = [];
	});

	it("inserts new labels and removes dropped ones", async () => {
		mocks.selectRows = [{ vocabulary_id: 1 }, { vocabulary_id: 2 }];
		const dbExec = createMockDbExec();

		const result = await syncCardLabels(dbExec as never, 10, [2, 3]);

		expect(result).toEqual({
			prev: [1, 2],
			added: [3],
			removed: [1],
		});
		expect(mocks.deleteCalls.some((c) => c.removed.includes(1))).toBe(true);
		expect(mocks.insertCalls).toEqual([{ card_id: 10, vocabulary_id: 3 }]);
	});

	it("clears all labels when next is empty", async () => {
		mocks.selectRows = [{ vocabulary_id: 5 }];
		const dbExec = createMockDbExec();

		const result = await syncCardLabels(dbExec as never, 10, []);

		expect(result).toEqual({
			prev: [5],
			added: [],
			removed: [5],
		});
	});

	it("is a no-op when labels unchanged", async () => {
		mocks.selectRows = [{ vocabulary_id: 4 }, { vocabulary_id: 7 }];
		const dbExec = createMockDbExec();

		const result = await syncCardLabels(dbExec as never, 10, [4, 7]);

		expect(result).toEqual({
			prev: [4, 7],
			added: [],
			removed: [],
		});
		expect(mocks.insertCalls).toEqual([]);
	});
});
