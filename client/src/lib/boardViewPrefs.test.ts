import { afterEach, describe, expect, it, vi } from "vitest";
import {
	readBoardViewMode,
	writeBoardViewMode,
} from "./boardViewPrefs";

afterEach(() => localStorage.clear());

describe("boardViewPrefs", () => {
	it("returns board when no preference stored", () => {
		expect(readBoardViewMode(7)).toBe("board");
	});

	it("persists and reads per-workspace preference", () => {
		writeBoardViewMode(7, "list");
		writeBoardViewMode(9, "calendar");
		expect(readBoardViewMode(7)).toBe("list");
		expect(readBoardViewMode(9)).toBe("calendar");
	});

	it("falls back to board when localStorage getItem throws", () => {
		const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		expect(readBoardViewMode(1)).toBe("board");
		get.mockRestore();
	});

	it("silently ignores writeBoardViewMode when localStorage setItem throws", () => {
		const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		expect(() => writeBoardViewMode(7, "list")).not.toThrow();
		set.mockRestore();
	});
});
