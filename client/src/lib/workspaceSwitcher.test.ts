import { describe, expect, it } from "vitest";
import { planWorkspaceRefresh } from "./workspaceSelection";
import {
	applyCreatedWorkspaceSelection,
	getInvitePopoverState,
	getSwitchAttemptState,
} from "./workspaceSwitcher";

describe("workspace switcher state", () => {
	it("requires confirmation before switching with unsaved edits", () => {
		expect(
			getSwitchAttemptState({
				activeWorkspaceId: 1,
				targetWorkspaceId: 2,
				hasUnsavedCardEdits: true,
				hasActiveFocusSession: false,
				focusSessionHydrated: true,
			}),
		).toEqual({
			status: "confirm-required",
			pendingWorkspaceId: 2,
		});
	});

	it("blocks switching while a focus session is active", () => {
		expect(
			getSwitchAttemptState({
				activeWorkspaceId: 1,
				targetWorkspaceId: 2,
				hasUnsavedCardEdits: false,
				hasActiveFocusSession: true,
				focusSessionHydrated: true,
			}),
		).toEqual({ status: "focus-blocked" });
	});

	it("blocks switching while focus session is still hydrating", () => {
		expect(
			getSwitchAttemptState({
				activeWorkspaceId: 1,
				targetWorkspaceId: 2,
				hasUnsavedCardEdits: false,
				hasActiveFocusSession: false,
				focusSessionHydrated: false,
			}),
		).toEqual({ status: "focus-loading" });
	});

	it("allows switching when focus is hydrated and no session is active", () => {
		expect(
			getSwitchAttemptState({
				activeWorkspaceId: 1,
				targetWorkspaceId: 2,
				hasUnsavedCardEdits: false,
				hasActiveFocusSession: false,
				focusSessionHydrated: true,
			}),
		).toEqual({ status: "switch", workspaceId: 2 });
	});

	it("prefers focus block over unsaved card edits", () => {
		expect(
			getSwitchAttemptState({
				activeWorkspaceId: 1,
				targetWorkspaceId: 2,
				hasUnsavedCardEdits: true,
				hasActiveFocusSession: true,
				focusSessionHydrated: true,
			}),
		).toEqual({ status: "focus-blocked" });
	});

	it("returns noop when switching to the active workspace with a session active", () => {
		expect(
			getSwitchAttemptState({
				activeWorkspaceId: 1,
				targetWorkspaceId: 1,
				hasUnsavedCardEdits: false,
				hasActiveFocusSession: true,
				focusSessionHydrated: true,
			}),
		).toEqual({ status: "noop" });
	});

	it("shows invite popover after remind me later when switcher is closed", () => {
		expect(
			getInvitePopoverState({
				switcherOpen: false,
				remindedInviteIds: [5],
				pendingInvites: [
					{ id: 5, workspaceId: 1, workspaceName: "Team", role: "member" },
				],
			}),
		).toEqual({
			visible: true,
			invites: [
				{ id: 5, workspaceId: 1, workspaceName: "Team", role: "member" },
			],
		});
	});

});

describe("workspace client integration plan", () => {
	it("refreshes every scoped resource and reconnects SSE when active workspace changes", () => {
		expect(planWorkspaceRefresh(12)).toEqual([
			"close-event-stream",
			"load-board:12",
			"load-metrics:12",
			"load-activity:12",
			"load-presence:12",
			"load-settings:12",
			"open-event-stream:12",
		]);
	});

	it("selects a newly created workspace and persists it", () => {
		expect(
			applyCreatedWorkspaceSelection({
				currentWorkspaceIds: [1, 2],
				createdWorkspace: {
					id: 13,
					name: "Launch",
					role: "owner",
					isPersonal: false,
				},
			}),
		).toEqual({
			workspaces: [
				{ id: 1 },
				{ id: 2 },
				{ id: 13, name: "Launch", role: "owner", isPersonal: false },
			],
			activeWorkspaceId: 13,
			localStorageWrite: { key: "activeWorkspaceId", value: "13" },
			toast: "Workspace created.",
		});
	});
});
