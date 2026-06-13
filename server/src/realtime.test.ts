import { describe, expect, it, vi } from "vitest";
import {
  createRealtimeHub,
  workspaceEventChannel,
  workspacePresencePattern,
} from "./realtime.js";

describe("workspace realtime isolation", () => {
  it("keeps local fallback clients isolated by workspace", async () => {
    const hub = createRealtimeHub({ publisher: null, subscriber: null });
    const wsA = hub.connectLocalClient({ workspaceId: 1 });
    const wsB = hub.connectLocalClient({ workspaceId: 2 });

    await hub.publishEvent(2, { type: "card.created", cardId: 42 });

    expect(wsA.drain()).toEqual([]);
    expect(wsB.drain()).toEqual([{ type: "card.created", cardId: 42 }]);
  });

  it("uses workspace-specific Redis channels and presence key scans", async () => {
    expect(workspaceEventChannel(7)).toBe("camel:workspace:7:events");
    expect(workspacePresencePattern(7)).toBe("camel:workspace:7:presence:*");

    const publish = vi.fn(async () => 1);
    const scanIterator = vi.fn(async function* () {
      yield "camel:workspace:7:presence:1";
    });
    const hub = createRealtimeHub({ publisher: { publish }, subscriber: null, presence: { scanIterator } });

    await hub.publishEvent(7, { type: "card.updated", cardId: 5 });
    await hub.onlineUsers(7);

    expect(publish).toHaveBeenCalledWith("camel:workspace:7:events", expect.any(String));
    expect(scanIterator).toHaveBeenCalledWith({ MATCH: "camel:workspace:7:presence:*" });
  });
});
