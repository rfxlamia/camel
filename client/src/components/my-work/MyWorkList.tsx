import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback } from "react";
import { useBoard } from "../../context/BoardContext";
import {
	deriveMyWorkGroups,
	type MyWorkStatusGroup,
} from "../../lib/myWorkStatus";
import type { MyWorkItem, MyWorkScope } from "../../types/myWork";
import MyWorkRow from "./MyWorkRow";

export function SessionErrorState() {
	const { logout } = useBoard();
	const handleSignIn = useCallback(async () => {
		await logout();
		window.location.assign("/login");
	}, [logout]);

	return (
		<div
			data-testid="my-work-session-error"
			className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center md:px-6"
		>
			<AlertTriangle size={22} className="text-warning-500" aria-hidden />
			<h2 className="mt-3 font-semibold text-neutral-900 text-base">
				Your session has expired
			</h2>
			<p role="alert" className="mt-1 max-w-sm text-neutral-600 text-sm">
				Sign in again to see your assigned work.
			</p>
			<button
				type="button"
				onClick={() => void handleSignIn()}
				className="mt-4 inline-flex h-9 items-center rounded-md bg-primary-600 px-3 font-medium text-sm text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none"
			>
				Sign in again
			</button>
		</div>
	);
}

export interface MyWorkListProps {
	items: MyWorkItem[];
	scope?: MyWorkScope;
	page: number;
	pageCount?: number;
	hasPrevious?: boolean;
	hasNext?: boolean;
	onPageChange: (page: number) => void;
	onSelect?: (item: MyWorkItem) => void;
	onRefresh?: () => void | Promise<void>;
}

const GROUP_ORDER: MyWorkStatusGroup[] = [
	"backlog",
	"started",
	"completed",
	"canceled",
	"other",
];

const GROUP_LABELS: Record<MyWorkStatusGroup, string> = {
	backlog: "Backlog",
	started: "In progress",
	completed: "Done",
	canceled: "Canceled",
	other: "Other",
};

const GROUP_DOT_CLASSES: Record<MyWorkStatusGroup, string> = {
	backlog: "bg-primary-400",
	started: "bg-warning-500",
	completed: "bg-success-500",
	canceled: "bg-error-500",
	other: "bg-primary-400",
};

function GroupSection({
	group,
	items,
	onSelect,
	onRefresh,
}: {
	group: MyWorkStatusGroup;
	items: MyWorkItem[];
	onSelect?: (item: MyWorkItem) => void;
	onRefresh?: () => void | Promise<void>;
}) {
	return (
		<section
			data-testid={`my-work-group-${group}`}
			aria-labelledby={`my-work-group-label-${group}`}
		>
			<div className="flex items-center gap-2 border-neutral-200/70 border-b bg-neutral-100/80 px-4 py-2.5 md:px-5">
				<span
					className={`h-2 w-2 rounded-full ${GROUP_DOT_CLASSES[group]}`}
					aria-hidden
				/>
				<h2
					id={`my-work-group-label-${group}`}
					className="font-semibold text-neutral-700 text-xs"
				>
					{GROUP_LABELS[group]}
				</h2>
				<span className="text-neutral-500 text-xs tabular-nums">
					{items.length}
				</span>
			</div>
			<ul className="divide-y divide-neutral-200/80">
				{items.map((item) => (
					<MyWorkRow
						key={`${item.workspaceId}:${item.source}:${item.key}`}
						item={item}
						onSelect={onSelect}
						onRefresh={onRefresh}
					/>
				))}
			</ul>
		</section>
	);
}

function PaginationControls({
	page,
	pageCount,
	hasPrevious,
	hasNext,
	onPageChange,
}: Pick<Required<MyWorkListProps>, "page" | "pageCount" | "onPageChange"> &
	Partial<Pick<MyWorkListProps, "hasPrevious" | "hasNext">>) {
	const previous = hasPrevious ?? page > 1;
	const next = hasNext ?? page < pageCount;
	return (
		<nav
			className="mt-4 flex items-center justify-between gap-3"
			aria-label="My Work pages"
		>
			<button
				type="button"
				aria-label="Previous page"
				disabled={!previous}
				onClick={() => onPageChange(Math.max(1, page - 1))}
				className="inline-flex h-9 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-neutral-700 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400"
			>
				<ChevronLeft size={14} aria-hidden />
				Previous
			</button>
			<span className="text-neutral-600 text-xs tabular-nums">
				Page {page}
				{pageCount > 1 ? ` of ${pageCount}` : ""}
			</span>
			<button
				type="button"
				aria-label="Next page"
				disabled={!next}
				onClick={() => onPageChange(page + 1)}
				className="inline-flex h-9 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-primary-700 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400"
			>
				Next
				<ChevronRight size={14} aria-hidden />
			</button>
		</nav>
	);
}

/** Grouped, paginated presentation for an already-authorized response. */
export default function MyWorkList({
	items,
	scope = "all",
	page,
	pageCount = 1,
	hasPrevious = page > 1,
	hasNext = page < pageCount,
	onPageChange,
	onSelect,
	onRefresh,
}: MyWorkListProps) {
	const groups = deriveMyWorkGroups(items, scope);
	const visibleGroups = GROUP_ORDER.filter((group) => groups[group].length > 0);
	const showPagination = hasPrevious || hasNext || pageCount > 1;

	return (
		<div className="mx-auto max-w-6xl px-4 pb-8 md:px-6">
			<div className="overflow-hidden rounded-md border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
				{visibleGroups.map((group) => (
					<GroupSection
						key={group}
						group={group}
						items={groups[group]}
						onSelect={onSelect}
						onRefresh={onRefresh}
					/>
				))}
			</div>
			{showPagination && (
				<PaginationControls
					page={page}
					pageCount={pageCount}
					hasPrevious={hasPrevious}
					hasNext={hasNext}
					onPageChange={onPageChange}
				/>
			)}
		</div>
	);
}
