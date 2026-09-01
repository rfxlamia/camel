import type { TrackerProject, WorkItem } from "../types";

export function itemMatchesSearch(item: WorkItem, q: string): boolean {
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

export interface TrackerSearchPartition {
	searchActive: boolean;
	/**
	 * Every item matching the query, whether or not it belongs to a project.
	 * The Items tab renders one set: what the toolbar counts, what the group
	 * counts add up to, and what is on screen are the same items.
	 */
	filteredItems: WorkItem[];
	/** Projects matching by name, or holding an item that matches. */
	visibleProjects: TrackerProject[];
}

export function partitionTrackerSearch(
	items: WorkItem[],
	projects: TrackerProject[],
	search: string,
): TrackerSearchPartition {
	const searchQuery = search.trim().toLowerCase();
	const searchActive = searchQuery.length > 0;

	if (!searchActive) {
		return { searchActive, filteredItems: items, visibleProjects: projects };
	}

	const filteredItems = items.filter((item) =>
		itemMatchesSearch(item, searchQuery),
	);
	const visibleProjects = projects.filter(
		(project) =>
			projectMatchesSearch(project, searchQuery) ||
			filteredItems.some((item) => item.projectId === project.id),
	);

	return { searchActive, filteredItems, visibleProjects };
}
