#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(REPO_ROOT, "server/src");
// Only the choke points (and demo seeding, which writes actorless backdated
// events) may insert into the audit tables directly.
const ALLOWLIST = new Set([
	"server/src/lib/helpers.ts",
	"server/src/lib/tracker-activity.ts",
	"server/src/db/seed.ts",
]);
const TABLE = "(?:card_events|tracker_events)";
const FORBIDDEN = [
	// Kysely: .insertInto("card_events"), with optional generic / whitespace.
	new RegExp(
		`\\.insertInto\\s*(?:<[^<>]*>\\s*)?\\(\\s*["'\`]${TABLE}["'\`]`,
		"g",
	),
	// Raw SQL: optional schema prefix and quote/bracket around the name.
	new RegExp(
		`\\binsert\\s+into\\s+(?:["'\`\\[]?\\w+["'\`\\]]?\\.)?["'\`\\[]?${TABLE}\\b`,
		"gi",
	),
	// sql.table("card_events") / sql.id("card_events") interpolations.
	new RegExp(`\\bsql\\.(?:table|id)\\(\\s*["'\`]${TABLE}["'\`]`, "g"),
];
const SKIP = /\.(test|test-support)\.(ts|tsx)$/;

function walk(dir, files = []) {
	const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(path, files);
		} else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

if (!existsSync(ROOT)) {
	console.error(`Event write routing check: ${ROOT} not found.`);
	process.exit(1);
}

const violations = [];
for (const file of walk(ROOT)) {
	const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
	if (ALLOWLIST.has(rel) || SKIP.test(rel)) continue;

	const text = readFileSync(file, "utf8");
	for (const re of FORBIDDEN) {
		for (const match of text.matchAll(re)) {
			const line = text.slice(0, match.index).split("\n").length;
			violations.push(`${rel}:${line}: ${match[0].replace(/\s+/g, " ")}`);
		}
	}
}

if (violations.length > 0) {
	console.error(
		"Event write routing violations (use recordActivity / recordTrackerActivity):\n" +
			violations.sort().join("\n"),
	);
	process.exit(1);
}

console.log("Event write routing check passed.");
