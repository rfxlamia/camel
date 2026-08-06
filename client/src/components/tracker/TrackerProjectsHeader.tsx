import { ChevronRight, FolderKanban, Plus } from "lucide-react";
import type { TrackerItem, TrackerProject } from "../../types";
import TrackerProjectCard from "./TrackerProjectCard";

interface Props {
	projects: TrackerProject[];
	visibleProjects: TrackerProject[];
	items: TrackerItem[];
	collapsed: boolean;
	onToggleCollapsed: () => void;
	atProjectCap: boolean;
	capMessage: string;
	onNewProject: () => void;
}

export default function TrackerProjectsHeader({
	projects,
	visibleProjects,
	items,
	collapsed,
	onToggleCollapsed,
	atProjectCap,
	capMessage,
	onNewProject,
}: Props) {
	return (
		<section className="border-neutral-200 border-b">
			<div className="group/head flex h-9 items-center gap-2 bg-neutral-100/80 px-4 md:px-6">
				<button
					type="button"
					data-testid="toggle-projects"
					onClick={onToggleCollapsed}
					className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					<ChevronRight
						size={13}
						className={`shrink-0 text-neutral-500 transition-transform duration-150 ${
							collapsed ? "" : "rotate-90"
						}`}
						aria-hidden
					/>
					<FolderKanban
						size={13}
						className="shrink-0 text-neutral-500"
						aria-hidden
					/>
					<span className="truncate font-medium text-neutral-800 text-sm">
						Projects
					</span>
					<span className="text-neutral-500 text-xs tabular-nums">
						{projects.length}
					</span>
				</button>
				<button
					type="button"
					aria-label="New project"
					disabled={atProjectCap}
					title={atProjectCap ? capMessage : undefined}
					onClick={onNewProject}
					className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 font-medium text-neutral-600 text-xs transition hover:bg-neutral-200 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Plus size={13} aria-hidden />
					New project
				</button>
			</div>
			{atProjectCap && (
				<p className="border-neutral-200 border-b bg-neutral-50 px-4 py-1.5 text-neutral-600 text-xs md:px-6">
					{capMessage}
				</p>
			)}
			{!collapsed && visibleProjects.length > 0 && (
				<div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3 md:px-6">
					{visibleProjects.map((project) => (
						<TrackerProjectCard
							key={project.id}
							project={project}
							items={items}
						/>
					))}
				</div>
			)}
		</section>
	);
}
