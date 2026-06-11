import { describe, expect, it } from "vitest";
import type { ActivityEvent, Card, Column } from "../types";
import { describeCardEvent, findCardInColumns, parseCardId } from "./cardPanel";

function makeCard(id: number, columnId: number): Card {
  return {
    id,
    columnId,
    title: `Card ${id}`,
    description: "",
    position: id * 1000,
    version: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    startedAt: null,
    doneAt: null,
  };
}

function makeColumn(id: number, cards: Card[]): Column {
  return {
    id,
    title: `Column ${id}`,
    position: id * 1000,
    wipLimit: null,
    policy: "",
    isDone: false,
    cards,
  };
}

function makeEvent(patch: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 1,
    type: "move",
    cardId: 5,
    cardTitle: "Card 5",
    fromColumn: null,
    toColumn: null,
    actor: { username: "sinta", displayName: "Sinta" },
    createdAt: "2026-06-11T00:00:00.000Z",
    ...patch,
  };
}

describe("parseCardId", () => {
  it("parses a plain positive integer", () => {
    expect(parseCardId("42")).toBe(42);
  });

  it("rejects non-numeric params (R1.3)", () => {
    expect(parseCardId("abc")).toBeNull();
    expect(parseCardId("4a")).toBeNull();
    expect(parseCardId("")).toBeNull();
    expect(parseCardId(undefined)).toBeNull();
  });

  it("rejects negatives, zero, decimals, and exponent forms", () => {
    expect(parseCardId("-1")).toBeNull();
    expect(parseCardId("0")).toBeNull();
    expect(parseCardId("4.5")).toBeNull();
    expect(parseCardId("1e3")).toBeNull();
  });
});

describe("findCardInColumns", () => {
  const columns = [
    makeColumn(1, [makeCard(7, 1), makeCard(8, 1)]),
    makeColumn(2, [makeCard(42, 2)]),
  ];

  it("finds a card in any column", () => {
    expect(findCardInColumns(columns, 42)?.id).toBe(42);
    expect(findCardInColumns(columns, 7)?.columnId).toBe(1);
  });

  it("returns null for a missing card (R1.3 / R4.3)", () => {
    expect(findCardInColumns(columns, 999)).toBeNull();
  });

  it("returns null while the board has not loaded or id is invalid", () => {
    expect(findCardInColumns(null, 42)).toBeNull();
    expect(findCardInColumns(columns, null)).toBeNull();
  });
});

describe("describeCardEvent", () => {
  it("describes a move with both columns (R3.2)", () => {
    const e = makeEvent({ fromColumn: "Doing", toColumn: "Review" });
    expect(describeCardEvent(e)).toBe("moved Doing → Review");
  });

  it("omits the null side when the source column was deleted (R3.3)", () => {
    const e = makeEvent({ fromColumn: null, toColumn: "Review" });
    expect(describeCardEvent(e)).toBe("moved this to Review");
    expect(describeCardEvent(e)).not.toContain("→");
  });

  it("omits the null side when the target column was deleted", () => {
    const e = makeEvent({ fromColumn: "Doing", toColumn: null });
    expect(describeCardEvent(e)).toBe("moved this from Doing");
  });

  it("handles a move with both columns deleted", () => {
    const e = makeEvent({ fromColumn: null, toColumn: null });
    expect(describeCardEvent(e)).toBe("moved this card");
  });

  it("describes create with and without a target column", () => {
    expect(
      describeCardEvent(makeEvent({ type: "create", toColumn: "Backlog" })),
    ).toBe("added this card to Backlog");
    expect(describeCardEvent(makeEvent({ type: "create" }))).toBe(
      "added this card",
    );
  });

  it("describes update events", () => {
    expect(describeCardEvent(makeEvent({ type: "update" }))).toBe(
      "updated this card",
    );
  });
});
