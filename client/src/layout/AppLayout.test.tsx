import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseBoard, mockUseToastState } = vi.hoisted(() => ({
	mockUseBoard: vi.fn(),
	mockUseToastState: vi.fn(),
}));

vi.mock("../components/PresenceBar", () => ({
	default: () => null,
}));
vi.mock("../components/ticketIntake/AutoErrorListener", () => ({
	AutoErrorListener: () => null,
}));
vi.mock("../components/ticketIntake/FloatingChatButton", () => ({
	FloatingChatButton: () => (
		<button type="button" data-testid="floating-chat-button">
			Report issue
		</button>
	),
}));
vi.mock("../components/Toast", () => ({
	default: () => null,
}));
vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));
vi.mock("../context/ToastContext", () => ({
	useToastState: () => mockUseToastState(),
}));
vi.mock("../context/NotificationsContext", () => ({
	NotificationsProvider: ({ children }: { children: ReactNode }) => (
		<>{children}</>
	),
}));
vi.mock("./FocusIndicator", () => ({
	default: () => null,
}));
vi.mock("./sidebar", () => ({
	default: () => <div data-testid="sidebar" />,
	MobileNav: () => null,
	NAV_ITEMS: [
		{
			to: "/my-work",
			label: "My Work",
			icon: () => null,
		},
	],
	WorkspaceOverlays: () => null,
}));
vi.mock("./sidebar/useSidebarMode", () => ({
	useSidebarMode: () => ["kanban", vi.fn()],
}));

import AppLayout from "./AppLayout";

function renderLayout(initialEntry: string) {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<Routes>
				<Route element={<AppLayout />}>
					<Route path="*" element={<div data-testid="outlet" />} />
				</Route>
			</Routes>
		</MemoryRouter>,
	);
}

describe("AppLayout My Work detail overlay", () => {
	afterEach(cleanup);

	beforeEach(() => {
		mockUseToastState.mockReturnValue(null);
		mockUseBoard.mockReturnValue({
			user: null,
			presence: [],
			settings: { boardName: "Camel", logoPath: null },
		});
	});

	it("keeps the global issue FAB on My Work without an open detail", () => {
		renderLayout("/my-work");

		expect(screen.getByTestId("floating-chat-button")).toBeTruthy();
	});

	it("hides the global issue FAB while a My Work detail is open", () => {
		renderLayout(
			"/my-work?detailWorkspaceId=7&detailSource=board&detailKey=AT-17",
		);

		expect(screen.queryByTestId("floating-chat-button")).toBeNull();
	});

	it("keeps the global issue FAB on other routes with unrelated detail params", () => {
		renderLayout(
			"/board?detailWorkspaceId=7&detailSource=board&detailKey=AT-17",
		);

		expect(screen.getByTestId("floating-chat-button")).toBeTruthy();
	});
});
