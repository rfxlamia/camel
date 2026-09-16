import { SCAN_ROOTS } from "./map.mjs";
import { isKernelPath } from "./import-paths.mjs";

export const PLACEMENT_RULE_ID = "FM-RULE-1";

const TS_SOURCE = /\.(ts|tsx)$/i;

/** Legacy type-folder trees where new source files are forbidden (Rule 1). */
const FORBIDDEN_PREFIXES = [
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
	"server/src/__tests__/",
];

/**
 * @param {string} path POSIX path relative to repo root
 */
function isPlacementScope(path) {
	if (!TS_SOURCE.test(path)) return false;
	return SCAN_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

function isMappedModulePath(path, featureSet) {
	const serverMatch = path.match(/^server\/src\/modules\/([^/]+)\//);
	if (serverMatch && featureSet.has(serverMatch[1])) return true;

	const clientMatch = path.match(/^client\/src\/features\/([^/]+)\//);
	if (clientMatch && featureSet.has(clientMatch[1])) return true;

	return false;
}

/**
 * @param {string} path
 */
function isSrcRootSibling(path) {
	for (const root of SCAN_ROOTS) {
		if (!path.startsWith(`${root}/`)) continue;
		const rest = path.slice(root.length + 1);
		if (rest.length > 0 && !rest.includes("/")) return true;
	}
	return false;
}

/**
 * @param {string} path
 * @param {Set<string>} featureSet
 */
function isUnmappedModulePath(path, featureSet) {
	const serverMatch = path.match(/^server\/src\/modules\/([^/]+)\//);
	if (serverMatch && !featureSet.has(serverMatch[1])) return true;

	const clientMatch = path.match(/^client\/src\/features\/([^/]+)\//);
	if (clientMatch && !featureSet.has(clientMatch[1])) return true;

	return false;
}

/**
 * @param {string} path
 */
function isForbiddenLegacyTree(path) {
	return FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * @param {string} path
 * @param {string} detail
 */
function placementViolation(path, detail) {
	return [`${path}: ${PLACEMENT_RULE_ID}: ${detail}`];
}

/**
 * @param {{ path: string, status: string, map: { FEATURES: string[] } }} input
 * @returns {string[]}
 */
export function checkPlacement({ path, status, map }) {
	if (status !== "new") return [];
	if (!isPlacementScope(path)) return [];

	const featureSet = new Set(map.FEATURES);
	if (isMappedModulePath(path, featureSet)) return [];
	if (isKernelPath(path)) return [];

	if (isForbiddenLegacyTree(path)) {
		return placementViolation(
			path,
			"new file must not be added under a legacy type-folder tree",
		);
	}
	if (isSrcRootSibling(path)) {
		return placementViolation(
			path,
			"new file must not be added as a direct child of client/src or server/src",
		);
	}
	if (isUnmappedModulePath(path, featureSet)) {
		return placementViolation(
			path,
			"new file is under modules/ or features/ but the feature name is not on the map",
		);
	}

	return placementViolation(
		path,
		"new file must live under an allowed feature module or kernel prefix",
	);
}

/**
 * @param {{ new: string[], modified: string[], map: import("./map.mjs") }} input
 * @returns {string[]}
 */
export function collectPlacementViolations({ new: newFiles, modified, map }) {
	/** @type {string[]} */
	const violations = [];
	for (const path of newFiles) {
		violations.push(...checkPlacement({ path, status: "new", map }));
	}
	for (const path of modified) {
		violations.push(...checkPlacement({ path, status: "modified", map }));
	}
	return violations;
}
