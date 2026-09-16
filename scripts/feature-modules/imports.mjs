import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { KERNEL_IN_WAITING, SCAN_ROOTS } from "./map.mjs";

export const DEEP_IMPORT_RULE_ID = "FM-RULE-4";
export const ONE_WAY_RULE_ID = "FM-RULE-4";
export const MISSING_INDEX_RULE_ID = "FM-RULE-4";
export const FORBIDDEN_FEATURE_RULE_ID = "FM-RULE-4";

const TS_SOURCE = /\.(ts|tsx)$/i;
const TEST_FILE = /\.(test|integration\.test)\.(ts|tsx)$/i;

/** Composition roots must import module index only (not deep paths). */
const COMPOSITION_ROOTS = new Set([
	"server/src/routes.ts",
	"server/src/index.ts",
	"client/src/App.tsx",
	"client/src/main.tsx",
]);

/** Server kernel prefixes (importable from any feature module). */
const SERVER_KERNEL_PREFIXES = [
	"server/src/core/",
	"server/src/lib/",
	"server/src/db/",
	"server/src/middleware/",
	"server/src/realtime/",
	"server/src/validators/",
	"server/src/config.ts",
	"server/src/auth.ts",
];

/** Client kernel prefixes. */
const CLIENT_KERNEL_PREFIXES = [
	"client/src/shared/",
	"client/src/layout/",
];

/** Legacy type-folder trees where modules must not deep-import feature code. */
const LEGACY_FEATURE_PREFIXES = [
	"server/src/routes/",
	"client/src/components/",
	"client/src/pages/",
	"client/src/hooks/",
	"client/src/context/",
	"client/src/lib/",
	"server/src/agent/",
	"server/src/chat/",
	"server/src/notifications/",
	"client/src/chat/",
];

const FORBIDDEN_PRODUCT_FEATURES = new Set(["work-items"]);

/**
 * @param {string} path POSIX path
 */
function toPosix(path) {
	return path.replace(/\\/g, "/");
}

/**
 * @param {string} filePath POSIX path relative to repo root
 */
function fileDir(filePath) {
	const dir = dirname(filePath);
	return dir === "." ? "" : dir;
}

/**
 * @param {string} fromDir POSIX dir (no trailing slash) relative to repo root
 * @param {string} specifier
 */
function resolveRelativeSpecifier(fromDir, specifier) {
	const raw = specifier.split("?")[0];
	const joined = fromDir ? `${fromDir}/${raw}` : raw;
	const parts = joined.split("/");
	/** @type {string[]} */
	const out = [];
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			out.pop();
			continue;
		}
		out.push(part);
	}
	return toPosix(out.join("/"));
}

/**
 * Strip .js/.ts/.tsx extension for logical path comparison.
 * @param {string} path
 */
function stripExtension(path) {
	return path.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");
}

/**
 * @param {string} resolved POSIX path (may include extension)
 */
function isIndexImport(resolved) {
	const base = stripExtension(resolved);
	return base.endsWith("/index") || base.endsWith("/index/index");
}

/**
 * @param {string} path POSIX without requiring extension
 */
function parseFeatureModuleTarget(path) {
	const noExt = stripExtension(path);
	const server = noExt.match(/^(server\/src\/modules\/([^/]+))(?:\/(.*))?$/);
	if (server) {
		const rest = server[3];
		if (!rest || rest === "index") {
			return { side: "server", feature: server[2], deep: false, root: server[1] };
		}
		return { side: "server", feature: server[2], deep: true, root: server[1] };
	}
	const client = noExt.match(/^(client\/src\/features\/([^/]+))(?:\/(.*))?$/);
	if (client) {
		const rest = client[3];
		if (!rest || rest === "index") {
			return { side: "client", feature: client[2], deep: false, root: client[1] };
		}
		return { side: "client", feature: client[2], deep: true, root: client[1] };
	}
	return null;
}

/**
 * @param {string} filePath
 */
function parseImporterFeature(filePath) {
	const server = filePath.match(/^server\/src\/modules\/([^/]+)\//);
	if (server) return { side: "server", feature: server[1] };
	const client = filePath.match(/^client\/src\/features\/([^/]+)\//);
	if (client) return { side: "client", feature: client[1] };
	return null;
}

/**
 * @param {string} path
 */
function isKernelPath(path) {
	const noExt = stripExtension(path);
	if (SERVER_KERNEL_PREFIXES.some((p) => noExt === stripExtension(p) || noExt.startsWith(stripExtension(p)))) {
		return true;
	}
	if (CLIENT_KERNEL_PREFIXES.some((p) => noExt.startsWith(stripExtension(p)))) {
		return true;
	}
	return false;
}

/**
 * @param {string} path
 * @param {string[]} allowlist
 */
function isAllowlistedKernelInWaiting(path, allowlist) {
	const noExt = stripExtension(path);
	return allowlist.some((entry) => noExt === stripExtension(entry));
}

/**
 * @param {string} path
 */
function isLegacyFeaturePath(path) {
	return LEGACY_FEATURE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * @param {string} source
 * @returns {string[]}
 */
export function extractImportSpecifiers(source) {
	/** @type {string[]} */
	const specifiers = [];

	let i = 0;
	const len = source.length;

	while (i < len) {
		const ch = source[i];

		// Line comment
		if (ch === "/" && source[i + 1] === "/") {
			i += 2;
			while (i < len && source[i] !== "\n") i++;
			continue;
		}

		// Block comment
		if (ch === "/" && source[i + 1] === "*") {
			i += 2;
			while (i < len - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
			i += 2;
			continue;
		}

		// Template literal (skip — may contain specifier-like text)
		if (ch === "`") {
			i++;
			while (i < len) {
				if (source[i] === "\\") {
					i += 2;
					continue;
				}
				if (source[i] === "`") {
					i++;
					break;
				}
				i++;
			}
			continue;
		}

		// String literal (skip)
		if (ch === "'" || ch === '"') {
			const quote = ch;
			i++;
			while (i < len) {
				if (source[i] === "\\") {
					i += 2;
					continue;
				}
				if (source[i] === quote) {
					i++;
					break;
				}
				i++;
			}
			continue;
		}

		// import( '...' ) dynamic
		if (source.startsWith("import(", i)) {
			const match = source.slice(i).match(/^import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
			if (match) {
				specifiers.push(match[1]);
				i += match[0].length;
				continue;
			}
		}

		// import ... from '...' | export ... from '...'
		const staticImport = source.slice(i).match(
			/^(?:import\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+)['"]([^'"]+)['"]/,
		);
		if (staticImport) {
			specifiers.push(staticImport[1]);
			i += staticImport[0].length;
			continue;
		}

		i++;
	}

	return specifiers;
}

/**
 * @param {string} resolved POSIX path from relative specifier
 */
function classifyModuleTarget(resolved) {
	const direct = parseFeatureModuleTarget(resolved);
	if (direct) return direct;
	// Extensionless file path (e.g. .../board/cards-update)
	return parseFeatureModuleTarget(stripExtension(resolved));
}

/**
 * @param {string} filePath
 * @param {string} specifier
 * @param {string} resolved
 * @param {import("./map.mjs")} mapConfig
 */
function checkSpecifier({ filePath, specifier, resolved, mapConfig }) {
	/** @type {string[]} */
	const violations = [];
	const allowlist = mapConfig.KERNEL_IN_WAITING ?? KERNEL_IN_WAITING;

	const importerFeature = parseImporterFeature(filePath);
	const target = classifyModuleTarget(resolved);

	if (target?.feature && FORBIDDEN_PRODUCT_FEATURES.has(target.feature)) {
		violations.push(
			`${filePath}: ${FORBIDDEN_FEATURE_RULE_ID}: forbidden product feature "${target.feature}" (${specifier})`,
		);
		return violations;
	}

	if (target?.deep) {
		const sameModule =
			importerFeature &&
			importerFeature.side === target.side &&
			importerFeature.feature === target.feature;

		if (!sameModule && !isIndexImport(resolved)) {
			violations.push(
				`${filePath}: ${DEEP_IMPORT_RULE_ID}: deep import into feature module "${target.feature}" must use index.ts (${specifier})`,
			);
		}
	}

	if (importerFeature && isKernelPath(resolved)) {
		return violations;
	}

	if (importerFeature && isLegacyFeaturePath(resolved)) {
		if (!isAllowlistedKernelInWaiting(resolved, allowlist)) {
			violations.push(
				`${filePath}: ${ONE_WAY_RULE_ID}: module must not import legacy feature file (${specifier})`,
			);
		}
	}

	return violations;
}

/**
 * @param {{ filePath: string, source: string, map: import("./map.mjs") }} input
 * @returns {string[]}
 */
export function checkImports({ filePath, source, map: mapConfig }) {
	const normalizedPath = toPosix(filePath);
	if (!TS_SOURCE.test(normalizedPath)) return [];

	const fromDir = fileDir(normalizedPath);
	/** @type {string[]} */
	const violations = [];

	for (const specifier of extractImportSpecifiers(source)) {
		if (!specifier.startsWith(".")) continue;
		const resolved = resolveRelativeSpecifier(fromDir, specifier);
		violations.push(
			...checkSpecifier({
				filePath: normalizedPath,
				specifier,
				resolved,
				mapConfig,
			}),
		);
	}

	return violations;
}

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
		for (const [side, prefix] of [
			["server", `server/src/modules/${feature}`],
			["client", `client/src/features/${feature}`],
		]) {
			const dirAbs = join(rootDir, prefix);
			if (!existsSync(dirAbs)) continue;
			const files = listModuleSourceFiles(dirAbs, prefix);
			if (files.length === 0) continue;
			const hasIndex = files.some((f) => /\/index\.tsx?$/.test(f));
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
