import {
	CheckCircle2,
	ChevronRight,
	Loader2,
	PencilLine,
	Sparkles,
	XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { useBoard } from "../context/BoardContext";
import type { AgentBoard } from "../types";
import { formatRelativeTime } from "../types";

const TEMPLATE_NAMES: Record<string, string> = {
	"research-report": "Research & Report",
};

function templateName(templateId: string): string {
	return TEMPLATE_NAMES[templateId] ?? templateId;
}

// ---- Status model ----

type StatusKey = "draft" | "running" | "done" | "failed";

function statusKey(board: AgentBoard): StatusKey {
	if (board.executionStatus === "done") return "done";
	if (board.executionStatus === "failed") return "failed";
	if (board.executionStatus === "running") return "running";
	return "draft";
}

const STATUS_META: Record<
	StatusKey,
	{
		label: string;
		pill: string;
		iconWrap: string;
		dot: string;
		Icon: typeof CheckCircle2;
		spin?: boolean;
	}
> = {
	done: {
		label: "Done",
		pill: "bg-success-100 text-success-900",
		iconWrap: "bg-success-100 text-success-900",
		dot: "bg-success-500/60",
		Icon: CheckCircle2,
	},
	running: {
		label: "Running",
		pill: "bg-info-100 text-info-900",
		iconWrap: "bg-info-100 text-info-900",
		dot: "bg-info-500/60",
		Icon: Loader2,
		spin: true,
	},
	failed: {
		label: "Failed",
		pill: "bg-error-100 text-error-900",
		iconWrap: "bg-error-100 text-error-900",
		dot: "bg-error-500/60",
		Icon: XCircle,
	},
	draft: {
		label: "Draft",
		pill: "bg-warning-100 text-warning-900",
		iconWrap: "bg-neutral-200 text-neutral-600",
		dot: "bg-neutral-300",
		Icon: PencilLine,
	},
};

// ---- Time bucketing ----

const BUCKETS = ["Today", "Yesterday", "Previous 7 days", "Older"] as const;
type Bucket = (typeof BUCKETS)[number];

function bucketOf(dateStr: string): Bucket {
	const now = new Date();
	const startToday = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
	const d = new Date(dateStr);
	const startThat = new Date(
		d.getFullYear(),
		d.getMonth(),
		d.getDate(),
	).getTime();
	const diffDays = Math.round((startToday - startThat) / 86_400_000);
	if (diffDays <= 0) return "Today";
	if (diffDays === 1) return "Yesterday";
	if (diffDays <= 7) return "Previous 7 days";
	return "Older";
}

// ---- Filters ----

const FILTERS: { key: "all" | StatusKey; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "draft", label: "Draft" },
	{ key: "running", label: "Running" },
	{ key: "done", label: "Done" },
	{ key: "failed", label: "Failed" },
];

// ---- Card ----

function BoardRow({
	board,
	onOpen,
}: {
	board: AgentBoard;
	onOpen: () => void;
}) {
	const meta = STATUS_META[statusKey(board)];
	const { Icon } = meta;
	const colCount = board.columns?.length ?? 0;

	return (
		<button
			onClick={onOpen}
			className="group flex w-full items-center gap-3.5 rounded-lg border border-neutral-200 bg-white px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
		>
			<span
				className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.iconWrap}`}
			>
				<Icon
					size={18}
					className={meta.spin ? "animate-spin" : ""}
					aria-hidden
				/>
			</span>

			<div className="min-w-0 flex-1">
				<p className="line-clamp-2 text-sm font-medium leading-snug text-neutral-900">
					{board.originalIntent}
				</p>
				<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
					<span>{templateName(board.templateId)}</span>
					<span aria-hidden>·</span>
					<span>{formatRelativeTime(board.createdAt)}</span>
					{colCount > 0 && (
						<>
							<span aria-hidden>·</span>
							<span className="inline-flex items-center gap-1">
								<span className="flex items-center gap-0.5">
									{Array.from({ length: Math.min(colCount, 6) }).map((_, i) => (
										<span
											key={i}
											className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
										/>
									))}
								</span>
								{colCount} column{colCount === 1 ? "" : "s"}
							</span>
						</>
					)}
				</div>
			</div>

			<span
				className={`hidden shrink-0 rounded-md px-2 py-0.5 text-xs font-medium sm:inline ${meta.pill}`}
			>
				{meta.label}
			</span>
			<ChevronRight
				size={16}
				className="shrink-0 text-neutral-300 transition-colors group-hover:text-primary-500"
				aria-hidden
			/>
		</button>
	);
}

// ---- Page ----

export default function HistoryPage() {
	const { activeWorkspaceId } = useBoard();
	const navigate = useNavigate();
	const [boards, setBoards] = useState<AgentBoard[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(false);
	const [filter, setFilter] = useState<"all" | StatusKey>("all");

	useEffect(() => {
		if (activeWorkspaceId === null) return;
		let cancelled = false;
		setLoading(true);
		setError(false);
		api
			.getAgentBoards(activeWorkspaceId)
			.then((data) => {
				if (!cancelled) setBoards(data);
			})
			.catch(() => {
				if (!cancelled) setError(true);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [activeWorkspaceId]);

	const counts = useMemo(() => {
		const c: Record<string, number> = { all: boards.length };
		for (const b of boards) {
			const k = statusKey(b);
			c[k] = (c[k] ?? 0) + 1;
		}
		return c;
	}, [boards]);

	// Filter + sort newest-first, then bucket by recency.
	const grouped = useMemo(() => {
		const filtered =
			filter === "all" ? boards : boards.filter((b) => statusKey(b) === filter);
		const sorted = [...filtered].sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
		const map = new Map<Bucket, AgentBoard[]>();
		for (const b of sorted) {
			const key = bucketOf(b.createdAt);
			const arr = map.get(key) ?? [];
			arr.push(b);
			map.set(key, arr);
		}
		return BUCKETS.filter((k) => map.has(k)).map((k) => ({
			label: k,
			items: map.get(k) as AgentBoard[],
		}));
	}, [boards, filter]);

	if (activeWorkspaceId === null) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<p className="text-sm text-neutral-500">
					Select a workspace to view history.
				</p>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<p className="text-sm text-neutral-500">Loading boards...</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
				<p className="text-sm text-error-600">
					Couldn&apos;t load boards. Check your connection and try again.
				</p>
				<button
					onClick={() => window.location.reload()}
					className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Retry
				</button>
			</div>
		);
	}

	// Empty — no boards at all
	if (boards.length === 0) {
		return (
			<div className="flex min-h-full items-center justify-center p-8">
				<div className="animate-rise-in flex max-w-sm flex-col items-center text-center">
					<span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-100">
						<Sparkles size={26} className="text-primary-600" aria-hidden />
					</span>
					<h2 className="mt-4 text-lg font-semibold text-neutral-900">
						No boards yet
					</h2>
					<p className="mt-1 text-sm text-neutral-600">
						Every board you run with the agent shows up here so you can revisit
						its results.
					</p>
					<Link
						to="/agent"
						className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<Sparkles size={15} aria-hidden />
						Create your first board
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-3xl px-5 py-6 md:px-8 md:py-8">
			{/* Header */}
			<div className="flex items-end justify-between gap-4">
				<div>
					<h2 className="text-xl font-semibold tracking-tight text-neutral-900">
						History
					</h2>
					<p className="mt-1 text-sm text-neutral-600">
						{boards.length} board{boards.length === 1 ? "" : "s"} · revisit past
						runs and their results.
					</p>
				</div>
				<Link
					to="/agent"
					className="hidden shrink-0 items-center gap-1.5 rounded-md bg-primary-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 sm:inline-flex"
				>
					<Sparkles size={15} aria-hidden />
					New board
				</Link>
			</div>

			{/* Filters */}
			<div className="mt-5 flex flex-wrap gap-2 border-b border-neutral-200 pb-4">
				{FILTERS.map((f) => {
					const active = filter === f.key;
					const count = counts[f.key] ?? 0;
					if (f.key !== "all" && count === 0) return null;
					return (
						<button
							key={f.key}
							onClick={() => setFilter(f.key)}
							className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
								active
									? "bg-primary-600 text-white shadow-sm"
									: "border border-neutral-200 bg-white text-neutral-600 hover:border-primary-300 hover:text-primary-800"
							}`}
						>
							{f.label}
							<span
								className={`rounded-full px-1.5 text-[10px] ${
									active
										? "bg-white/20 text-white"
										: "bg-neutral-100 text-neutral-500"
								}`}
							>
								{count}
							</span>
						</button>
					);
				})}
			</div>

			{/* Grouped list */}
			{grouped.length === 0 ? (
				<p className="mt-10 text-center text-sm text-neutral-500">
					No boards match this filter.
				</p>
			) : (
				<div className="mt-6 space-y-7">
					{grouped.map((group) => (
						<section key={group.label}>
							<h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
								{group.label}
							</h3>
							<div className="space-y-2">
								{group.items.map((board) => (
									<BoardRow
										key={board.id}
										board={board}
										onOpen={() => navigate(`/agent?boardId=${board.id}`)}
									/>
								))}
							</div>
						</section>
					))}
				</div>
			)}
		</div>
	);
}
