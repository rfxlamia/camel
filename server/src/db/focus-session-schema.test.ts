import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schemaSql = readFileSync(
	new URL("./schema.sql", import.meta.url),
	"utf8",
);
const typesTs = readFileSync(new URL("./types.ts", import.meta.url), "utf8");

const focusSessionsBlock = schemaSql.match(
	/CREATE TABLE IF NOT EXISTS focus_sessions[\s\S]*?\n\);/,
)?.[0];

describe("focus_sessions schema DDL", () => {
	it("declares the personal-session columns and constraints", () => {
		expect(focusSessionsBlock).toBeTruthy();
		expect(schemaSql).toMatch(
			/CREATE TABLE IF NOT EXISTS focus_sessions/,
		);
		expect(focusSessionsBlock).toMatch(
			/user_id\s+INTEGER\s+NOT NULL\s+REFERENCES\s+users\s*\(\s*id\s*\)\s+ON DELETE CASCADE/i,
		);
		expect(focusSessionsBlock).toMatch(
			/workspace_id\s+INTEGER\s+NOT NULL\s+REFERENCES\s+workspaces\s*\(\s*id\s*\)\s+ON DELETE CASCADE/i,
		);
		expect(focusSessionsBlock).toMatch(
			/task_source\s+TEXT\s+NOT NULL/i,
		);
		expect(focusSessionsBlock).toMatch(
			/CHECK\s*\(\s*task_source\s+IN\s*\(\s*'board'\s*,\s*'tracker'\s*\)\s*\)/i,
		);
		const taskIdColumn = focusSessionsBlock?.match(
			/task_id\s+[^,\n]+/i,
		)?.[0];
		expect(taskIdColumn).toBeTruthy();
		expect(taskIdColumn).toMatch(/task_id\s+INTEGER\s+NOT NULL/i);
		expect(taskIdColumn).not.toMatch(/REFERENCES/i);
		expect(focusSessionsBlock).toMatch(/task_key\s+TEXT(?!\s+NOT NULL)/i);
		expect(focusSessionsBlock).toMatch(/return_path\s+TEXT\s+NOT NULL/i);
		expect(focusSessionsBlock).toMatch(/state\s+TEXT\s+NOT NULL/i);
		expect(focusSessionsBlock).toMatch(
			/CHECK\s*\(\s*state\s+IN\s*\(\s*'ready'\s*,\s*'running'\s*,\s*'paused'\s*,\s*'finished'\s*\)\s*\)/i,
		);
		expect(focusSessionsBlock).toMatch(
			/accumulated_seconds\s+INTEGER\s+NOT NULL\s+DEFAULT\s+0/i,
		);
		expect(focusSessionsBlock).toMatch(
			/CHECK\s*\(\s*accumulated_seconds\s*>=\s*0\s*\)/i,
		);
		expect(focusSessionsBlock).toMatch(/running_since\s+TIMESTAMPTZ/i);
		expect(focusSessionsBlock).not.toMatch(/running_since\s+TIMESTAMPTZ\s+NOT NULL/i);
		expect(focusSessionsBlock).toMatch(/version\s+INTEGER\s+NOT NULL\s+DEFAULT\s+1/i);
		expect(focusSessionsBlock).toMatch(
			/created_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT\s+now\(\)/i,
		);
		expect(focusSessionsBlock).toMatch(
			/updated_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT\s+now\(\)/i,
		);
		expect(focusSessionsBlock).toMatch(/finished_at\s+TIMESTAMPTZ/i);
		expect(focusSessionsBlock).not.toMatch(/finished_at\s+TIMESTAMPTZ\s+NOT NULL/i);
		expect(focusSessionsBlock).toMatch(
			/CHECK\s*\(\s*\(\s*state\s*=\s*'running'\s+AND\s+running_since\s+IS\s+NOT\s+NULL\s*\)\s+OR\s*\(\s*state\s*<>\s*'running'\s+AND\s+running_since\s+IS\s+NULL\s*\)\s*\)/i,
		);
	});

	it("enforces at most one non-finished session per (user, workspace)", () => {
		expect(schemaSql).toMatch(
			/CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*?ON focus_sessions\s*\(\s*user_id\s*,\s*workspace_id\s*\)[\s\S]*?WHERE\s+state\s*<>\s*'finished'/i,
		);
		expect(schemaSql).toMatch(
			/CREATE INDEX IF NOT EXISTS[\s\S]*?ON focus_sessions\s*\(\s*user_id\s*,\s*workspace_id\s*,\s*finished_at\s*\)/i,
		);
		const uniqueIndex = schemaSql.match(
			/CREATE UNIQUE INDEX IF NOT EXISTS[^;]*ON focus_sessions\s*\(\s*user_id\s*,\s*workspace_id\s*\)[^;]*;/i,
		)?.[0];
		expect(uniqueIndex).toBeTruthy();
		expect(uniqueIndex).toMatch(/WHERE\s+state\s*<>\s*'finished'/i);
	});
});

describe("focus_sessions Kysely types", () => {
	it("exposes focus_sessions on the DB registry", () => {
		expect(typesTs).toMatch(/export interface FocusSessions/);
		expect(typesTs).toMatch(/id:\s+Generated<number>/);
		expect(typesTs).toMatch(/version:\s+Generated<number>/);
		expect(typesTs).toMatch(/accumulated_seconds:\s+Generated<number>/);
		expect(typesTs).toMatch(/created_at:\s+Generated<Timestamp>/);
		expect(typesTs).toMatch(/updated_at:\s+Generated<Timestamp>/);
		expect(typesTs).toMatch(/running_since:\s+Timestamp \| null/);
		expect(typesTs).toMatch(/finished_at:\s+Timestamp \| null/);
		expect(typesTs).toMatch(/focus_sessions:\s+FocusSessions;/);
	});
});
