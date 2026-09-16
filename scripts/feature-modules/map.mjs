/** Locked feature names (day 1). Same on client features/ and server modules/ when both exist. */
export const FEATURES = [
	"board",
	"tracker",
	"my-work",
	"agent",
	"chat",
	"focus",
	"settings",
	"workspaces",
	"notifications",
	"activity",
	"auth",
];

/** Repository paths scanned by the feature-module guard. */
export const SCAN_ROOTS = ["client/src", "server/src"];

/** Server kernel prefixes (Rule 1 placement + module import walls). */
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

/** Client kernel prefixes (Rule 1 placement + module import walls). */
export const CLIENT_KERNEL_PREFIXES = [
	"client/src/shared/",
	"client/src/layout/",
];

/**
 * Kernel files still under type-folders; modules may import until extracted (shrinking allowlist).
 * POSIX paths relative to repo root.
 */
export const KERNEL_IN_WAITING = [
	"server/src/routes/work-item-response.ts",
	"server/src/routes/work-items.ts",
	"server/src/routes/helpers.ts",
	"server/src/routes/vocabulary-response.ts",
	"server/src/routes/tracker-item-parsers.ts",
	"client/src/lib/workItemMutations.ts",
];
