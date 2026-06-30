import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AppNotification, AppNotificationType } from "../types";

const PAGE_SIZE = 50;

function normalizeNotification(raw: Record<string, unknown>): AppNotification {
	return {
		id: Number(raw.id),
		type: raw.type as AppNotificationType,
		title: String(raw.title),
		body: (raw.body as string | null) ?? null,
		cardId: (raw.cardId ?? raw.card_id ?? null) as number | null,
		boardId: (raw.boardId ?? raw.board_id ?? null) as number | null,
		actorId: (raw.actorId ?? raw.actor_id ?? null) as number | null,
		readAt: (raw.readAt ?? raw.read_at ?? null) as string | null,
		sourceDeleted: Boolean(raw.sourceDeleted ?? raw.source_deleted ?? false),
		createdAt: String(raw.createdAt ?? raw.created_at),
	};
}

async function fetchFirstPage(workspaceId: number) {
	return api.getNotifications(workspaceId, { limit: PAGE_SIZE });
}

export interface UseNotificationsResult {
	notifications: AppNotification[];
	unreadCount: number;
	loading: boolean;
	loadingMore: boolean;
	hasMore: boolean;
	loadMore: () => Promise<void>;
	markAsRead: (id: number) => Promise<void>;
	markAllAsRead: () => Promise<void>;
}

export function useNotifications(
	workspaceId: number | null,
): UseNotificationsResult {
	const [notifications, setNotifications] = useState<AppNotification[]>([]);
	const [unreadCount, setUnreadCount] = useState(0);
	const [nextCursor, setNextCursor] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);

	const markAsRead = useCallback(
		async (id: number) => {
			if (workspaceId === null) return;

			setNotifications((prev) => {
				const target = prev.find((n) => n.id === id);
				if (target && target.readAt === null) {
					setUnreadCount((c) => Math.max(0, c - 1));
				}
				return prev.map((n) =>
					n.id === id && n.readAt === null
						? { ...n, readAt: new Date().toISOString() }
						: n,
				);
			});

			try {
				await api.markNotificationAsRead(workspaceId, id);
			} catch {
				const data = await fetchFirstPage(workspaceId);
				setNotifications(data.notifications);
				setUnreadCount(data.unreadCount);
				setNextCursor(data.nextCursor);
			}
		},
		[workspaceId],
	);

	const markAllAsRead = useCallback(async () => {
		if (workspaceId === null) return;

		const now = new Date().toISOString();
		setNotifications((prev) =>
			prev.map((n) => (n.readAt === null ? { ...n, readAt: now } : n)),
		);
		setUnreadCount(0);

		try {
			await api.markAllNotificationsAsRead(workspaceId);
		} catch {
			const data = await fetchFirstPage(workspaceId);
			setNotifications(data.notifications);
			setUnreadCount(data.unreadCount);
			setNextCursor(data.nextCursor);
		}
	}, [workspaceId]);

	const loadMore = useCallback(async () => {
		if (workspaceId === null || nextCursor === null || loadingMore) return;

		setLoadingMore(true);
		try {
			const data = await api.getNotifications(workspaceId, {
				cursor: nextCursor,
				limit: PAGE_SIZE,
			});
			setNotifications((prev) => {
				const seen = new Set(prev.map((n) => n.id));
				const appended = data.notifications.filter((n) => !seen.has(n.id));
				return [...prev, ...appended];
			});
			setNextCursor(data.nextCursor);
		} finally {
			setLoadingMore(false);
		}
	}, [workspaceId, nextCursor, loadingMore]);

	useEffect(() => {
		if (workspaceId === null) {
			setNotifications([]);
			setUnreadCount(0);
			setNextCursor(null);
			setLoading(false);
			return;
		}

		let active = true;
		setLoading(true);

		void fetchFirstPage(workspaceId)
			.then((data) => {
				if (!active) return;
				setNotifications(data.notifications);
				setUnreadCount(data.unreadCount);
				setNextCursor(data.nextCursor);
			})
			.finally(() => {
				if (active) setLoading(false);
			});

		const stream = new EventSource(
			`/api/workspaces/${workspaceId}/notifications/stream`,
			{ withCredentials: true },
		);

		const onCreated = (e: MessageEvent) => {
			try {
				const raw = JSON.parse(e.data as string) as Record<string, unknown>;
				const notification = normalizeNotification(raw);
				setNotifications((prev) => {
					if (prev.some((n) => n.id === notification.id)) return prev;
					return [notification, ...prev];
				});
				if (notification.readAt === null) {
					setUnreadCount((c) => c + 1);
				}
			} catch {
				// ignore malformed SSE payloads
			}
		};

		const onRead = (e: MessageEvent) => {
			try {
				const { id } = JSON.parse(e.data as string) as { id: number };
				setNotifications((prev) => {
					const hadUnread = prev.some((n) => n.id === id && n.readAt === null);
					if (!hadUnread) return prev;
					setUnreadCount((c) => Math.max(0, c - 1));
					return prev.map((n) =>
						n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
					);
				});
			} catch {
				// ignore malformed SSE payloads
			}
		};

		const onReadAll = () => {
			const now = new Date().toISOString();
			setNotifications((prev) =>
				prev.map((n) => (n.readAt === null ? { ...n, readAt: now } : n)),
			);
			setUnreadCount(0);
		};

		stream.addEventListener("notification.created", onCreated);
		stream.addEventListener("notification.read", onRead);
		stream.addEventListener("notifications.read-all", onReadAll);

		return () => {
			active = false;
			stream.removeEventListener("notification.created", onCreated);
			stream.removeEventListener("notification.read", onRead);
			stream.removeEventListener("notifications.read-all", onReadAll);
			stream.close();
		};
	}, [workspaceId]);

	return {
		notifications,
		unreadCount,
		loading,
		loadingMore,
		hasMore: nextCursor !== null,
		loadMore,
		markAsRead,
		markAllAsRead,
	};
}
