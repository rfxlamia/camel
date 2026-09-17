import { FolderKanban, Plus } from "lucide-react";
import type { TrackerItem, TrackerProject } from "../../types";
import TrackerProjectCard from "./TrackerProjectCard";

interface Props {
	visibleProjects: TrackerProject[];
	items: TrackerItem[];
	searchActive: boolean;
	search: string;
	onNewProject: () => void;
}

export default function TrackerProjectsTab({
	visibleProjects,
	items,
	searchActive,
	search,
	onNewProject,
}: Props) {
	if (visibleProjects.length === 0) {
		return searchActive ? (
			<p className="px-4 py-16 text-center text-neutral-600 text-sm md:px-6">
				No projects match “{search.trim()}”.
			</p>
		) : (
			<div className="flex flex-col items-center px-4 py-16 text-center md:px-6">
				<FolderKanban size={20} className="text-neutral-400" aria-hidden />
				<p className="mt-3 font-medium text-neutral-900 text-sm">
					No projects yet
				</p>
				<p className="mt-1 max-w-sm text-neutral-600 text-sm">
					A project groups related items into phases so you can track progress
					on the whole thing, not one task at a time.
				</p>
				<button
					type="button"
					onClick={onNewProject}
					className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary-600 pr-3 pl-2.5 font-medium text-sm text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					<Plus size={15} aria-hidden />
					Create your first project
				</button>
			</div>
		);
	}

	return (
		<div>
			<div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3 md:px-6">
				{visibleProjects.map((project) => (
					<TrackerProjectCard
						key={project.id}
						project={project}
						items={items}
					/>
				))}
			</div>
		</div>
	);
}
