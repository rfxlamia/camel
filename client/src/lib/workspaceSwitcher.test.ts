import { describe, expect, it } from "vitest";
import {
  CAP_MESSAGE,
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

  it("shows invite popover after remind me later when switcher opens", () => {
    expect(getInvitePopoverState({
      switcherOpen: true,
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
