// Source contract: after the single-table merge nothing writes to the old
// tracker tables any more. The scan reads non-test server TypeScript as text.
// `.sql` files are out of scope on purpose: db/schema.sql legitimately UPDATEs
// tracker_items and the merge SQL writes `migrated_to_id`.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SERVER_SRC = join(REPO_ROOT, "server/src");
// Still defines `insertInto("tracker_events")` itself until the old tables go (T21).
const DEFINITION_FILE = "server/src/lib/tracker-activity.ts";
const OLD_TABLES =
	"(?:tracker_items|tracker_item_labels|tracker_item_assignees|tracker_events)";
const WRITERS: RegExp[] = [
	// Kysely: insertInto / updateTable / deleteFrom, optional generic and alias.
	new RegExp(
		`\\b(?:insertInto|updateTable|deleteFrom)\\s*(?:<[^<>]*>\\s*)?\\(\\s*["'\`]${OLD_TABLES}\\b`,
	),
	// Raw SQL.
	new RegExp(
		`\\b(?:insert\\s+into|update|delete\\s+from)\\s+${OLD_TABLES}\\b`,
		"i",
	),
	// The old audit writer.
	/\brecordTrackerActivity\s*\(/,
];

/** Drops comments, keeping string and template literals intact. */
export function stripComments(source: string): string {
	return source.replace(
		/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
		(_match, literal?: string) => literal ?? "",
	);
}

function isNonTestSource(rel: string): boolean {
	return (
		/\.tsx?$/.test(rel) &&
		!/\.test\.tsx?$/.test(rel) &&
		!/test-support/.test(rel) &&
		!/\.integration\.[^/]*\.tsx?$/.test(rel)
	);
}

function walk(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walk(path, files);
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

function findWriters(): string[] {
	const hits: string[] = [];
	for (const file of walk(SERVER_SRC)) {
		const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
		if (!isNonTestSource(rel) || rel === DEFINITION_FILE) continue;
		const text = stripComments(readFileSync(file, "utf8"));
		for (const re of WRITERS) {
			const match = re.exec(text);
			if (match) {
				const line = text.slice(0, match.index).split("\n").length;
				hits.push(`${rel}:${line}: ${match[0]}`);
			}
		}
	}
	return hits;
}

describe("no writer to the old tracker tables remains", () => {
	it("scanner ignores comments but catches a real writer", () => {
		const commented = `// insertInto("tracker_items")\n/* recordTrackerActivity( */`;
		const real = `await db.insertInto("tracker_items").values({}).execute();`;
		const stripped = stripComments(commented);
		expect(WRITERS.some((re) => re.test(stripped))).toBe(false);
		expect(WRITERS.some((re) => re.test(stripComments(real)))).toBe(true);
	});

	it("non-test server sources never write tracker_items, labels, assignees or events", () => {
		expect(findWriters()).toEqual([]);
	});

	it("only the audit choke points stay allowlisted for event writes", () => {
		const script = readFileSync(
			join(REPO_ROOT, "scripts/check-event-write-routing.mjs"),
			"utf8",
		);
		const block = /new Set\(\[([\s\S]*?)\]\)/.exec(script);
		expect(block).not.toBeNull();
		const entries = [...block![1].matchAll(/["']([^"']+)["']/g)].map(
			(m) => m[1],
		);
		expect(entries.sort()).toEqual([
			"server/src/db/seed.ts",
			"server/src/lib/helpers.ts",
			"server/src/lib/tracker-activity.ts",
		]);
	});
});
