import { describe, it, expect } from "vitest";
import { initialQueue, submit, settle } from "./agentQueue.js";

describe("agentQueue", () => {
  it("fires immediately when idle", () => {
    const r = submit(initialQueue, "a");
    expect(r.fire).toBe("a");
    expect(r.state.isGenerating).toBe(true);
  });

  it("queues a second submit while generating", () => {
    const r1 = submit(initialQueue, "a");
    const r2 = submit(r1.state, "b");
    expect(r2.fire).toBeNull();
    expect(r2.state.queue).toEqual(["b"]);
  });

  it("auto-fires the queued message on settle", () => {
    const r1 = submit(initialQueue, "a");
    const r2 = submit(r1.state, "b");
    const s = settle(r2.state);
    expect(s.fire).toBe("b");
    expect(s.state.queue).toEqual([]);
  });

  it("queue survives failure (settle is used for both done and fail)", () => {
    const r1 = submit(initialQueue, "a");
    const r2 = submit(r1.state, "b");
    const s = settle(r2.state); // failure path still drains the queue
    expect(s.fire).toBe("b");
  });

  it("goes idle when queue is empty on settle", () => {
    const r1 = submit(initialQueue, "a");
    const s = settle(r1.state);
    expect(s.fire).toBeNull();
    expect(s.state.isGenerating).toBe(false);
  });

  it("multiple queued items drain in order", () => {
    const r1 = submit(initialQueue, "a");
    const r2 = submit(r1.state, "b");
    const r3 = submit(r2.state, "c");

    // Settle a → fires b
    const s1 = settle(r3.state);
    expect(s1.fire).toBe("b");

    // Settle b → fires c
    const s2 = settle(s1.state);
    expect(s2.fire).toBe("c");

    // Settle c → idle
    const s3 = settle(s2.state);
    expect(s3.fire).toBeNull();
    expect(s3.state.isGenerating).toBe(false);
  });
});
