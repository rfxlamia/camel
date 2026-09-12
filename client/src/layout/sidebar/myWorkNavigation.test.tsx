// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockUseBoard, mockUseNotificationsContext } = vi.hoisted(() => ({
	mockUseBoard: vi.fn(),
	mockUseNotificationsContext: vi.fn(),
}));

vi.mock("../../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

vi.mock("../../context/NotificationsContext", () => ({
	useNotificationsContext: () => mockUseNotificationsContext(),
}));

import { useState } from "react";
import { MobileNav } from "./MobileNav";
import Sidebar from "./Sidebar";

const workspace = {
	id: 1,
	name: "Alpha",
	role: "member",
	isPersonal: false,
	memberCount: 1,
};

function setupContexts() {
	mockUseBoard.mockReturnValue({
		activeWorkspace: workspace,
		activeWorkspaceId: workspace.id,
		workspaces: [workspace],
		pendingInvites: [],
		remindedInviteIds: [],
		hasUnsavedCardEdits: false,
		hasActiveFocusSession: false,
		focusSessionHydrated: true,
		settings: { boardName: "Camel", logoPath: "/logo.png" },
		logout: vi.fn(),
		attemptSwitchWorkspace: vi.fn(),
		switchConfirm: { open: false },
		confirmPendingSwitch: vi.fn(),
		cancelPendingSwitch: vi.fn(),
		openCreateWorkspace: vi.fn(),
		acceptWorkspaceInvite: vi.fn(),
		declineWorkspaceInvite: vi.fn(),
	});
	mockUseNotificationsContext.mockReturnValue({ unreadCount: 0 });
}

function LocationProbe() {
	const { pathname } = useLocation();
	return <output data-testid="pathname">{pathname}</output>;
}

function renderSidebarAt(path: string, collapsed = false) {
	setupContexts();
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Sidebar
				collapsed={collapsed}
				onToggle={vi.fn()}
				mode="kanban"
				onModeChange={vi.fn()}
			/>
			<LocationProbe />
		</MemoryRouter>,
	);
}

function renderMobileNav() {
	setupContexts();
	const onClose = vi.fn();
	function Harness() {
		const [open, setOpen] = useState(true);
		return (
			<>
				<MobileNav
					open={open}
					onClose={() => {
						onClose();
						setOpen(false);
					}}
					mode="kanban"
					onModeChange={vi.fn()}
				/>
				<LocationProbe />
			</>
		);
	}
	return {
		onClose,
		...render(
			<MemoryRouter>
				<Harness />
			</MemoryRouter>,
		),
	};
}

describe("global My Work navigation", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it.each([
		"/my-work",
		"/board",
		"/tracker",
	])("renders a global My Work link for %s with route-driven active state", (path) => {
		renderSidebarAt(path);

		const myWorkLink = screen.getByRole("link", { name: "My Work" });
		expect(myWorkLink.getAttribute("href")).toBe("/my-work");
		expect(myWorkLink.className).toContain(
			path === "/my-work" ? "bg-primary-100" : "text-neutral-700",
		);
	});

	it("keeps the global link accessible and routable when collapsed", () => {
		renderSidebarAt("/board", true);

		const myWorkLink = screen.getByRole("link", { name: "My Work" });
		expect(myWorkLink.getAttribute("title")).toBe("My Work");
		expect(myWorkLink.getAttribute("aria-label")).toBe("My Work");

		fireEvent.click(myWorkLink);
		expect(screen.getByTestId("pathname").textContent).toBe("/my-work");
	});

	it("keeps My Work outside mode links and closes the open mobile menu", () => {
		const { onClose } = renderMobileNav();
		const mainNavigation = screen.getByRole("navigation", { name: "Main" });
		const myWorkLink = screen.getByRole("link", { name: "My Work" });

		expect(mainNavigation.querySelector('a[href="/my-work"]')).toBeNull();
		fireEvent.click(myWorkLink);

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("link", { name: "My Work" })).toBeNull();
		expect(screen.getByTestId("pathname").textContent).toBe("/my-work");
	});
});
