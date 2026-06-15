import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planLegacyWorkspaceMigration } from "./migrateHelpers.js";

const schemaSql = readFileSync(
	new URL("./schema.sql", import.meta.url),
	"utf8",
);

describe("workspace migration foundation", () => {
	it("schema.sql declares workspace tables, scoped columns, and constraints", () => {
		expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS workspaces");
		expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS workspace_members");
		expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS workspace_invites");
		expect(schemaSql).toMatch(
			/ALTER TABLE columns ADD COLUMN IF NOT EXISTS workspace_id/,
		);
		expect(schemaSql).toMatch(
			/ALTER TABLE cards ADD COLUMN IF NOT EXISTS workspace_id/,
		);
		expect(schemaSql).toMatch(
			/ALTER TABLE card_events ADD COLUMN IF NOT EXISTS workspace_id/,
		);
		expect(schemaSql).toMatch(
			/ALTER TABLE settings ADD COLUMN IF NOT EXISTS workspace_id/,
		);
		expect(schemaSql).toMatch(
			/PRIMARY KEY.*workspace_id.*key|PRIMARY KEY.*key.*workspace_id/s,
		);
		expect(schemaSql).toMatch(
			/UNIQUE.*user_id.*workspace_id|UNIQUE.*workspace_id.*user_id/s,
		);
		expect(schemaSql).toMatch(
			/UNIQUE.*workspace_id.*username|UNIQUE.*username.*workspace_id/s,
		);
	});

	it("plans idempotent default and personal workspace assignment", () => {
		const firstRun = planLegacyWorkspaceMigration({
			workspaceCount: 0,
			users: [
				{ id: 1, username: "alice", displayName: "Alice" },
				{ id: 2, username: "bob", displayName: "Bob" },
				{ id: 3, username: "carol", displayName: "Carol" },
			],
			legacyColumnIds: [10, 11],
			legacyCardIds: [20],
			legacySettingKeys: ["board_name"],
		});

		expect(firstRun.defaultWorkspace).toMatchObject({
			name: "Default Workspace",
			ownerUserId: 1,
		});
		expect(firstRun.defaultMembers).toEqual([
			{ userId: 1, role: "owner" },
			{ userId: 2, role: "member" },
			{ userId: 3, role: "member" },
		]);
		expect(firstRun.personalWorkspaces).toHaveLength(3);
		expect(firstRun.personalWorkspaces.every((ws) => ws.isPersonal)).toBe(true);
		expect(firstRun.assignments).toMatchObject({
			columns: [10, 11],
			cards: [20],
			settings: ["board_name"],
		});

		const secondRun = planLegacyWorkspaceMigration({
			workspaceCount: 4,
			users: [{ id: 1, username: "alice", displayName: "Alice" }],
			legacyColumnIds: [10],
			legacyCardIds: [20],
			legacySettingKeys: ["board_name"],
		});
		expect(secondRun.operations).toEqual([]);
	});
});
