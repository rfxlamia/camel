import { describe, expect, it } from "vitest";
import {
  WORKSPACE_LIMIT,
  getWorkspaceCapacity,
  serializeWorkspaceList,
} from "./routes.js";

describe("workspace helper contracts", () => {
  it("blocks create and invite accept at 10 memberships", () => {
    expect(WORKSPACE_LIMIT).toBe(10);
    expect(getWorkspaceCapacity(9)).toEqual({ ok: true });
    expect(getWorkspaceCapacity(10)).toEqual({
      ok: false,
      status: 409,
      error: "You've reached the workspace limit (10).",
    });
  });

  it("serializes workspaces and pending invites for the client", () => {
    const response = serializeWorkspaceList({
      workspaces: [{ id: 1, name: "Default Workspace", role: "owner", isPersonal: false }],
      invites: [{ id: 5, workspaceId: 9, workspaceName: "Team", role: "member" }],
    });

    expect(response.workspaces[0]).toMatchObject({
      id: 1,
      name: "Default Workspace",
      role: "owner",
      isPersonal: false,
    });
    expect(response.pendingInvites).toEqual([
      { id: 5, workspaceId: 9, workspaceName: "Team", role: "member" },
    ]);
  });
});
