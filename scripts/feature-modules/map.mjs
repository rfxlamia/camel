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
