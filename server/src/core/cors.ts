/**
 * CORS origin validation — exact-string allowlist parsed from CORS_ORIGIN env var.
 *
 * - Development (non-production): defaults to http://localhost:5173 if CORS_ORIGIN unset.
 * - Production: requires explicit CORS_ORIGIN; denies all cross-origin if missing.
 */

const DEV_DEFAULT = "http://localhost:5173";

function parseOrigins(): Set<string> {
	const raw = process.env.CORS_ORIGIN;
	if (!raw) return new Set();
	return new Set(
		raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
}

let warned = false;

/**
 * Returns an origin callback compatible with the `cors` middleware.
 * Exact-string comparison only — no wildcard or subdomain matching.
 */
export function createOriginValidator() {
	const isProduction = process.env.NODE_ENV === "production";
	let allowed = parseOrigins();

	if (isProduction && allowed.size === 0 && !warned) {
		console.warn(
			"[CORS] CORS_ORIGIN is not set in production — all cross-origin requests will be denied. " +
				"Set CORS_ORIGIN to a comma-separated list of allowed origins.",
		);
		warned = true;
	}

	if (!isProduction && allowed.size === 0) {
		allowed = new Set([DEV_DEFAULT]);
	}

	return function originCallback(
		origin: string | undefined,
		callback: (err: Error | null, allow?: boolean) => void,
	): void {
		// No origin header (same-origin or non-browser request) — deny
		if (!origin) {
			return callback(null, false);
		}

		if (allowed.has(origin)) {
			return callback(null, true);
		}

		return callback(null, false);
	};
}
