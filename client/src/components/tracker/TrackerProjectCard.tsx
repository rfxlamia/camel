import { useNavigate } from "react-router";
import { formatDueDate } from "../../lib/boardViewUtils";
import { isProjectOverdue, rollup } from "../../lib/trackerRollup";
import type { TrackerItem, TrackerProject } from "../../types";
import TrackerProgressBar from "./TrackerProgressBar";

interface Props {
	project: TrackerProject;
	items: TrackerItem[];
}

function derivedDateRange(items: TrackerItem[]): string | null {
	const startDates = items
		.map((item) => item.startDate)
		.filter((d): d is string => d != null);
	const endDates = items
		.map((item) => item.endDate)
		.filter((d): d is string => d != null);

	const start =
		startDates.length > 0
			? startDates.reduce((min, d) => (d < min ? d : min))
			: null;
	const end =
		endDates.length > 0
			? endDates.reduce((max, d) => (d > max ? d : max))
			: null;

	if (start && end) return `${formatDueDate(start)} – ${formatDueDate(end)}`;
	if (start) return formatDueDate(start);
	if (end) return formatDueDate(end);
	return null;
}

export default function TrackerProjectCard({ project, items }: Props) {
	const navigate = useNavigate();
	const projectItems = items.filter((item) => item.projectId === project.id);
	const rollupResult = rollup(projectItems);
	const overdue = isProjectOverdue(project, items);
	const dateRange = derivedDateRange(projectItems);
	const taskLabel = `${projectItems.length} task${projectItems.length === 1 ? "" : "s"}`;

	return (
		<div className="relative rounded-lg border border-neutral-200 bg-white transition-colors hover:border-neutral-300 hover:bg-neutral-50">
			<button
				type="button"
				aria-label={project.name}
				onClick={() => navigate(`/tracker/p/${project.id}`)}
				className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
			/>
			<div className="pointer-events-none relative p-3">
			<div className="flex items-start justify-between gap-2">
				<h3 className="truncate font-medium text-neutral-900 text-sm">
					{project.name}
				</h3>
				{overdue && (
					<span
						aria-label="Overdue"
						className="shrink-0 rounded-md bg-[oklch(95%_0.025_25)] px-1.5 py-0.5 font-medium text-[oklch(35%_0.085_25)] text-xs"
					>
						Overdue
					</span>
				)}
			</div>
			<div className="mt-2">
				<TrackerProgressBar rollup={rollupResult} />
			</div>
			<div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-neutral-500 text-xs">
				<span>{taskLabel}</span>
				{dateRange && (
					<>
						<span aria-hidden>·</span>
						<span>{dateRange}</span>
					</>
				)}
			</div>
			</div>
		</div>
	);
}
