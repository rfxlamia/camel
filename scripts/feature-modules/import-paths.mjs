import { dirname } from "node:path";

/** Server kernel prefixes (importable from any feature module). */
export const SERVER_KERNEL_PREFIXES = [
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
export const CLIENT_KERNEL_PREFIXES = [
	"client/src/shared/",
	"client/src/layout/",
];

/** Legacy type-folder trees where modules must not deep-import feature code. */
export const LEGACY_FEATURE_PREFIXES = [
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

export const FORBIDDEN_PRODUCT_FEATURES = new Set(["work-items"]);

/**
 * @param {string} path POSIX path
 */
export function toPosix(path) {
	return path.replace(/\\/g, "/");
}

/**
 * @param {string} filePath POSIX path relative to repo root
 */
export function fileDir(filePath) {
	const dir = dirname(filePath);
	return dir === "." ? "" : dir;
}

/**
 * @param {string} fromDir POSIX dir (no trailing slash) relative to repo root
 * @param {string} specifier
 */
export function resolveRelativeSpecifier(fromDir, specifier) {
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
 * @param {string} path
 */
export function stripExtension(path) {
	return path.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");
}

/**
 * @param {string} resolved POSIX path (may include extension)
 */
export function isIndexImport(resolved) {
	const base = stripExtension(resolved);
	return base.endsWith("/index") || base.endsWith("/index/index");
}

/**
 * @param {string} path POSIX without requiring extension
 */
export function parseFeatureModuleTarget(path) {
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
export function parseImporterFeature(filePath) {
	const server = filePath.match(/^server\/src\/modules\/([^/]+)\//);
	if (server) return { side: "server", feature: server[1] };
	const client = filePath.match(/^client\/src\/features\/([^/]+)\//);
	if (client) return { side: "client", feature: client[1] };
	return null;
}

/**
 * @param {string} path
 */
export function isKernelPath(path) {
	const noExt = stripExtension(path);
	if (
		SERVER_KERNEL_PREFIXES.some(
			(p) => noExt === stripExtension(p) || noExt.startsWith(stripExtension(p)),
		)
	) {
		return true;
	}
	return CLIENT_KERNEL_PREFIXES.some((p) => noExt.startsWith(stripExtension(p)));
}

/**
 * @param {string} path
 * @param {string[]} allowlist
 */
export function isAllowlistedKernelInWaiting(path, allowlist) {
	const noExt = stripExtension(path);
	return allowlist.some((entry) => noExt === stripExtension(entry));
}

/**
 * @param {string} path
 */
export function isLegacyFeaturePath(path) {
	return LEGACY_FEATURE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * @param {string} resolved POSIX path from relative specifier
 */
export function classifyModuleTarget(resolved) {
	const direct = parseFeatureModuleTarget(resolved);
	if (direct) return direct;
	return parseFeatureModuleTarget(stripExtension(resolved));
}
