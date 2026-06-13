import { describe, expect, it } from "vitest";
import {
  CAP_ERROR_MESSAGE,
  WORKSPACE_LIMIT,
  checkActorCanManage,
  checkCanRemoveUser,
  checkInviteeCap,
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
