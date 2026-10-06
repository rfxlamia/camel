import { describe, expect, it } from "vitest";
import {
	parseFocusPatchBody,
	parseFocusPostBody,
} from "./focus-session-parse.js";

const INVALID = { ok: false, body: { error: "Invalid request body" } };

describe("parseFocusPostBody", () => {
	it("accepts focus and switch bodies, with optional identity", () => {
		expect(
			parseFocusPostBody({ action: "focus", source: "board", taskId: 4 }),
		).toEqual({
			ok: true,
			data: { action: "focus", source: "board", taskId: 4 },
		});
		expect(
			parseFocusPostBody({
				action: "switch",
				source: "tracker",
				taskId: 4,
				version: 2,
				sessionId: 9,
			}),
		).toMatchObject({ ok: true, data: { version: 2, sessionId: 9 } });
	});

	it.each([
		[null],
		[undefined],
		["x"],
		[[]],
		[{}],
		[{ action: "start", source: "board", taskId: 1 }],
		[{ action: "focus", source: "other", taskId: 1 }],
		[{ action: "focus", source: "board", taskId: "1" }],
		[{ action: "focus", source: "board", taskId: 1.5 }],
		[{ action: "focus", source: "board", taskId: 1, version: "1" }],
		[{ action: "focus", source: "board", taskId: 1, version: null }],
		[{ action: "switch", source: "board", taskId: 1, sessionId: 1.2 }],
	])("rejects %j with the single legacy body", (body) => {
		expect(parseFocusPostBody(body)).toEqual(INVALID);
	});
});

describe("parseFocusPatchBody", () => {
	it("requires action, version and sessionId", () => {
		expect(
			parseFocusPatchBody({ action: "pause", version: 1, sessionId: 2 }),
		).toEqual({
			ok: true,
			data: { action: "pause", version: 1, sessionId: 2 },
		});
	});

	it.each([
		null,
		{ action: "focus", version: 1, sessionId: 2 },
		{ action: "pause", version: 1 },
		{ action: "pause", sessionId: 2 },
		{ action: "pause", version: "1", sessionId: 2 },
		{ version: 1, sessionId: 2 },
	])("rejects %j with the single legacy body", (body) => {
		expect(parseFocusPatchBody(body)).toEqual(INVALID);
	});
});
