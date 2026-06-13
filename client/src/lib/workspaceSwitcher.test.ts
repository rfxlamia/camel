import { describe, expect, it } from "vitest";
import { planWorkspaceRefresh } from "./workspaceSelection";
import {
  CAP_MESSAGE,
  applyCreatedWorkspaceSelection,
  getInvitePopoverState,
  getSwitchAttemptState,
  getWorkspaceLimitActionState,
} from "./workspaceSwitcher";

describe("workspace switcher state", () => {
  it("requires confirmation before switching with unsaved edits", () => {
    expect(getSwitchAttemptState({
      activeWorkspaceId: 1,
      targetWorkspaceId: 2,
      hasUnsavedCardEdits: true,
    })).toEqual({
      status: "confirm-required",
      pendingWorkspaceId: 2,
    });
  });

  it("shows invite popover after remind me later when switcher is closed", () => {
    expect(getInvitePopoverState({
      switcherOpen: false,
      remindedInviteIds: [5],
      pendingInvites: [{ id: 5, workspaceId: 1, workspaceName: "Team", role: "member" }],
    })).toEqual({
      visible: true,
      invites: [{ id: 5, workspaceId: 1, workspaceName: "Team", role: "member" }],
    });
  });

  it("disables accept and create actions at the membership cap", () => {
    expect(CAP_MESSAGE).toBe("You've reached the workspace limit (10).");
    expect(getWorkspaceLimitActionState({ membershipCount: 10, action: "accept-invite" })).toEqual({
      disabled: true,
      message: CAP_MESSAGE,
    });
    expect(getWorkspaceLimitActionState({ membershipCount: 10, action: "create-workspace" })).toEqual({
      disabled: true,
      message: CAP_MESSAGE,
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
    expect(applyCreatedWorkspaceSelection({
      currentWorkspaceIds: [1, 2],
      createdWorkspace: { id: 13, name: "Launch", role: "owner", isPersonal: false },
    })).toEqual({
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
