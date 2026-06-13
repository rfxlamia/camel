import { describe, expect, it } from "vitest";
import {
  cardCreateBodySchema,
  cardMoveBodySchema,
  cardUpdateBodySchema,
  validateRequestBody,
} from "./validation.js";

describe("card request validation", () => {
  it("normalizes valid card create bodies", () => {
    const result = validateRequestBody(cardCreateBodySchema, {
      columnId: 12,
      title: "  Wire up validation  ",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        columnId: 12,
        title: "Wire up validation",
        description: "",
      },
    });
  });

  it("returns structured 400 errors for invalid card create bodies", () => {
    const result = validateRequestBody(cardCreateBodySchema, {
      columnId: "12",
      title: "   ",
      description: 10,
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      body: {
        error: "Invalid request",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "columnId", code: "invalid_type" }),
          expect.objectContaining({ path: "title", code: "too_small" }),
          expect.objectContaining({ path: "description", code: "invalid_type" }),
        ]),
      },
    });
  });

  it("validates optional card update fields without defaulting them", () => {
    const result = validateRequestBody(cardUpdateBodySchema, {
      title: "Renamed card",
      version: 4,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        title: "Renamed card",
        version: 4,
      },
    });
  });

  it("rejects invalid card update fields", () => {
    const result = validateRequestBody(cardUpdateBodySchema, {
      title: "",
      description: false,
      version: 1.2,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      body: {
        error: "Invalid request",
        issues: [
          expect.objectContaining({ path: "title" }),
          expect.objectContaining({ path: "description" }),
          expect.objectContaining({ path: "version" }),
        ],
      },
    });
  });

  it("validates move bodies and optional optimistic lock version", () => {
    expect(
      validateRequestBody(cardMoveBodySchema, {
        toColumnId: 2,
        index: 0,
        version: 7,
      }),
    ).toEqual({
      ok: true,
      data: { toColumnId: 2, index: 0, version: 7 },
    });

    expect(
      validateRequestBody(cardMoveBodySchema, {
        toColumnId: 2,
        index: -1,
      }),
    ).toMatchObject({
      ok: false,
      status: 400,
      body: {
        error: "Invalid request",
        issues: [expect.objectContaining({ path: "index" })],
      },
    });
  });
});
