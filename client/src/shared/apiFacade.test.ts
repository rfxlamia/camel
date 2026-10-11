import { afterEach, describe, expect, it, vi } from "vitest";

// No feature-barrel, facade, transport, or Lottie mocks: these imports must
// exercise the real cyclic graph regardless of which public entry loads first.
const publicEntries = [
	"activity",
	"agent",
	"auth",
	"board",
	"chat",
	"focus",
	"my-work",
	"notifications",
	"settings",
	"tracker",
	"workspaces",
] as const;
const entries = {
	activity: () => import("../features/activity"),
	agent: () => import("../features/agent"),
	auth: () => import("../features/auth"),
	board: () => import("../features/board"),
	chat: () => import("../features/chat"),
	focus: () => import("../features/focus"),
	"my-work": () => import("../features/my-work"),
	notifications: () => import("../features/notifications"),
	settings: () => import("../features/settings"),
	tracker: () => import("../features/tracker"),
	workspaces: () => import("../features/workspaces"),
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe("real API facade import smoke", () => {
	it.each([
		"facade",
		...publicEntries,
	] as const)("initializes with %s as the first import without doing IO", async (entry) => {
		vi.resetModules();
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		if (entry !== "facade") await entries[entry]();
		const facade = await import("../api");
		expect(fetch).not.toHaveBeenCalled();
		expect(Object.keys(facade).sort()).toEqual([
			"ApiError",
			"api",
			"cardAttachmentDownloadUrl",
			"cardAttachmentOriginalUrl",
			"cardAttachmentThumbnailUrl",
			"configureRequestBoundaryForTests",
			"resetRequestBoundaryForTests",
		]);
		for (const value of Object.values(facade.api)) {
			if (typeof value === "object") {
				for (const method of Object.values(value))
					expect(method).toBeTypeOf("function");
			} else {
				expect(value).toBeTypeOf("function");
			}
		}
	});
});
