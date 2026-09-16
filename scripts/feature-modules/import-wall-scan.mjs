import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FORBIDDEN_PRODUCT_FEATURES, toPosix } from "./import-paths.mjs";
import {
	FORBIDDEN_FEATURE_RULE_ID,
	checkImports,
	MISSING_INDEX_RULE_ID,
} from "./import-wall-rules.mjs";
import { SCAN_ROOTS } from "./map.mjs";

const TS_SOURCE = /\.(ts|tsx)$/i;
const TEST_FILE = /\.(test|integration\.test)\.(ts|tsx)$/i;

/**
 * @param {string} dirAbs
 * @param {string} relPrefix POSIX e.g. server/src/modules/board
 */
function listModuleSourceFiles(dirAbs, relPrefix) {
	/** @type {string[]} */
	const files = [];
	if (!existsSync(dirAbs)) return files;

	for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
		const rel = `${relPrefix}/${entry.name}`;
		if (entry.isDirectory()) {
			files.push(...listModuleSourceFiles(join(dirAbs, entry.name), rel));
			continue;
		}
		if (!TS_SOURCE.test(entry.name)) continue;
		if (TEST_FILE.test(entry.name)) continue;
		files.push(toPosix(rel));
	}
	return files;
}

/**
 * @param {string} rootDir absolute repo root
 * @param {import("./map.mjs")} mapConfig
 * @returns {string[]}
 */
export function checkMissingModuleIndexes({ rootDir, map: mapConfig }) {
	/** @type {string[]} */
	const violations = [];
	const featureSet = new Set(mapConfig.FEATURES);

	for (const feature of featureSet) {
		for (const prefix of [
			`server/src/modules/${feature}`,
			`client/src/features/${feature}`,
		]) {
			const dirAbs = join(rootDir, prefix);
			if (!existsSync(dirAbs)) continue;
			const files = listModuleSourceFiles(dirAbs, prefix);
			if (files.length === 0) continue;
			const hasIndex =
				existsSync(join(dirAbs, "index.ts")) ||
				existsSync(join(dirAbs, "index.tsx"));
			if (!hasIndex) {
				violations.push(
					`${prefix}: ${MISSING_INDEX_RULE_ID}: module tree has source files but no index.ts`,
				);
			}
		}
	}

	for (const forbidden of FORBIDDEN_PRODUCT_FEATURES) {
		const clientPath = `client/src/features/${forbidden}`;
		const dirAbs = join(rootDir, clientPath);
		if (!existsSync(dirAbs)) continue;
		const files = listModuleSourceFiles(dirAbs, clientPath);
		for (const f of files) {
			violations.push(
				`${f}: ${FORBIDDEN_FEATURE_RULE_ID}: work-items is not a product feature module`,
			);
		}
	}

	return violations;
}

/**
 * @param {string} dirAbs
 * @param {string} relPrefix
 * @param {(relPath: string, source: string) => void} visit
 */
function walkScanTree(dirAbs, relPrefix, visit) {
	if (!existsSync(dirAbs)) return;
	for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
		const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
		const abs = join(dirAbs, entry.name);
		if (entry.isDirectory()) {
			walkScanTree(abs, rel, visit);
			continue;
		}
		if (!TS_SOURCE.test(entry.name)) continue;
		const source = readFileSync(abs, "utf8");
		visit(toPosix(rel), source);
	}
}

/**
 * @param {{ rootDir: string, map: import("./map.mjs") }} input
 * @returns {string[]}
 */
export function collectImportViolations({ rootDir, map: mapConfig }) {
	/** @type {string[]} */
	const violations = [];

	for (const scanRoot of SCAN_ROOTS) {
		const abs = join(rootDir, scanRoot);
		walkScanTree(abs, scanRoot, (relPath, source) => {
			violations.push(
				...checkImports({ filePath: relPath, source, map: mapConfig }),
			);
		});
	}

	violations.push(...checkMissingModuleIndexes({ rootDir, map: mapConfig }));

	return violations;
}
