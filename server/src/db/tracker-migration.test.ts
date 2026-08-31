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

	it("keeps tracker vocabulary slots distinct from category semantics", () => {
		expect(schemaSql).toMatch(
			/ALTER TABLE tracker_vocabularies ADD COLUMN IF NOT EXISTS slot TEXT/,
		);
		expect(schemaSql).toMatch(/slot\s+IN\s*\(\s*'backlog'/);
		expect(schemaSql).toMatch(/slot\s+IN[\s\S]*'canceled'/);
		const categoryBlock = schemaSql.slice(
			schemaSql.indexOf("-- tracker: category backfill"),
		);
		expect(categoryBlock).not.toMatch(/slot\s*=/);
	});
});

describe("project, phase and item scheduling columns", () => {
	it("declares tracker_projects and tracker_phases with the required shape", () => {
		expect(schemaSql).toMatch(/CREATE TABLE IF NOT EXISTS tracker_projects/);
		expect(schemaSql).toMatch(/CREATE TABLE IF NOT EXISTS tracker_phases/);
		expect(schemaSql).toMatch(/tracker_projects[\s\S]*?position\s+DOUBLE PRECISION/);
		expect(schemaSql).toMatch(/tracker_projects[\s\S]*?deleted_at\s+TIMESTAMPTZ/);
		expect(schemaSql).toMatch(
			/tracker_phases[\s\S]*?project_id\s+INTEGER NOT NULL REFERENCES tracker_projects/,
		);
	});

	it("adds project_id, phase_id, dates, completed_at and position to tracker_items", () => {
		expect(schemaSql).toMatch(
			/ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES tracker_projects/,
		);
		expect(schemaSql).toMatch(
			/ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS phase_id INTEGER REFERENCES tracker_phases/,
		);
		expect(schemaSql).toMatch(
			/ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS start_date DATE/,
		);
		expect(schemaSql).toMatch(
			/ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS end_date DATE/,
		);
		expect(schemaSql).toMatch(
			/ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ/,
		);
		expect(schemaSql).toMatch(
			/ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION/,
		);
		// Nullable — the guarded backfill depends on this staying non-NOT-NULL.
		expect(schemaSql).not.toMatch(
			/ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION NOT NULL/,
		);
	});

	it("adds a nullable category column to tracker_vocabularies", () => {
		expect(schemaSql).toMatch(
			/ALTER TABLE tracker_vocabularies ADD COLUMN IF NOT EXISTS category TEXT/,
		);
	});

	it("guards the position and category backfills with WHERE ... IS NULL", () => {
		const positionBackfill = schemaSql.match(
			/UPDATE tracker_items[\s\S]{0,500}?position[\s\S]{0,200}?;/,
		)?.[0];
		expect(positionBackfill).toBeTruthy();
		expect(positionBackfill).toMatch(/WHERE[\s\S]*position IS NULL/);
		expect(positionBackfill).toMatch(
			/PARTITION BY workspace_id,\s*project_id,\s*phase_id/,
		);

		const categoryBackfill = schemaSql.match(
			/-- tracker: category backfill[\s\S]{0,600}?UPDATE tracker_vocabularies[\s\S]{0,600}?category[\s\S]{0,300}?;/,
		)?.[0];
		expect(categoryBackfill).toBeTruthy();
		expect(categoryBackfill).toMatch(/WHERE[\s\S]*category IS NULL/);
	});

	it("maps every seeded status name to its category and catches the rest as backlog", () => {
		expect(schemaSql).toMatch(/Backlog[\s\S]{0,120}'backlog'/);
		expect(schemaSql).toMatch(/Todo[\s\S]{0,120}'backlog'/);
		expect(schemaSql).toMatch(/In Progress[\s\S]{0,120}'started'/);
		expect(schemaSql).toMatch(/Done[\s\S]{0,120}'completed'/);
		expect(schemaSql).toMatch(/Canceled[\s\S]{0,120}'canceled'/);
		// A grandfathered, never-listed status still gets categorised.
		expect(schemaSql).toMatch(
			/category\s*=\s*'backlog'[\s\S]{0,200}WHERE category IS NULL/,
		);
	});

	it("positions the category backfill after the retroactive vocabulary seed block", () => {
		const seedIndex = schemaSql.indexOf("INSERT INTO tracker_vocabularies");
		const categoryBackfillIndex = schemaSql.indexOf(
			"-- tracker: category backfill",
		);
		expect(seedIndex).toBeGreaterThan(-1);
		expect(categoryBackfillIndex).toBeGreaterThan(seedIndex);
	});

	it("scopes the project-name and phase-name partial unique indexes to live rows", () => {
		expect(schemaSql).toMatch(
			/CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]{0,80}ON tracker_projects[\s\S]{0,80}lower\(name\)[\s\S]{0,80}WHERE deleted_at IS NULL/,
		);
		expect(schemaSql).toMatch(
			/CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]{0,80}ON tracker_phases[\s\S]{0,80}lower\(name\)[\s\S]{0,80}WHERE deleted_at IS NULL/,
		);
	});

	it("never backfills or approximates completed_at", () => {
		expect(schemaSql).not.toMatch(/completed_at\s*=\s*updated_at/);
		const alterBlock = schemaSql.slice(schemaSql.indexOf("tracker_projects"));
		expect(alterBlock).not.toMatch(/UPDATE tracker_items[\s\S]*?completed_at\s*=\s*now\(\)/);
	});
});
