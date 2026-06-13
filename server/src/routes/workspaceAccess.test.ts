import { describe, expect, it, vi } from "vitest";
import {
  CAP_ERROR_MESSAGE,
  WORKSPACE_LIMIT,
  checkActorCanManage,
  checkCanRemoveUser,
  checkInviteeCap,
  createScopedBoardService,
  createWorkspaceAccessService,
} from "../routes.js";

describe("workspace authorization rules", () => {
  it("blocks member from managing — returns 404", () => {
    expect(checkActorCanManage("member")).toEqual({ allowed: false, status: 404, error: "Not found" });
  });

  it("allows admin and owner to manage", () => {
    expect(checkActorCanManage("admin")).toEqual({ allowed: true });
    expect(checkActorCanManage("owner")).toEqual({ allowed: true });
  });

  it("blocks removal of owner — returns 403", () => {
    expect(checkCanRemoveUser("admin", "owner")).toEqual({
      allowed: false,
      status: 403,
      error: "Cannot remove workspace owner",
    });
    expect(checkCanRemoveUser("owner", "member")).toEqual({ allowed: true });
  });

  it("blocks invitee at workspace cap with exact error message", () => {
    expect(WORKSPACE_LIMIT).toBe(10);
    expect(checkInviteeCap(9)).toEqual({ ok: true });
    expect(checkInviteeCap(10)).toEqual({ ok: false, status: 409, error: CAP_ERROR_MESSAGE });
  });
});

describe("scoped board service", () => {
  it("returns 404 for non-member card reads", async () => {
    const service = createScopedBoardService({
      getMembership: vi.fn(async (_workspaceId, userId) => (userId === 1 ? null : { role: "member" })),
      getCardById: vi.fn(async () => ({ id: 42, workspaceId: 2, title: "Hidden" })),
      getBoardRows: vi.fn(),
      getActivityRows: vi.fn(),
    });

    await expect(service.getCard({ userId: 1, workspaceId: 2, cardId: 42 }))
      .resolves.toEqual({ status: 404, error: "Not found" });
  });

  it("filters board rows to the requested workspace", async () => {
    const service = createScopedBoardService({
      getMembership: vi.fn(async () => ({ role: "member" })),
      getCardById: vi.fn(),
      getBoardRows: vi.fn(async (workspaceId) => [
        { id: 10, workspaceId, title: "WS-A column", cards: [{ id: 100, workspaceId, title: "Keep" }] },
      ]),
      getActivityRows: vi.fn(async (workspaceId) => [
        { id: 200, workspaceId, cardTitle: "Keep activity" },
      ]),
    });

    const board = await service.getBoard({ userId: 1, workspaceId: 1 });
    expect(board).toMatchObject({
      columns: [{ id: 10, workspaceId: 1, cards: [{ id: 100, workspaceId: 1 }] }],
      activity: [{ id: 200, workspaceId: 1 }],
    });
    expect(JSON.stringify(board)).not.toContain("WS-B");
  });
});

describe("membership removal events", () => {
  it("publishes membership.removed only to the removed workspace", async () => {
    const publishEvent = vi.fn(async () => undefined);
    const clearPresence = vi.fn(async () => undefined);
    const service = createWorkspaceAccessService({
      getActorMembership: vi.fn(async () => ({ userId: 1, role: "admin" })),
      getWorkspaceOwner: vi.fn(async () => ({ userId: 1, role: "owner" })),
      getWorkspace: vi.fn(async () => ({ id: 8, name: "WS-R" })),
      getTargetMembership: vi.fn(async () => ({ userId: 4, role: "member" })),
      removeMember: vi.fn(async () => ({ userId: 4, username: "nina" })),
      publishEvent,
      clearPresence,
    });

    await service.removeMember({ actorId: 1, workspaceId: 8, userId: 4 });

    expect(publishEvent).toHaveBeenCalledWith(8, {
      type: "membership.removed",
      userId: 4,
      workspaceId: 8,
      workspaceName: "WS-R",
    });
    expect(publishEvent).not.toHaveBeenCalledWith(9, expect.anything());
    expect(clearPresence).toHaveBeenCalledWith(8, 4);
  });
});
