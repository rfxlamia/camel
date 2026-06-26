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
			<button type="button" onClick={() => navigate("/agent")}>
				to-agent
			</button>
			<button type="button" onClick={() => navigate("/board")}>
				to-board
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
