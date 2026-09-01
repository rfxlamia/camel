import { describe, expect, it } from "vitest";
import { resolveColumnForStatusChange } from "./column-status-reverse.js";

describe("resolveColumnForStatusChange", () => {
	const twoCol = [
		{ id: 1, position: 0, is_done: false },
		{ id: 2, position: 1, is_done: true },
	];

	it("moves backlog card to is_done column when target is done", () => {
		expect(resolveColumnForStatusChange(1, "done", twoCol)).toBe(2);
	});

	it("moves done card to backlog column when target is backlog", () => {
		expect(resolveColumnForStatusChange(2, "backlog", twoCol)).toBe(1);
	});

	it("keeps column for canceled", () => {
		expect(resolveColumnForStatusChange(1, "canceled", twoCol)).toBeNull();
	});

	it("stays on in_progress column when already in_progress", () => {
		const cols = [
			{ id: 10, position: 0, is_done: false },
			{ id: 11, position: 1, is_done: false },
			{ id: 12, position: 2, is_done: false },
		];
		expect(resolveColumnForStatusChange(12, "in_progress", cols)).toBe(12);
	});

	it("moves to first in_progress column from backlog", () => {
		const cols = [
			{ id: 10, position: 0, is_done: false },
			{ id: 11, position: 1, is_done: false },
			{ id: 12, position: 2, is_done: false },
		];
		expect(resolveColumnForStatusChange(10, "in_progress", cols)).toBe(12);
	});

	it("moves done card to backlog when in_progress has no dedicated column", () => {
		expect(resolveColumnForStatusChange(2, "in_progress", twoCol)).toBe(1);
	});

	it("rejects in_progress when no in_progress column and card is not in done", () => {
		expect(resolveColumnForStatusChange(1, "in_progress", twoCol)).toBe(
			"unmappable",
		);
	});

	it("rejects done when board has no done column", () => {
		const cols = [{ id: 1, position: 0, is_done: false }];
		expect(resolveColumnForStatusChange(1, "done", cols)).toBe("unmappable");
	});

	const sdBoard = [
		{ id: 11, position: 1024, is_done: false },
		{ id: 12, position: 2048, is_done: false },
		{ id: 13, position: 3072, is_done: false },
		{ id: 14, position: 4096, is_done: false },
		{ id: 15, position: 5120, is_done: true },
	];

	it("moves backlog card to dedicated todo column on SD board", () => {
		expect(resolveColumnForStatusChange(11, "todo", sdBoard)).toBe(12);
	});

	it("moves backlog card to first in_progress column on SD board", () => {
		expect(resolveColumnForStatusChange(11, "in_progress", sdBoard)).toBe(13);
	});

	it("moves in_progress card to backlog column from SD board", () => {
		expect(resolveColumnForStatusChange(13, "backlog", sdBoard)).toBe(11);
	});

	it("moves in_progress card to todo column from SD board", () => {
		expect(resolveColumnForStatusChange(13, "todo", sdBoard)).toBe(12);
	});

	it("moves done card to backlog on SD board", () => {
		expect(resolveColumnForStatusChange(15, "backlog", sdBoard)).toBe(11);
	});

	it("moves done card to todo on SD board", () => {
		expect(resolveColumnForStatusChange(15, "todo", sdBoard)).toBe(12);
	});

	it("moves done card to first in_progress column on SD board", () => {
		expect(resolveColumnForStatusChange(15, "in_progress", sdBoard)).toBe(13);
	});

	it("uses todo fallback when only one non-done column exists", () => {
		const singleNonDone = [
			{ id: 1, position: 1024, is_done: false },
			{ id: 2, position: 2048, is_done: true },
		];
		expect(resolveColumnForStatusChange(1, "todo", singleNonDone)).toBe(1);
	});

	it("maps leftmost is_done column when resolving done slot", () => {
		const leftDone = [
			{ id: 31, position: 1024, is_done: true },
			{ id: 32, position: 2048, is_done: false },
			{ id: 33, position: 3072, is_done: false },
		];
		expect(resolveColumnForStatusChange(32, "done", leftDone)).toBe(31);
	});

	it("picks first in_progress column when multiple share the slot", () => {
		const fiveNonDone = [
			{ id: 41, position: 1024, is_done: false },
			{ id: 42, position: 2048, is_done: false },
			{ id: 43, position: 3072, is_done: false },
			{ id: 44, position: 4096, is_done: false },
			{ id: 45, position: 5120, is_done: false },
			{ id: 46, position: 6144, is_done: true },
		];
		expect(resolveColumnForStatusChange(41, "in_progress", fiveNonDone)).toBe(
			43,
		);
	});
});
