import { Inbox, CheckCheck } from "lucide-react";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { useNotificationsContext } from "../context/NotificationsContext";
import type { AppNotification } from "../types";
import { formatRelativeTime } from "../types";

/**
 * InboxPage — workspace-scoped notification center.
 *
 * Colors, typography, and spacing follow docs/pocket/rule/creative-brief.md:
 * - Unread: font-semibold title + primary-600 blue dot
 * - Read: normal weight, text-neutral-600 muted
 * - sourceDeleted: opacity-50, cursor-not-allowed, "Card no longer exists"
 * - Empty state: Inbox icon + Indonesian copy
 */
export default function InboxPage() {
	const { notifications, unreadCount, loading, markAsRead, markAllAsRead } =
		useNotificationsContext();
	const navigate = useNavigate();

	const handleItemClick = useCallback(
		async (notification: AppNotification) => {
			if (notification.sourceDeleted) return;
			await markAsRead(notification.id);
			if (notification.cardId != null) {
				navigate(`/board?card=${notification.cardId}`);
			}
		},
		[markAsRead, navigate],
	);

	return (
		<div className="mx-auto max-w-2xl px-4 py-6 md:px-6">
			<PageHeader
				icon={Inbox}
				title="Inbox"
				subtitle="Notifikasi terbaru kamu"
				actions={
					unreadCount > 0 ? (
						<button
							type="button"
							onClick={() => void markAllAsRead()}
							className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<CheckCheck size={14} aria-hidden />
							Mark all as read
						</button>
					) : undefined
				}
			/>

			<div className="mt-6">
				{loading ? (
					<p className="text-sm text-neutral-500">Loading...</p>
				) : notifications.length === 0 ? (
					<EmptyState
						icon={Inbox}
						title="Inbox kamu kosong"
						description="Semua terkendali!"
					/>
				) : (
					<ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
						{notifications.map((n) => (
							<NotificationItem
								key={n.id}
								notification={n}
								onClick={handleItemClick}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Notification item                                                  */
/* ------------------------------------------------------------------ */

function NotificationItem({
	notification: n,
	onClick,
}: {
	notification: AppNotification;
	onClick: (n: AppNotification) => void;
}) {
	const isUnread = n.readAt === null;
	const isDeleted = n.sourceDeleted;

	return (
		<li
			className={`flex items-start gap-3 px-4 py-3 transition-colors ${
				isDeleted
					? "cursor-not-allowed opacity-50"
					: "cursor-pointer hover:bg-neutral-100"
			}`}
			onClick={() => {
				if (!isDeleted) void onClick(n);
			}}
			onKeyDown={(e) => {
				if (!isDeleted && (e.key === "Enter" || e.key === " ")) {
					e.preventDefault();
					void onClick(n);
				}
			}}
			role={isDeleted ? undefined : "button"}
			tabIndex={isDeleted ? undefined : 0}
			aria-label={n.title}
		>
			{/* Unread indicator dot */}
			{isUnread && (
				<span
					data-testid={`unread-dot-${n.id}`}
					className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-600"
					aria-hidden
				/>
			)}
			{!isUnread && <span className="mt-1.5 h-2 w-2 shrink-0" aria-hidden />}

			<div className="min-w-0 flex-1">
				<p
					className={`text-sm leading-snug ${
						isUnread
							? "font-semibold text-neutral-900"
							: "text-neutral-700"
					}`}
				>
					{n.title}
				</p>
				{n.body && (
					<p className="mt-0.5 text-xs text-neutral-600 line-clamp-2">
						{n.body}
					</p>
				)}
				{isDeleted && (
					<p className="mt-1 text-xs italic text-neutral-500">
						Card no longer exists
					</p>
				)}
				<p className="mt-1 text-xs text-neutral-500">
					{formatRelativeTime(n.createdAt)}
				</p>
			</div>
		</li>
	);
}
