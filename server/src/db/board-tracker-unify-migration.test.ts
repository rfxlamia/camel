import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schemaSql = readFileSync(
	new URL("./schema.sql", import.meta.url),
	"utf8",
);
const typesTs = readFileSync(new URL("./types.ts", import.meta.url), "utf8");

const unifyIndex = schemaSql.indexOf(
	"-- Board/tracker vocabulary unification (T2)",
);
const backfillIndex = schemaSql.indexOf("-- board-tracker unify backfill");
const keyBackfillIndex = schemaSql.indexOf("DO $board_tracker_key_backfill$");
const unifySql = schemaSql.slice(unifyIndex >= 0 ? unifyIndex : 0);

describe("board/tracker schema unification DDL", () => {
	it("declares nullable vocabulary slots with exactly five allowed markers", () => {
		expect(schemaSql).toMatch(
			/ALTER TABLE tracker_vocabularies ADD COLUMN IF NOT EXISTS slot TEXT/,
		);
		expect(schemaSql).toMatch(
			/CHECK\s*\(\s*slot\s+IN\s*\(\s*'backlog'\s*,\s*'todo'\s*,\s*'in_progress'\s*,\s*'done'\s*,\s*'canceled'\s*\)\s*\)/,
		);
		expect(schemaSql).not.toMatch(
			/ADD COLUMN IF NOT EXISTS slot TEXT\s+NOT NULL/,
		);
		expect(schemaSql).toMatch(
			/CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*?ON tracker_vocabularies\s*\(\s*workspace_id\s*,\s*slot\s*\)[\s\S]*?WHERE\s+kind\s*=\s*'status'\s+AND\s+slot\s+IS\s+NOT\s+NULL/i,
		);
	});

	it("adds cards.status_id without ON DELETE SET NULL and swaps legacy FK", () => {
		const statusIdColumn = schemaSql.match(
			/ALTER TABLE cards ADD COLUMN IF NOT EXISTS status_id INTEGER[^;]*;/,
		)?.[0];
		expect(statusIdColumn).toBeTruthy();
		expect(statusIdColumn).not.toMatch(/ON DELETE SET NULL/);
		expect(schemaSql).toMatch(/DO \$cards_status_id_fk\$[\s\S]*?confdeltype = 'n'/);
		expect(schemaSql).toMatch(
			/ADD CONSTRAINT cards_status_id_fkey[\s\S]*?FOREIGN KEY \(status_id\) REFERENCES tracker_vocabularies\(id\);/,
		);
	});

	it("adds all nullable card identity and taxonomy columns idempotently", () => {
		for (const column of [
			"status_id",
			"key_number",
			"priority_id",
			"project_id",
			"phase_id",
		]) {
			const declaration = schemaSql.match(
				new RegExp(
					`ALTER TABLE cards ADD COLUMN IF NOT EXISTS ${column} INTEGER[^;]*;`,
				),
			)?.[0];
			expect(declaration, column).toBeTruthy();
			expect(declaration, column).not.toMatch(/NOT NULL/);
		}
		expect(typesTs).toMatch(/status_id:\s+number \| null/);
		expect(typesTs).toMatch(/key_number:\s+number \| null/);
		expect(typesTs).toMatch(/priority_id:\s+number \| null/);
		expect(typesTs).toMatch(/project_id:\s+number \| null/);
		expect(typesTs).toMatch(/phase_id:\s+number \| null/);
	});

	it("creates card_labels with card and vocabulary foreign keys", () => {
		const cardLabels = schemaSql.match(
			/CREATE TABLE IF NOT EXISTS card_labels[\s\S]*?\n\);/,
		)?.[0];
		expect(cardLabels).toBeTruthy();
		expect(cardLabels).toMatch(
			/card_id\s+INTEGER\s+NOT NULL\s+REFERENCES\s+cards\s*\(id\)\s+ON DELETE CASCADE/i,
		);
		expect(cardLabels).toMatch(
			/vocabulary_id\s+INTEGER\s+NOT NULL\s+REFERENCES\s+tracker_vocabularies\s*\(id\)\s+ON DELETE CASCADE/i,
		);
		expect(cardLabels).not.toMatch(/tracker_item_labels/);
		expect(typesTs).toMatch(/card_labels:\s+CardLabels;/);
		expect(typesTs).toMatch(
			/export interface CardLabels[\s\S]*?card_id: number;/,
		);
	});

	it("adds live-key, foreign-key and label-vocabulary query indexes", () => {
		for (const column of [
			"status_id",
			"priority_id",
			"project_id",
			"phase_id",
		]) {
			expect(unifySql).toMatch(
				new RegExp(
					`CREATE INDEX IF NOT EXISTS[^;]*ON cards\\s*\\(\\s*${column}\\s*\\)[^;]*;`,
					"i",
				),
			);
		}
		expect(unifySql).toMatch(
			/CREATE INDEX IF NOT EXISTS[^;]*ON cards\s*\(\s*workspace_id\s*,\s*key_number\s*\)[^;]*WHERE\s+deleted_at\s+IS\s+NULL/i,
		);
		expect(unifySql).toMatch(
			/CREATE INDEX IF NOT EXISTS[^;]*ON card_labels\s*\(\s*vocabulary_id\s*\)/i,
		);
	});

	it("does not add a card-level workspace/key unique constraint", () => {
		const cardsBlock = schemaSql.slice(
			schemaSql.indexOf("CREATE TABLE IF NOT EXISTS cards"),
			schemaSql.indexOf("CREATE TABLE IF NOT EXISTS card_events"),
		);
		expect(cardsBlock).not.toMatch(
			/UNIQUE\s*\([^)]*workspace_id[^)]*key_number/i,
		);
		expect(unifySql).not.toMatch(
			/CREATE UNIQUE INDEX IF NOT EXISTS[^;]*ON cards[^;]*key_number/i,
		);
	});
});

describe("board/tracker migration seed and backfill contract", () => {
	it("orders DDL/indexes before slot seed/update and null-only backfills", () => {
		expect(unifyIndex).toBeGreaterThan(-1);
		expect(backfillIndex).toBeGreaterThan(unifyIndex);
		expect(unifySql).toMatch(/DDL|index/i);
		expect(unifySql).toMatch(/slot\s+IS\s+NULL/);
		expect(schemaSql.slice(backfillIndex)).toMatch(/status_id\s+IS\s+NULL/);
		expect(schemaSql.slice(backfillIndex)).toMatch(/key_number\s+IS\s+NULL/);
	});

	it("seeds all five status slots and leaves priorities and labels unslotted", () => {
		for (const slot of ["backlog", "todo", "in_progress", "done", "canceled"]) {
			expect(unifySql).toContain(`'${slot}'`);
		}
		expect(unifySql).toMatch(/priority[\s\S]*slot[^\n]*NULL/i);
		expect(unifySql).toMatch(/label[\s\S]*slot[^\n]*NULL/i);
		expect(unifySql).toMatch(
			/UPDATE tracker_vocabularies[\s\S]*?SET\s+slot\s*=[\s\S]*?slot\s+IS\s+NULL/i,
		);
	});

	it("guards every board_id reference behind the information-schema branch", () => {
		expect(unifySql).toMatch(/information_schema\.columns/);
		expect(unifySql).toMatch(/column_name\s*=\s*'board_id'/i);
		expect(unifySql).toMatch(/EXECUTE\s+['$]/i);
		expect(unifySql).toMatch(/IS\s+NOT\s+DISTINCT\s+FROM/i);
		const nonDynamic = unifySql
			.replace(/EXECUTE\s+\$[^$]*\$[\s\S]*?\$[^$]*\$/gi, "")
			.replace(/EXECUTE\s+'(?:''|[^'])*'/gi, "");
		expect(nonDynamic).not.toMatch(/\bcolumns?\.board_id\b/i);
	});

	it("maps statuses null-only, includes deleted cards, and never writes timestamps", () => {
		const backfillSql = schemaSql.slice(backfillIndex);
		const statusBackfillSql = schemaSql.slice(backfillIndex, keyBackfillIndex);
		expect(backfillSql).toMatch(/UPDATE\s+cards[\s\S]*?SET\s+status_id\s*=/i);
		expect(backfillSql).toMatch(/status_id\s+IS\s+NULL/i);
		expect(statusBackfillSql).not.toMatch(/deleted_at\s+IS\s+NULL/i);
		expect(backfillSql).not.toMatch(/\b(started_at|done_at)\s*=/i);
	});

	it("sets status_id NOT NULL only after all cards are mapped", () => {
		const guardBlock = schemaSql.match(
			/DO \$board_tracker_status_not_null\$[\s\S]*?END \$board_tracker_status_not_null\$;/,
		)?.[0];
		expect(guardBlock).toBeTruthy();
		expect(guardBlock).toMatch(/information_schema\.columns/);
		expect(guardBlock).toMatch(/is_nullable\s*=\s*'YES'/);
		expect(guardBlock).toMatch(
			/NOT EXISTS\s*\(\s*SELECT 1\s+FROM cards\s+WHERE status_id IS NULL\s*\)/i,
		);
	});

	it("allocates keys only for live null-key cards under workspace locks", () => {
		const backfillSql = schemaSql.slice(backfillIndex);
		expect(backfillSql).toMatch(/FOR\s+UPDATE/i);
		expect(backfillSql).toMatch(
			/tracker_key_counter\s*=\s*tracker_key_counter\s*\+\s*1/i,
		);
		expect(backfillSql).toMatch(
			/deleted_at\s+IS\s+NULL[\s\S]*?key_number\s+IS\s+NULL/i,
		);
		expect(backfillSql).not.toMatch(
			/UPDATE\s+cards[\s\S]*?key_number\s*=\s*NULL/i,
		);
	});
});
