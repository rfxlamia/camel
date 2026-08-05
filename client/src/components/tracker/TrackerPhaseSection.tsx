import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { formatDueDate } from "../../lib/boardViewUtils";
import {
	isPhaseOverdue,
	isTaskOverdue,
	phaseBounds,
	rollup,
} from "../../lib/trackerRollup";
import type { TrackerItem, TrackerPhase, TrackerVocabulary } from "../../types";
import TrackerProgressBar from "./TrackerProgressBar";
import TrackerRow from "./TrackerRow";

interface Props {
	phase: TrackerPhase | null;
	label: string;
	items: TrackerItem[];
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	collapsed: boolean;
	onToggle: () => void;
	onStatusChange?: (item: TrackerItem, statusId: number) => void;
	onRename?: () => void;
	onDelete?: () => void;
	children?: ReactNode;
}

function formatDateRange(
	startDate: string | null,
	endDate: string | null,
): string | null {
	if (startDate && endDate) {
		return `${formatDueDate(startDate)} – ${formatDueDate(endDate)}`;
	}
	if (startDate) return formatDueDate(startDate);
	if (endDate) return formatDueDate(endDate);
	return null;
}

export default function TrackerPhaseSection({
	phase,
	label,
	items,
	statuses,
	priorities,
	collapsed,
	onToggle,
	onStatusChange,
	onRename,
	onDelete,
	children,
}: Props) {
	const rollupResult = rollup(items);
	const bounds = phase
		? phaseBounds(phase, items)
		: {
				startDate:
					items
						.map((item) => item.startDate)
						.filter((d): d is string => d != null)
						.reduce<string | null>(
							(min, d) => (min === null || d < min ? d : min),
							null,
						) ?? null,
				endDate:
					items
						.map((item) => item.endDate)
						.filter((d): d is string => d != null)
						.reduce<string | null>(
							(max, d) => (max === null || d > max ? d : max),
							null,
						) ?? null,
			};
	const dateRange = formatDateRange(bounds.startDate, bounds.endDate);
	const overdue = phase
		? isPhaseOverdue(phase, items)
		: items.some(isTaskOverdue);
	const subtitle = phase?.subtitle?.trim() ?? "";

	return (
		<section
			data-testid={`phase-${label}`}
			className="border-neutral-200 border-b last:border-b-0"
		>
			<div className="group/head flex min-h-9 items-center gap-2 bg-neutral-100/80 px-4 py-1.5 md:px-6">
				<button
					type="button"
					data-testid={`toggle-phase-${label}`}
					onClick={onToggle}
					className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					<ChevronRight
						size={13}
						className={`shrink-0 text-neutral-500 transition-transform duration-150 ${
							collapsed ? "" : "rotate-90"
						}`}
						aria-hidden
					/>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
							<span className="truncate font-medium text-neutral-800 text-sm">
								{label}
							</span>
							{overdue && (
								<span
									aria-label="Overdue"
									className="shrink-0 rounded-md bg-[oklch(95%_0.025_25)] px-1.5 py-0.5 font-medium text-[oklch(35%_0.085_25)] text-xs"
								>
									Overdue
								</span>
							)}
						</div>
						{subtitle && (
							<p className="truncate text-neutral-600 text-sm">{subtitle}</p>
						)}
					</div>
				</button>
				<div className="w-40 shrink-0">
					<TrackerProgressBar rollup={rollupResult} />
				</div>
				{dateRange && (
					<span className="shrink-0 text-neutral-500 text-xs">{dateRange}</span>
				)}
				{phase && onRename && (
					<button
						type="button"
						aria-label={`Rename phase ${label}`}
						onClick={onRename}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 opacity-0 transition hover:bg-neutral-200 hover:text-neutral-800 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 group-hover/head:opacity-100"
					>
						<Pencil size={13} aria-hidden />
					</button>
				)}
				{phase && onDelete && (
					<button
						type="button"
						aria-label={`Delete phase ${label}`}
						onClick={onDelete}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 opacity-0 transition hover:bg-neutral-200 hover:text-neutral-800 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 group-hover/head:opacity-100"
					>
						<Trash2 size={13} aria-hidden />
					</button>
				)}
			</div>
			{children}
			{!collapsed && items.length > 0 && (
				<div className="divide-y divide-neutral-200/70 bg-white">
					{items.map((item) => (
						<TrackerRow
							key={item.key}
							item={item}
							statuses={statuses}
							priorities={priorities}
							onStatusChange={(statusId) => onStatusChange?.(item, statusId)}
						/>
					))}
				</div>
			)}
		</section>
	);
}
