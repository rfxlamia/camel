// @vitest-environment jsdom
// client/src/pages/InboxPage.test.tsx — InboxPage renders notification list
// with unread/read distinction, sourceDeleted handling, empty state, and
// "Mark all as read" action. Uses useNotificationsContext (not useNotifications
// directly) — the provider is mounted in AppLayout.

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppNotification } from "../types";

// Hoisted mocks
const { mockUseNotificationsContext, mockNavigate } = vi.hoisted(() => ({
	mockUseNotificationsContext: vi.fn(),
	mockNavigate: vi.fn(),
}));

vi.mock("../context/NotificationsContext", () => ({
	useNotificationsContext: () => mockUseNotificationsContext(),
}));

vi.mock("react-router", () => ({
	useNavigate: () => mockNavigate,
}));

import InboxPage from "./InboxPage";

function makeNotification(
	overrides: Partial<AppNotification> & { id: number },
): AppNotification {
	return {
		type: "card_assigned",
		title: "Bob assigned 'Fix bug' to you",
		body: null,
		cardId: 42,
		boardId: 1,
		actorId: 7,
		readAt: null,
		sourceDeleted: false,
		createdAt: "2026-06-29T10:00:00Z",
		...overrides,
	};
}

const baseCtx = {
	notifications: [] as AppNotification[],
	unreadCount: 0,
	loading: false,
	loadingMore: false,
	hasMore: false,
	loadMore: vi.fn().mockResolvedValue(undefined),
	markAsRead: vi.fn().mockResolvedValue(undefined),
	markAllAsRead: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
	mockNavigate.mockReset();
	mockUseNotificationsContext.mockReturnValue({
		...baseCtx,
		markAsRead: vi.fn().mockResolvedValue(undefined),
		markAllAsRead: vi.fn().mockResolvedValue(undefined),
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

// ---- Empty state ----

describe("InboxPage empty state", () => {
	it("renders empty state when notifications list is empty", () => {
		mockUseNotificationsContext.mockReturnValue({
			...baseCtx,
			notifications: [],
			unreadCount: 0,
		});
		render(<InboxPage />);
		expect(screen.getByText(/Inbox kamu kosong/i)).toBeTruthy();
	});
});

// ---- Unread / read visual distinction ----

describe("InboxPage unread/read distinction", () => {
	it("renders unread notification with bold title and blue dot", () => {
		const unread = makeNotification({ id: 1, readAt: null });
		mockUseNotificationsContext.mockReturnValue({
			...baseCtx,
			notifications: [unread],
			unreadCount: 1,
		});
		render(<InboxPage />);

		// Unread item should have a blue dot (aria-hidden span)
		const dot = screen.getByTestId("unread-dot-1");
		expect(dot).toBeTruthy();

		// Title should be bold (font-semibold or font-bold)
		const title = screen.getByText("Bob assigned 'Fix bug' to you");
		expect(title.className).toMatch(/font-semibold|font-bold/);
	});

	it("renders read notification with muted text", () => {
		const read = makeNotification({
			id: 2,
			readAt: "2026-06-29T11:00:00Z",
		});
		mockUseNotificationsContext.mockReturnValue({
			...baseCtx,
			notifications: [read],
			unreadCount: 0,
		});
		render(<InboxPage />);

		const title = screen.getByText("Bob assigned 'Fix bug' to you");
		// Read item should not have bold
		expect(title.className).not.toMatch(/font-semibold|font-bold/);
	});
});

// ---- sourceDeleted handling ----

describe("InboxPage sourceDeleted", () => {
	it("shows 'Card no longer exists' and disables click for sourceDeleted notification", () => {
		const deleted = makeNotification({
			id: 3,
			sourceDeleted: true,
			readAt: "2026-06-29T11:00:00Z",
		});
		mockUseNotificationsContext.mockReturnValue({
			...baseCtx,
			notifications: [deleted],
			unreadCount: 0,
		});
		render(<InboxPage />);

		expect(screen.getByText(/Card no longer exists/i)).toBeTruthy();

		// Clicking should NOT call markAsRead
		const item = screen
			.getByText("Bob assigned 'Fix bug' to you")
			.closest("li")!;
		fireEvent.click(item);
		expect(baseCtx.markAsRead).not.toHaveBeenCalled();
		expect(mockNavigate).not.toHaveBeenCalled();
	});
});

// ---- Navigation on click ----

describe("InboxPage click navigation", () => {
	it("navigates to /board?card={cardId} and calls markAsRead on click", async () => {
		const markAsRead = vi.fn().mockResolvedValue(undefined);
		const notification = makeNotification({ id: 4, cardId: 99, readAt: null });
		mockUseNotificationsContext.mockReturnValue({
			...baseCtx,
			notifications: [notification],
			unreadCount: 1,
			markAsRead,
		});
		render(<InboxPage />);

		const item = screen
			.getByText("Bob assigned 'Fix bug' to you")
			.closest("li")!;
		fireEvent.click(item);

		await waitFor(() => {
			expect(markAsRead).toHaveBeenCalledWith(4);
		});
		expect(mockNavigate).toHaveBeenCalledWith("/board?card=99");
	});

	it("does not navigate when notification has no cardId", async () => {
		const markAsRead = vi.fn().mockResolvedValue(undefined);
		const notification = makeNotification({
			id: 5,
			cardId: null,
			type: "welcome",
			title: "Welcome!",
		});
		mockUseNotificationsContext.mockReturnValue({
			...baseCtx,
			notifications: [notification],
			unreadCount: 1,
			markAsRead,
		});
		render(<InboxPage />);

		const item = screen.getByText("Welcome!").closest("li")!;
		fireEvent.click(item);

		await waitFor(() => {
			expect(markAsRead).toHaveBeenCalledWith(5);
		});
		expect(mockNavigate).not.toHaveBeenCalled();
	});
});

// ---- Mark all as read ----

describe("InboxPage mark all as read", () => {
	it("calls markAllAsRead and hides badge when clicked", async () => {
		const markAllAsRead = vi.fn().mockResolvedValue(undefined);
		mockUseNotificationsContext.mockReturnValue({
			...baseCtx,
			notifications: [
				makeNotification({ id: 1, readAt: null }),
				makeNotification({ id: 2, readAt: null }),
				makeNotification({ id: 3, readAt: null }),
			],
			unreadCount: 3,
			markAllAsRead,
		});
		render(<InboxPage />);

		fireEvent.click(screen.getByRole("button", { name: /mark all as read/i }));

		await waitFor(() => {
			expect(markAllAsRead).toHaveBeenCalled();
		});
	});
});

describe("InboxPage load more", () => {
	it("shows Load more button when hasMore and calls loadMore on click", async () => {
		const loadMore = vi.fn().mockResolvedValue(undefined);
		mockUseNotificationsContext.mockReturnValue({
			...baseCtx,
			notifications: [makeNotification({ id: 1, readAt: null })],
			unreadCount: 1,
			hasMore: true,
			loadMore,
		});
		render(<InboxPage />);

		fireEvent.click(screen.getByRole("button", { name: /load more/i }));

		await waitFor(() => {
			expect(loadMore).toHaveBeenCalled();
		});
	});
});
