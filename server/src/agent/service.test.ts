import { describe, it, expect, vi } from "vitest";
import { getHumanColumns } from "../routes.js";

describe("board isolation", () => {
  it("getHumanColumns filters agent columns via board_id IS NULL", async () => {
    const calls: string[] = [];
    const fakeDb = {
      query: vi.fn(async (sql: string, _params: unknown[]) => {
        calls.push(sql);
        return { rows: [] };
      }),
    };

    await getHumanColumns(fakeDb as any, 1);

    expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [1]);
    expect(calls[0]).toMatch(/board_id IS NULL/i);
    expect(calls[0]).not.toMatch(/board_id IS NOT NULL/i);
  });
});
