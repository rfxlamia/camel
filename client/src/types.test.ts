import { describe, expect, it } from "vitest";
import type { SettingsMap } from "./types";

function getBoardName(s: SettingsMap): string {
  return s.boardName;
}

function getLogoPath(s: SettingsMap): string {
  return s.logoPath;
}

function getVersion(s: SettingsMap): number {
  return s.version;
}

describe("SettingsMap interface", () => {
  it("allows access to boardName, logoPath, and version", () => {
    const settings: SettingsMap = { boardName: "Dev Team", logoPath: "/uploads/logo.png", version: 3 };
    expect(getBoardName(settings)).toBe("Dev Team");
    expect(getLogoPath(settings)).toBe("/uploads/logo.png");
    expect(getVersion(settings)).toBe(3);
  });

  it("works with default values", () => {
    const settings: SettingsMap = { boardName: "Camel", logoPath: "/logo.png", version: 0 };
    expect(settings.boardName).toBe("Camel");
    expect(settings.logoPath).toBe("/logo.png");
    expect(settings.version).toBe(0);
  });
});

import type {
  Workspace,
  WorkspaceInvite,
  WorkspaceListResponse,
  WorkspaceMember,
  WorkspaceRole,
} from "./types";

describe("workspace response types", () => {
  it("type-checks the server response shape", () => {
    const role: WorkspaceRole = "owner";
    const workspace: Workspace = { id: 7, name: "Launch", role, isPersonal: false, memberCount: 3 };
    const member: WorkspaceMember = { userId: 2, username: "iris", displayName: "Iris", role: "member" };
    const invite: WorkspaceInvite = { id: 12, workspaceId: 7, workspaceName: "Launch", role: "member" };
    const response: WorkspaceListResponse = { workspaces: [workspace], pendingInvites: [invite] };

    expect(response.workspaces[0].role).toBe("owner");
    expect(member.role).toBe("member");
    expect(response.pendingInvites[0].workspaceName).toBe("Launch");
  });
});
