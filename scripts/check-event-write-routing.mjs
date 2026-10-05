#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "server/src";
// Only the choke points (and demo seeding, which writes actorless backdated
// events) may insert into the audit tables directly.
const ALLOWLIST = new Set([
	"server/src/lib/helpers.ts",
	"server/src/lib/tracker-activity.ts",
	"server/src/db/seed.ts",
]);
const FORBIDDEN = [
	/\.insertInto\(\s*["'`](card_events|tracker_events)["'`]\s*,?\s*\)/g,
	/\binsert\s+into\s+(card_events|tracker_events)\b/gi,
];
const SKIP = /\.(test|test-support|integration[\w.-]*)\.(ts|tsx)$/;

function walk(dir, files = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			walk(path, files);
		} else if (/\.(ts|tsx)$/.test(name)) {
			files.push(path);
		}
	}
	return files;
}

const violations = [];
for (const file of walk(ROOT)) {
	const rel = relative(".", file).replace(/\\/g, "/");
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
			violations.join("\n"),
	);
	process.exit(1);
}

console.log("Event write routing check passed.");
