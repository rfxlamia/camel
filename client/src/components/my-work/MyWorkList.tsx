import { ChevronLeft, ChevronRight } from "lucide-react";
import {
	deriveMyWorkGroups,
	type MyWorkStatusGroup,
} from "../../lib/myWorkStatus";
import type { MyWorkItem, MyWorkScope } from "../../types/myWork";
import MyWorkRow from "./MyWorkRow";

export interface MyWorkListProps {
	items: MyWorkItem[];
	scope?: MyWorkScope;
	page: number;
	pageCount?: number;
	hasPrevious?: boolean;
	hasNext?: boolean;
	onPageChange: (page: number) => void;
	onSelect?: (item: MyWorkItem) => void;
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
}: MyWorkListProps) {
	const groups = deriveMyWorkGroups(items, scope);
	const visibleGroups = GROUP_ORDER.filter((group) => groups[group].length > 0);

	return (
		<div className="mx-auto max-w-6xl px-4 pb-8 md:px-6">
			<div className="overflow-hidden rounded-md border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
				{visibleGroups.map((group) => (
					<section
						key={group}
						data-testid={`my-work-group-${group}`}
						aria-labelledby={`my-work-group-label-${group}`}
					>
						<div className="flex items-center gap-2 border-primary-200 border-b bg-neutral-100/80 px-4 py-2.5 md:px-5">
							<span
								className={`h-2 w-2 rounded-full ${
									group === "started"
										? "bg-warning-500"
										: group === "completed"
											? "bg-success-500"
											: group === "canceled"
												? "bg-error-500"
												: "bg-primary-400"
								}`}
								aria-hidden
							/>
							<h2
								id={`my-work-group-label-${group}`}
								className="font-semibold text-neutral-700 text-xs uppercase tracking-wide"
							>
								{GROUP_LABELS[group]}
							</h2>
							<span className="text-neutral-500 text-xs tabular-nums">
								{groups[group].length}
							</span>
						</div>
						<ul className="divide-y divide-neutral-200/80">
							{groups[group].map((item) => (
								<MyWorkRow
									key={`${item.workspaceId}:${item.source}:${item.key}`}
									item={item}
									onSelect={onSelect}
								/>
							))}
						</ul>
					</section>
				))}
			</div>

			{(hasPrevious || hasNext || pageCount > 1) && (
				<nav
					className="mt-4 flex items-center justify-between gap-3"
					aria-label="My Work pages"
				>
					<button
						type="button"
						aria-label="Previous page"
						disabled={!hasPrevious}
						onClick={() => onPageChange(Math.max(1, page - 1))}
						className="inline-flex h-9 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-neutral-700 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400"
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
						disabled={!hasNext}
						onClick={() => onPageChange(page + 1)}
						className="inline-flex h-9 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-primary-700 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400"
					>
						Next
						<ChevronRight size={14} aria-hidden />
					</button>
				</nav>
			)}
		</div>
	);
}
