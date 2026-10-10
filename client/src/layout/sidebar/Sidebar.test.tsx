import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseWorkspace } = vi.hoisted(() => ({
	mockUseWorkspace: vi.fn(),
}));

vi.mock("../../shared/WorkspaceContext", () => ({
	useWorkspace: () => mockUseWorkspace(),
}));
vi.mock("../../features/notifications", () => ({
	useNotificationsContext: () => ({ unreadCount: 0 }),
}));
vi.mock("./ModeSwitcher", () => ({ ModeSwitcher: () => null }));
vi.mock("./WorkspaceSwitcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("./SignOutPopover", () => ({ SignOutPopover: () => null }));

import { MobileNav } from "./MobileNav";
import Sidebar from "./Sidebar";

function renderSidebar() {
	return render(
		<MemoryRouter>
			<Sidebar
				collapsed={false}
				onToggle={vi.fn()}
				mode="kanban"
				onModeChange={vi.fn()}
			/>
		</MemoryRouter>,
	);
}

function renderMobileNav() {
	return render(
		<MemoryRouter>
			<MobileNav open onClose={vi.fn()} mode="kanban" onModeChange={vi.fn()} />
		</MemoryRouter>,
	);
}

describe("sidebar scroll boundaries", () => {
	afterEach(cleanup);

	beforeEach(() => {
		mockUseWorkspace.mockReturnValue({
			logout: vi.fn(),
			settings: { boardName: "Camel", logoPath: null },
		});
	});

	it("scrolls the desktop navigation without clipping sidebar popovers", () => {
		const { container } = renderSidebar();
		const sidebar = container.querySelector("aside");
		const nav = screen.getByRole("navigation", { name: "Main" });

		expect(nav.className).toContain("min-h-0");
		expect(nav.className).toContain("overflow-y-auto");
		expect(sidebar?.className).toContain("min-h-0");
		expect(sidebar?.className).not.toMatch(
			/\boverflow-(?:hidden|auto|y-auto)\b/,
		);
		const footer = screen
			.getByRole("button", { name: "Sign out" })
			.closest(".border-t");
		expect(footer?.className).toContain("shrink-0");
	});

	it("scrolls the mobile navigation within the fixed menu panel", () => {
		renderMobileNav();
		const nav = screen.getByRole("navigation", { name: "Main" });
		const signOut = screen.getByRole("button", { name: "Sign out" });

		expect(nav.className).toContain("min-h-0");
		expect(nav.className).toContain("overflow-y-auto");
		expect(nav.contains(signOut)).toBe(false);
		expect(signOut.closest(".border-t")?.className).toContain("shrink-0");
	});
});
