import { describe, expect, it } from "vitest";
import { ALICE, ATLAS, capturedDb } from "./my-work-test-support.js";
import { listMyWorkBoardRows } from "./my-work-data-source-list.js";
import { buildSearchPattern, escapeIlikePattern } from "./my-work-query.js";

describe("My Work search patterns", () => {
	it("escapes ILIKE metacharacters for literal matching", () => {
		expect(escapeIlikePattern("50%")).toBe("50\\%");
		expect(buildSearchPattern("50%")).toBe("%50\\%%");
	});

});

describe("My Work board shadow search boundary", () => {
	it("scopes shadow suppression to tracker rows that also match an All-scope query", async () => {
		const { executor, queries } = capturedDb();
		await listMyWorkBoardRows(executor, {
			userId: ALICE.id,
			workspaceIds: [ATLAS.id],
			scope: "all",
			q: "board-only-term",
			limit: 10,
		});

		const boardQuery = queries.find((entry) => entry.sql.includes('from "cards"'));
		expect(boardQuery).toBeDefined();
		expect(boardQuery?.sql).toContain('"tracker_items" as "shadow_ti"');
		expect(boardQuery?.sql).toContain('"shadow_ti"."title"');
		expect(boardQuery?.parameters).toContain("%board-only-term%");
		await executor.destroy();
	});
});
