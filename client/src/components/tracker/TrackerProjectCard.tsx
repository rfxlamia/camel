import { useNavigate } from "react-router";
import { formatDueDate } from "../../lib/boardViewUtils";
import {
	deriveBounds,
	isProjectOverdue,
	rollup,
} from "../../lib/trackerRollup";
import type { TrackerItem, TrackerProject } from "../../types";
import TrackerProgressBar from "./TrackerProgressBar";

interface Props {
	project: TrackerProject;
	items: TrackerItem[];
}

function formatDateRange(items: TrackerItem[]): string | null {
	const { startDate, endDate } = deriveBounds(items);
	if (startDate && endDate) {
		return `${formatDueDate(startDate)} – ${formatDueDate(endDate)}`;
	}
	if (startDate) return formatDueDate(startDate);
	if (endDate) return formatDueDate(endDate);
	return null;
}

export default function TrackerProjectCard({ project, items }: Props) {
	const navigate = useNavigate();
	const projectItems = items.filter((item) => item.projectId === project.id);
	const rollupResult = rollup(projectItems);
	const overdue = isProjectOverdue(project, items);
	const dateRange = formatDateRange(projectItems);
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
							className="shrink-0 rounded-md bg-error-100 px-1.5 py-0.5 font-medium text-error-900 text-xs"
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
