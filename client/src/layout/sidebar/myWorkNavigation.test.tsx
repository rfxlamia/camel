// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockUseWorkspace, mockUseNotificationsContext } = vi.hoisted(() => ({
	mockUseWorkspace: vi.fn(),
	mockUseNotificationsContext: vi.fn(),
}));

vi.mock("../../shared/WorkspaceContext", () => ({
	useWorkspace: () => mockUseWorkspace(),
}));

vi.mock("../../context/NotificationsContext", () => ({
	useNotificationsContext: () => mockUseNotificationsContext(),
}));

import { useState } from "react";
import { MobileNav } from "./MobileNav";
import Sidebar from "./Sidebar";
import type { Mode } from "./shared";

const workspace = {
	id: 1,
	name: "Alpha",
	role: "member",
	isPersonal: false,
	memberCount: 1,
};

function setupContexts() {
	mockUseWorkspace.mockReturnValue({
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

function renderSidebarAt(
	path: string,
	collapsed = false,
	mode: Mode = "kanban",
) {
	setupContexts();
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Sidebar
				collapsed={collapsed}
				onToggle={vi.fn()}
				mode={mode}
				onModeChange={vi.fn()}
			/>
			<LocationProbe />
		</MemoryRouter>,
	);
}

function renderMobileNav(mode: Mode = "kanban") {
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
					mode={mode}
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

function expectMyWorkInMainNav() {
	expect(screen.queryByRole("navigation", { name: "Global" })).toBeNull();
	expect(screen.getAllByRole("link", { name: "My Work" })).toHaveLength(1);
	const main = screen.getByRole("navigation", { name: "Main" });
	const firstLink = within(main).getAllByRole("link")[0];
	expect(firstLink.getAttribute("href")).toBe("/my-work");
	return main;
}

describe("My Work navigation", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it.each([
		"/my-work",
		"/board",
		"/tracker",
	])("renders My Work as the first main-nav link for %s with route-driven active state", (path) => {
		renderSidebarAt(path);

		const main = expectMyWorkInMainNav();
		const myWorkLink = within(main).getByRole("link", { name: "My Work" });
		expect(myWorkLink.getAttribute("href")).toBe("/my-work");
		expect(myWorkLink.className).toContain(
			path === "/my-work" ? "bg-primary-100" : "text-neutral-700",
		);
	});

	it("keeps My Work accessible and routable when collapsed", () => {
		renderSidebarAt("/board", true);

		const main = expectMyWorkInMainNav();
		const myWorkLink = within(main).getByRole("link", { name: "My Work" });
		expect(myWorkLink.getAttribute("title")).toBe("My Work");
		expect(myWorkLink.getAttribute("aria-label")).toBe("My Work");
		expect(
			within(main)
				.getByRole("link", { name: "Board" })
				.getAttribute("aria-label"),
		).toBe("Board");

		fireEvent.click(myWorkLink);
		expect(screen.getByTestId("pathname").textContent).toBe("/my-work");
	});

	it("keeps My Work in main nav in agent mode", () => {
		renderSidebarAt("/agent", false, "agent");

		const main = expectMyWorkInMainNav();
		expect(within(main).getByRole("link", { name: "Chat" })).toBeTruthy();
		expect(within(main).queryByRole("link", { name: "Board" })).toBeNull();
	});

	it("keeps My Work in main nav and closes the open mobile menu", () => {
		const { onClose } = renderMobileNav();

		expectMyWorkInMainNav();
		const myWorkLink = screen.getByRole("link", { name: "My Work" });
		fireEvent.click(myWorkLink);

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("link", { name: "My Work" })).toBeNull();
		expect(screen.getByTestId("pathname").textContent).toBe("/my-work");
	});

	it("keeps My Work in mobile main nav in agent mode", () => {
		renderMobileNav("agent");

		const main = expectMyWorkInMainNav();
		expect(within(main).getByRole("link", { name: "Chat" })).toBeTruthy();
		expect(within(main).queryByRole("link", { name: "Board" })).toBeNull();
	});
});
