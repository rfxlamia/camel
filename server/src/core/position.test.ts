import { describe, expect, it } from "vitest";
import {
  POSITION_GAP,
  neighborsAt,
  positionBetween,
  rebalance,
} from "./position.js";

describe("positionBetween", () => {
  it("returns the base gap for an empty list", () => {
    expect(positionBetween(null, null)).toBe(POSITION_GAP);
  });

  it("places before the first item", () => {
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(null, 0)).toBe(-POSITION_GAP);
  });

  it("places after the last item", () => {
    expect(positionBetween(2048, null)).toBe(2048 + POSITION_GAP);
  });

  it("takes the midpoint between two items", () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(0, 1)).toBe(0.5);
  });

  it("stays strictly between its neighbors over repeated insertions", () => {
    let before = 0;
    const after = 1024;
    for (let i = 0; i < 40; i++) {
      const mid = positionBetween(before, after);
      expect(mid).toBeGreaterThan(before);
      expect(mid).toBeLessThan(after);
      before = mid;
    }
  });

  it("throws when neighbors are too close to split", () => {
    expect(() => positionBetween(1, 1 + 1e-12)).toThrow(RangeError);
  });
});

describe("neighborsAt", () => {
  const positions = [1024, 2048, 3072];

  it("maps index 0 to (null, first)", () => {
    expect(neighborsAt(positions, 0)).toEqual({ before: null, after: 1024 });
  });

  it("maps a middle index to surrounding positions", () => {
    expect(neighborsAt(positions, 1)).toEqual({ before: 1024, after: 2048 });
  });

  it("maps the end index to (last, null)", () => {
    expect(neighborsAt(positions, 3)).toEqual({ before: 3072, after: null });
  });

  it("clamps out-of-range indexes", () => {
    expect(neighborsAt(positions, -5)).toEqual({ before: null, after: 1024 });
    expect(neighborsAt(positions, 99)).toEqual({ before: 3072, after: null });
  });

  it("handles an empty list", () => {
    expect(neighborsAt([], 0)).toEqual({ before: null, after: null });
  });
});

describe("rebalance", () => {
  it("spaces items evenly by the base gap", () => {
    expect(rebalance(3)).toEqual([1024, 2048, 3072]);
  });

  it("returns an empty list for zero items", () => {
    expect(rebalance(0)).toEqual([]);
  });
});
