import {
	AlarmClock,
	CalendarClock,
	CheckCheck,
	ChevronRight,
	Inbox,
	type LucideIcon,
	Sparkles,
	TriangleAlert,
	UserCheck,
	UserPlus,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { useNotificationsContext } from "../context/NotificationsContext";
import type { AppNotification, AppNotificationType } from "../types";
import { formatRelativeTime } from "../types";

/**
 * InboxPage — workspace-scoped notification center.
 *
 * Colors, typography, and spacing follow docs/pocket/rule/creative-brief.md
 * (calm Notion/Linear, muted chroma). Each notification carries a type-specific
 * icon + semantic tint so its purpose is legible at a glance; rows are grouped
 * by day and an "Unread" filter narrows the view. The empty state names what
 * lands here and offers a way back to the board — never a dead end.
 */

type TypeMeta = { icon: LucideIcon; chip: string };

/** Per-type icon + semantic tint (bg-100 / text-900 from the brief). */
const TYPE_META: Record<AppNotificationType, TypeMeta> = {
	card_assigned: { icon: UserPlus, chip: "bg-primary-100 text-primary-700" },
	due_date_changed: { icon: CalendarClock, chip: "bg-info-100 text-info-900" },
	due_date_reminder: {
		icon: AlarmClock,
		chip: "bg-warning-100 text-warning-900",
	},
	welcome: { icon: Sparkles, chip: "bg-accent-100 text-accent-700" },
	member_joined: { icon: UserCheck, chip: "bg-success-100 text-success-900" },
	system_alert: { icon: TriangleAlert, chip: "bg-error-100 text-error-900" },
};

const FALLBACK_META: TypeMeta = {
	icon: Inbox,
	chip: "bg-neutral-100 text-neutral-700",
};

/** Bucket a notification into a human day group, preserving input order. */
function dayGroup(iso: string): "Hari ini" | "Kemarin" | "Sebelumnya" {
	const startOfDay = (d: Date) => {
		const x = new Date(d);
		x.setHours(0, 0, 0, 0);
		return x.getTime();
	};
	const diffDays = Math.round(
		(startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000,
	);
	if (diffDays <= 0) return "Hari ini";
	if (diffDays === 1) return "Kemarin";
	return "Sebelumnya";
}

export default function InboxPage() {
	const {
		notifications,
		unreadCount,
		loading,
		loadingMore,
		hasMore,
		loadMore,
		markAsRead,
		markAllAsRead,
	} = useNotificationsContext();
	const navigate = useNavigate();
	const [filter, setFilter] = useState<"all" | "unread">("all");

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

	const visible = useMemo(
		() =>
			filter === "unread"
				? notifications.filter((n) => n.readAt === null)
				: notifications,
		[notifications, filter],
	);

	// Ordered day buckets (notifications arrive newest-first).
	const groups = useMemo(() => {
		const order: string[] = [];
		const map = new Map<string, AppNotification[]>();
		for (const n of visible) {
			const key = dayGroup(n.createdAt);
			if (!map.has(key)) {
				map.set(key, []);
				order.push(key);
			}
			map.get(key)?.push(n);
		}
		return order.map((key) => [key, map.get(key) ?? []] as const);
	}, [visible]);

	return (
		<div className="mx-auto max-w-2xl px-4 py-6 md:px-6">
			<PageHeader
				icon={Inbox}
				title="Inbox"
				subtitle={
					unreadCount > 0
						? `${unreadCount} notifikasi belum dibaca`
						: "Semua notifikasi sudah dibaca"
				}
				actions={
					unreadCount > 0 ? (
						<button
							type="button"
							onClick={() => void markAllAsRead()}
							className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm text-primary-700 transition-colors hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<CheckCheck size={14} aria-hidden />
							Mark all as read
						</button>
					) : undefined
				}
			/>

			{/* Filter — only meaningful once something has arrived. */}
			{!loading && notifications.length > 0 && (
				<div
					className="mt-5 inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-neutral-100 p-0.5"
					role="tablist"
					aria-label="Filter notifikasi"
				>
					<FilterTab
						active={filter === "all"}
						onClick={() => setFilter("all")}
						label="Semua"
						count={notifications.length}
					/>
					<FilterTab
						active={filter === "unread"}
						onClick={() => setFilter("unread")}
						label="Belum dibaca"
						count={unreadCount}
					/>
				</div>
			)}

			<div className="mt-5">
				{loading ? (
					<InboxSkeleton />
				) : notifications.length === 0 ? (
					<div className="flex min-h-[420px] items-center justify-center rounded-xl border border-neutral-200 bg-white px-6">
						<EmptyState
							icon={CheckCheck}
							title="Inbox kamu kosong"
							description="Kamu sudah menyusul semuanya. Penugasan kartu, pengingat tenggat, dan update tim akan muncul di sini."
							action={
								<button
									type="button"
									onClick={() => navigate("/board")}
									className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3.5 py-1.5 text-sm font-medium text-primary-700 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
								>
									Buka board
									<ChevronRight size={14} aria-hidden />
								</button>
							}
						/>
					</div>
				) : visible.length === 0 ? (
					<div className="flex min-h-[280px] items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-100/40 px-6 text-center">
						<div>
							<p className="text-sm font-medium text-neutral-700">
								Tidak ada yang belum dibaca
							</p>
							<p className="mt-1 text-sm text-neutral-500">
								Kamu sudah menyusul semuanya.
							</p>
						</div>
					</div>
				) : (
					<>
						<div className="space-y-6">
							{groups.map(([label, items]) => (
								<section key={label}>
									<h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
										{label}
									</h2>
									<ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white">
										{items.map((n) => (
											<NotificationItem
												key={n.id}
												notification={n}
												onClick={handleItemClick}
											/>
										))}
									</ul>
								</section>
							))}
						</div>
						{filter === "all" && hasMore && (
							<div className="mt-5 flex justify-center">
								<button
									type="button"
									onClick={() => void loadMore()}
									disabled={loadingMore}
									className="rounded-md border border-neutral-300 bg-neutral-100 px-4 py-2 text-sm text-primary-700 transition-colors hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
								>
									{loadingMore ? "Loading..." : "Load more"}
								</button>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Filter tab                                                         */
/* ------------------------------------------------------------------ */

function FilterTab({
	active,
	onClick,
	label,
	count,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
	count: number;
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={onClick}
			className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
				active
					? "bg-white font-medium text-neutral-900 shadow-sm"
					: "text-neutral-600 hover:text-neutral-900"
			}`}
		>
			{label}
			<span
				className={`rounded-full px-1.5 text-xs tabular-nums ${
					active ? "bg-primary-100 text-primary-700" : "text-neutral-500"
				}`}
			>
				{count}
			</span>
		</button>
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
	const { icon: TypeIcon, chip } = TYPE_META[n.type] ?? FALLBACK_META;

	return (
		<li
			className={`group relative flex items-start gap-3 px-4 py-3 transition-colors ${
				isDeleted
					? "cursor-not-allowed opacity-60"
					: isUnread
						? "cursor-pointer bg-primary-100/40 hover:bg-primary-100/70"
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
			{/* Unread accent rail */}
			{isUnread && !isDeleted && (
				<span
					className="absolute inset-y-0 left-0 w-0.5 bg-primary-600"
					aria-hidden
				/>
			)}

			{/* Type icon chip */}
			<span
				className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${chip}`}
				aria-hidden
			>
				<TypeIcon size={16} />
			</span>

			<div className="min-w-0 flex-1">
				<div className="flex items-start gap-2">
					<p
						className={`min-w-0 flex-1 text-sm leading-snug ${
							isUnread ? "font-semibold text-neutral-900" : "text-neutral-700"
						}`}
					>
						{n.title}
					</p>
					<time className="shrink-0 pt-0.5 text-xs text-neutral-500 tabular-nums">
						{formatRelativeTime(n.createdAt)}
					</time>
					{isUnread ? (
						<span
							data-testid={`unread-dot-${n.id}`}
							className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-600"
							aria-hidden
						/>
					) : (
						<span className="mt-1.5 h-2 w-2 shrink-0" aria-hidden />
					)}
				</div>

				{n.body && (
					<p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-neutral-600">
						{n.body}
					</p>
				)}

				{isDeleted && (
					<span className="mt-1.5 inline-flex items-center gap-1 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
						Card no longer exists
					</span>
				)}
			</div>
		</li>
	);
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function InboxSkeleton() {
	return (
		<div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
			{[0, 1, 2, 3].map((i) => (
				<div
					key={i}
					className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3 last:border-b-0"
				>
					<div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-neutral-200" />
					<div className="flex-1 space-y-2 py-0.5">
						<div className="h-3 w-2/3 animate-pulse rounded bg-neutral-200" />
						<div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
					</div>
				</div>
			))}
		</div>
	);
}
