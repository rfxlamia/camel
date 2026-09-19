import { describe, expect, it } from "vitest";
import {
	chooseInitialWorkspace,
	getRemovalRedirect,
	planWorkspaceRefresh,
	WORKSPACE_STORAGE_KEY,
} from "./workspaceSelection";

const wsA = {
	id: 1,
	name: "WS-A",
	role: "member" as const,
	isPersonal: false,
	memberCount: 2,
};
const wsB = {
	id: 2,
	name: "WS-B",
	role: "admin" as const,
	isPersonal: false,
	memberCount: 3,
};
const personal = {
	id: 3,
	name: "Nina's Workspace",
	role: "owner" as const,
	isPersonal: true,
	memberCount: 1,
};

describe("workspace selection", () => {
	it("restores a valid saved workspace", () => {
		expect(
			chooseInitialWorkspace({ workspaces: [wsA, wsB], savedWorkspaceId: 1 }),
		).toEqual({
			activeWorkspaceId: 1,
			pickerRequired: false,
			clearSavedWorkspace: false,
		});
	});

	it("auto-lands in the only workspace when no saved id exists", () => {
		expect(
			chooseInitialWorkspace({
				workspaces: [personal],
				savedWorkspaceId: null,
			}),
		).toMatchObject({
			activeWorkspaceId: 3,
			pickerRequired: false,
		});
	});

	it("requires picker and clears invalid saved workspace", () => {
		expect(
			chooseInitialWorkspace({ workspaces: [wsA, wsB], savedWorkspaceId: 99 }),
		).toEqual({
			activeWorkspaceId: null,
			pickerRequired: true,
			clearSavedWorkspace: true,
		});
		expect(WORKSPACE_STORAGE_KEY).toBe("activeWorkspaceId");
	});

	it("redirects removal from active workspace to personal workspace with product copy", () => {
		expect(
			getRemovalRedirect({
				activeWorkspaceId: 8,
				removedWorkspaceId: 8,
				removedWorkspaceName: "WS-R",
				workspaces: [personal],
			}),
		).toEqual({
			nextWorkspaceId: 3,
			toast: "You were removed from WS-R.",
		});
	});

	it("plans all scoped refreshes and event reconnects on workspace switch", () => {
		expect(planWorkspaceRefresh(2)).toEqual([
			"close-event-stream",
			"load-board:2",
			"load-metrics:2",
			"load-activity:2",
			"load-presence:2",
			"load-settings:2",
			"open-event-stream:2",
		]);
	});
});
