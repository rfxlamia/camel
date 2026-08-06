import type { TrackerItem, TrackerProject } from "../types";

export function itemMatchesSearch(item: TrackerItem, q: string): boolean {
	return (
		item.title.toLowerCase().includes(q) ||
		item.key.toLowerCase().includes(q) ||
		(item.description?.toLowerCase().includes(q) ?? false)
	);
}

export function projectMatchesSearch(
	project: TrackerProject,
	q: string,
): boolean {
	return project.name.toLowerCase().includes(q);
}

export function itemProjectTrail(
	item: TrackerItem,
	projects: TrackerProject[],
): string | null {
	const project = projects.find((p) => p.id === item.projectId);
	if (!project) return null;
	if (item.phaseId == null) return project.name;
	const phase = project.phases.find((p) => p.id === item.phaseId);
	return phase ? `${project.name} › ${phase.name}` : project.name;
}

export interface TrackerSearchPartition {
	searchActive: boolean;
	filteredUnassigned: TrackerItem[];
	filteredInProject: TrackerItem[];
	visibleProjects: TrackerProject[];
	noSearchResults: boolean;
	toolbarCount: number;
}

export function partitionTrackerSearch(
	items: TrackerItem[],
	projects: TrackerProject[],
	search: string,
): TrackerSearchPartition {
	const unassignedItems = items.filter((item) => item.projectId == null);
	const inProjectItems = items.filter((item) => item.projectId != null);
	const searchQuery = search.trim().toLowerCase();
	const searchActive = searchQuery.length > 0;

	const filteredUnassigned = searchActive
		? unassignedItems.filter((item) => itemMatchesSearch(item, searchQuery))
		: unassignedItems;

	const filteredInProject = searchActive
		? inProjectItems.filter((item) => itemMatchesSearch(item, searchQuery))
		: [];

	const visibleProjects = searchActive
		? projects.filter(
				(project) =>
					projectMatchesSearch(project, searchQuery) ||
					inProjectItems.some(
						(item) =>
							item.projectId === project.id &&
							itemMatchesSearch(item, searchQuery),
					),
			)
		: projects;

	const hasProjectNameMatch =
		searchActive &&
		projects.some((project) => projectMatchesSearch(project, searchQuery));

	const noSearchResults =
		searchActive &&
		filteredUnassigned.length === 0 &&
		filteredInProject.length === 0 &&
		!hasProjectNameMatch;

	const toolbarCount = searchActive
		? filteredUnassigned.length + filteredInProject.length
		: unassignedItems.length;

	return {
		searchActive,
		filteredUnassigned,
		filteredInProject,
		visibleProjects,
		noSearchResults,
		toolbarCount,
	};
}
