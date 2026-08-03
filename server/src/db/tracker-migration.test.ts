// server/src/db/tracker-migration.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schemaSql = readFileSync(
	new URL("./schema.sql", import.meta.url),
	"utf8",
);

describe("tracker migration schema", () => {
	it("declares tracker tables, workspace counter, and junction tables", () => {
		expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS tracker_items");
		expect(schemaSql).toContain(
			"CREATE TABLE IF NOT EXISTS tracker_vocabularies",
		);
		expect(schemaSql).toContain(
			"CREATE TABLE IF NOT EXISTS tracker_item_labels",
		);
		expect(schemaSql).toContain(
			"CREATE TABLE IF NOT EXISTS tracker_item_assignees",
		);
		expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS tracker_events");
		expect(schemaSql).toMatch(
			/ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS tracker_key_counter/,
		);
		expect(schemaSql).toMatch(/tracker_items[\s\S]*version/s);
		expect(schemaSql).toMatch(/tracker_items[\s\S]*deleted_at/s);
		expect(schemaSql).toMatch(/tracker_items[\s\S]*key_number/s);
		expect(schemaSql).toMatch(/tracker_vocabularies[\s\S]*kind/s);
		expect(schemaSql).toMatch(/tracker_vocabularies[\s\S]*position/s);
	});

	it("seeds default vocabulary for existing workspaces idempotently", () => {
		expect(schemaSql).toMatch(/INSERT INTO tracker_vocabularies/i);
		const statusNames = [
			"Backlog",
			"Todo",
			"In Progress",
			"Done",
			"Canceled",
		];
		for (const name of statusNames) {
			expect(schemaSql).toContain(name);
		}
		for (const name of ["High", "Medium", "Low"]) {
			expect(schemaSql).toContain(name);
		}
		for (const name of ["Feature", "Bug", "Maintain"]) {
			expect(schemaSql).toContain(name);
		}
		expect(schemaSql).toMatch(/ON CONFLICT|WHERE NOT EXISTS/i);
	});
});
