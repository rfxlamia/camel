import { describe, expect, it } from "vitest";
import { AGENT_NAV, AGENT_PATHS, getModeFromPath } from "./navItems";

describe("getModeFromPath", () => {
	it("returns 'agent' for /agent", () => {
		expect(getModeFromPath("/agent")).toBe("agent");
	});

	it("returns 'agent' for /history", () => {
		expect(getModeFromPath("/history")).toBe("agent");
	});

	it("returns 'agent' for a nested /agent/abc (startsWith match)", () => {
		expect(getModeFromPath("/agent/abc")).toBe("agent");
	});

	it("returns 'kanban' for /board", () => {
		expect(getModeFromPath("/board")).toBe("kanban");
	});

	it("returns 'kanban' for /settings (default branch, not special-cased here)", () => {
		expect(getModeFromPath("/settings")).toBe("kanban");
	});

	it("returns 'kanban' for /dashboard", () => {
		expect(getModeFromPath("/dashboard")).toBe("kanban");
	});
});

describe("chat nav", () => {
	it("AGENT_NAV includes /chat", () => {
		expect(AGENT_NAV.map((i) => i.to)).toContain("/chat");
	});
	it("AGENT_PATHS includes /chat", () => {
		expect(AGENT_PATHS).toContain("/chat");
	});
	it("getModeFromPath returns agent for /chat and /chat/:threadId", () => {
		expect(getModeFromPath("/chat")).toBe("agent");
		expect(getModeFromPath("/chat/42")).toBe("agent");
	});
});
