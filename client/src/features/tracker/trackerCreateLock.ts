import type { TrackerFieldLockContext } from "../../shared/taskFieldDefinitions";
import type { TaskMetadataProject } from "../../shared/taskMetadataDraft";
import { sortStatusesByPosition } from "../../shared/trackerUtils";
import type { TrackerProject, TrackerVocabulary } from "../../types";

export function toMetadataProjects(
	projects: TrackerProject[],
): TaskMetadataProject[] {
	return projects.map((project) => ({
		id: project.id,
		phases: project.phases.map((phase) => ({
			id: phase.id,
			projectId: project.id,
		})),
	}));
}

export function resolveInitialStatusId(
	statuses: TrackerVocabulary[],
	defaultStatusId?: number,
): number | null {
	if (defaultStatusId !== undefined) return defaultStatusId;
	const ordered = sortStatusesByPosition(statuses);
	if (ordered.length === 0) return null;
	const backlog = ordered.find((s) => s.name.toLowerCase() === "backlog");
	return (backlog ?? ordered[0]).id;
}

export function isValidLockContext(
	lock: TrackerFieldLockContext | undefined,
): boolean {
	if (!lock?.lockedProjectId) return false;
	const projects = lock.projects ?? [];
	const project = projects.find(
		(candidate) => candidate.id === lock.lockedProjectId,
	);
	if (!project) return false;
	if (lock.lockedPhaseId == null) return true;
	return project.phases.some((phase) => phase.id === lock.lockedPhaseId);
}
