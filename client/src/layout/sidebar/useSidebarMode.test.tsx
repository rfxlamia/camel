import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { useSidebarMode } from "./useSidebarMode";

function Harness() {
	const [mode] = useSidebarMode();
	const navigate = useNavigate();
	return (
		<div>
			<span data-testid="mode">{mode}</span>
			<button type="button" onClick={() => navigate("/my-work")}>
				to-my-work
			</button>
			<button type="button" onClick={() => navigate("/my-work/detail")}>
				to-my-work-detail
			</button>
			<button type="button" onClick={() => navigate("/my-workbench")}>
				to-my-workbench
			</button>
			<button type="button" onClick={() => navigate("/agent")}>
				to-agent
			</button>
			<button type="button" onClick={() => navigate("/chat")}>
				to-chat
			</button>
			<button type="button" onClick={() => navigate("/history")}>
				to-history
			</button>
			<button type="button" onClick={() => navigate("/board")}>
				to-board
			</button>
			<button type="button" onClick={() => navigate("/tracker")}>
				to-tracker
			</button>
			<button type="button" onClick={() => navigate("/inbox")}>
				to-inbox
			</button>
			<button type="button" onClick={() => navigate("/dashboard")}>
				to-dashboard
			</button>
			<button type="button" onClick={() => navigate("/settings")}>
				to-settings
			</button>
			<button type="button" onClick={() => navigate("/settings/account")}>
				to-settings-nested
			</button>
		</div>
	);
}

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Harness />
		</MemoryRouter>,
	);
}

const currentMode = () => screen.getByTestId("mode").textContent;

describe("useSidebarMode", () => {
	afterEach(cleanup);

	it("initializes mode from the current path", () => {
		renderAt("/agent");
		expect(currentMode()).toBe("agent");
	});

	it("syncs mode when the URL changes to a mode route (Rule 2 Ex. B)", () => {
		renderAt("/board");
		expect(currentMode()).toBe("kanban");
		fireEvent.click(screen.getByText("to-agent"));
		expect(currentMode()).toBe("agent");
	});

	it.each([
		"to-my-work",
		"to-my-work-detail",
	])("preserves agent mode on navigation to %s", (buttonLabel) => {
		renderAt("/agent");
		expect(currentMode()).toBe("agent");
		fireEvent.click(screen.getByText(buttonLabel));
		expect(currentMode()).toBe("agent");
	});

	it("preserves kanban mode when navigating to global My Work", () => {
		renderAt("/board");
		expect(currentMode()).toBe("kanban");
		fireEvent.click(screen.getByText("to-my-work"));
		expect(currentMode()).toBe("kanban");
	});

	it.each([
		["to-board", "kanban"],
		["to-tracker", "kanban"],
		["to-inbox", "kanban"],
		["to-dashboard", "kanban"],
		["to-agent", "agent"],
		["to-chat", "agent"],
		["to-history", "agent"],
	])("resumes URL-driven mode when leaving My Work via %s", (buttonLabel, expectedMode) => {
		renderAt("/agent");
		fireEvent.click(screen.getByText("to-my-work"));
		expect(currentMode()).toBe("agent");
		fireEvent.click(screen.getByText(buttonLabel));
		expect(currentMode()).toBe(expectedMode);
	});

	it("does not treat /my-workbench as a mode-neutral My Work route", () => {
		renderAt("/agent");
		fireEvent.click(screen.getByText("to-my-work"));
		expect(currentMode()).toBe("agent");
		fireEvent.click(screen.getByText("to-my-workbench"));
		expect(currentMode()).toBe("kanban");
	});

	it("does NOT reset mode when navigating to /settings (discriminator)", () => {
		renderAt("/agent");
		expect(currentMode()).toBe("agent");
		fireEvent.click(screen.getByText("to-settings"));
		// exact `!== "/settings"` excludes settings — mode is preserved
		expect(currentMode()).toBe("agent");
	});

	it("updates mode when leaving /settings for a mode route (Rule 3 Ex. B)", () => {
		renderAt("/agent");
		fireEvent.click(screen.getByText("to-settings"));
		expect(currentMode()).toBe("agent"); // still agent while on /settings
		fireEvent.click(screen.getByText("to-board"));
		expect(currentMode()).toBe("kanban");
	});

	it("uses EXACT /settings match, not startsWith — a nested settings route syncs", () => {
		// True discriminator: `!== "/settings"` and `startsWith("/settings")`
		// behave identically on the exact path. They diverge on a nested path:
		// exact `!==` → sync to "kanban"; forbidden `startsWith` → stays "agent".
		renderAt("/agent");
		expect(currentMode()).toBe("agent");
		fireEvent.click(screen.getByText("to-settings-nested"));
		expect(currentMode()).toBe("kanban");
	});
});
