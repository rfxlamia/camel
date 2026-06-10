import { describe, expect, it } from "vitest";
import {
  type CardTimestamps,
  computeFlowMetrics,
  formatDuration,
} from "./metrics.js";

const NOW = new Date("2026-06-10T12:00:00Z");

function card(
  createdDaysAgo: number,
  startedDaysAgo: number | null,
  doneDaysAgo: number | null,
): CardTimestamps {
  const at = (daysAgo: number) =>
    new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    createdAt: at(createdDaysAgo),
    startedAt: startedDaysAgo === null ? null : at(startedDaysAgo),
    doneAt: doneDaysAgo === null ? null : at(doneDaysAgo),
  };
}

describe("computeFlowMetrics", () => {
  it("returns empty metrics for no cards", () => {
    expect(computeFlowMetrics([], { now: NOW })).toEqual({
      throughput: 0,
      avgLeadTimeMs: null,
      avgCycleTimeMs: null,
      wipCount: 0,
    });
  });

  it("counts throughput as cards done within the window", () => {
    const cards = [
      card(10, 8, 1), // done 1 day ago — inside 7d window
      card(20, 15, 9), // done 9 days ago — outside
      card(5, 3, null), // not done
    ];
    const m = computeFlowMetrics(cards, { now: NOW, windowDays: 7 });
    expect(m.throughput).toBe(1);
  });

  it("counts all done cards when no window is given", () => {
    const cards = [card(10, 8, 1), card(20, 15, 9)];
    const m = computeFlowMetrics(cards, { now: NOW });
    expect(m.throughput).toBe(2);
  });

  it("computes lead time from creation to done", () => {
    // created 10 days ago, done 1 day ago → lead time 9 days
    const m = computeFlowMetrics([card(10, 8, 1)], { now: NOW });
    expect(m.avgLeadTimeMs).toBe(9 * 24 * 60 * 60 * 1000);
  });

  it("computes cycle time from started to done", () => {
    // started 8 days ago, done 1 day ago → cycle time 7 days
    const m = computeFlowMetrics([card(10, 8, 1)], { now: NOW });
    expect(m.avgCycleTimeMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("averages across multiple done cards", () => {
    const m = computeFlowMetrics([card(4, 4, 2), card(6, 6, 2)], { now: NOW });
    // lead times: 2d and 4d → avg 3d
    expect(m.avgLeadTimeMs).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("excludes cards without startedAt from cycle time only", () => {
    const m = computeFlowMetrics([card(4, null, 2)], { now: NOW });
    expect(m.avgLeadTimeMs).toBe(2 * 24 * 60 * 60 * 1000);
    expect(m.avgCycleTimeMs).toBeNull();
  });

  it("counts wip as started-but-not-done cards", () => {
    const cards = [
      card(5, 3, null), // in progress
      card(5, null, null), // backlog
      card(5, 3, 1), // done
    ];
    expect(computeFlowMetrics(cards, { now: NOW }).wipCount).toBe(1);
  });
});

describe("formatDuration", () => {
  it("formats minutes under an hour", () => {
    expect(formatDuration(5 * 60 * 1000)).toBe("5m");
    expect(formatDuration(1000)).toBe("1m");
  });

  it("formats hours under a day", () => {
    expect(formatDuration(3 * 60 * 60 * 1000)).toBe("3h");
    expect(formatDuration(2.5 * 60 * 60 * 1000)).toBe("2.5h");
  });

  it("formats days", () => {
    expect(formatDuration(36 * 60 * 60 * 1000)).toBe("1.5d");
    expect(formatDuration(9 * 24 * 60 * 60 * 1000)).toBe("9d");
  });
});
