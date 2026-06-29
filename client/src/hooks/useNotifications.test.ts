// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppNotification } from "../types";

const mockGetNotifications = vi.fn();
const mockMarkNotificationAsRead = vi.fn();
const mockMarkAllNotificationsAsRead = vi.fn();

vi.mock("../api", () => ({
	api: {
		getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
		markNotificationAsRead: (...args: unknown[]) =>
			mockMarkNotificationAsRead(...args),
		markAllNotificationsAsRead: (...args: unknown[]) =>
			mockMarkAllNotificationsAsRead(...args),
	},
}));

class MockEventSource {
	static instances: MockEventSource[] = [];

	url: string;
	options?: EventSourceInit;
	close = vi.fn();
	private listeners = new Map<string, Array<(e: MessageEvent) => void>>();

	constructor(url: string, options?: EventSourceInit) {
		this.url = url;
		this.options = options;
		MockEventSource.instances.push(this);
	}

	addEventListener(type: string, handler: (e: MessageEvent) => void) {
		const list = this.listeners.get(type) ?? [];
		list.push(handler);
		this.listeners.set(type, list);
	}

	emit(type: string, data: unknown) {
		const event = { data: JSON.stringify(data) } as MessageEvent;
		for (const handler of this.listeners.get(type) ?? []) {
			handler(event);
		}
	}

	static reset() {
		MockEventSource.instances = [];
	}

	static latest() {
		return MockEventSource.instances[MockEventSource.instances.length - 1];
	}
}

vi.stubGlobal("EventSource", MockEventSource);

const sampleNotification: AppNotification = {
	id: 10,
	type: "card_assigned",
	title: "Bob assigned 'Fix bug' to you",
	body: null,
	cardId: 42,
	actorId: 7,
	readAt: null,
	sourceDeleted: false,
	createdAt: "2026-06-29T10:00:00Z",
};

describe("useNotifications", () => {
	beforeEach(() => {
		MockEventSource.reset();
		mockGetNotifications.mockReset();
		mockMarkNotificationAsRead.mockReset();
		mockMarkAllNotificationsAsRead.mockReset();
		mockGetNotifications.mockResolvedValue({
			notifications: [sampleNotification],
			unreadCount: 1,
			nextCursor: null,
		});
		mockMarkNotificationAsRead.mockResolvedValue({ ok: true });
		mockMarkAllNotificationsAsRead.mockResolvedValue({
			ok: true,
			markedCount: 1,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("fetches notifications on mount when workspaceId is set", async () => {
		const { useNotifications } = await import("./useNotifications");
		const { result } = renderHook(() => useNotifications(1));

		await waitFor(() => {
			expect(result.current.notifications).toHaveLength(1);
		});

		expect(mockGetNotifications).toHaveBeenCalledWith(1);
		expect(result.current.unreadCount).toBe(1);
		expect(result.current.notifications[0]).toEqual(sampleNotification);
		expect(MockEventSource.latest()?.url).toBe(
			"/api/workspaces/1/notifications/stream",
		);
	});

	it("markAsRead optimistically marks a notification read and decrements unreadCount", async () => {
		const { useNotifications } = await import("./useNotifications");
		const { result } = renderHook(() => useNotifications(1));

		await waitFor(() => {
			expect(result.current.notifications).toHaveLength(1);
		});

		await act(async () => {
			await result.current.markAsRead(10);
		});

		expect(mockMarkNotificationAsRead).toHaveBeenCalledWith(1, 10);
		expect(result.current.notifications[0].readAt).not.toBeNull();
		expect(result.current.unreadCount).toBe(0);
	});

	it("markAllAsRead optimistically marks all notifications read and sets unreadCount to 0", async () => {
		mockGetNotifications.mockResolvedValue({
			notifications: [
				sampleNotification,
				{ ...sampleNotification, id: 11, readAt: null },
			],
			unreadCount: 2,
			nextCursor: null,
		});

		const { useNotifications } = await import("./useNotifications");
		const { result } = renderHook(() => useNotifications(1));

		await waitFor(() => {
			expect(result.current.unreadCount).toBe(2);
		});

		await act(async () => {
			await result.current.markAllAsRead();
		});

		expect(mockMarkAllNotificationsAsRead).toHaveBeenCalledWith(1);
		expect(result.current.unreadCount).toBe(0);
		expect(
			result.current.notifications.every((n) => n.readAt !== null),
		).toBe(true);
	});

	it("prepends notification and increments unreadCount on SSE notification.created", async () => {
		const { useNotifications } = await import("./useNotifications");
		const { result } = renderHook(() => useNotifications(1));

		await waitFor(() => {
			expect(result.current.notifications).toHaveLength(1);
		});

		const stream = MockEventSource.latest();
		expect(stream).toBeDefined();

		act(() => {
			stream!.emit("notification.created", {
				id: 99,
				type: "welcome",
				title: "Welcome!",
				body: null,
				card_id: null,
				actor_id: null,
				read_at: null,
				source_deleted: false,
				created_at: "2026-06-29T12:00:00Z",
			});
		});

		expect(result.current.notifications[0].id).toBe(99);
		expect(result.current.notifications[0].type).toBe("welcome");
		expect(result.current.unreadCount).toBe(2);
	});
});
