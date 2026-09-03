import type { DBExecutor } from "../db/kysely.js";

export type TaskCreateLockReferences = {
	actorId?: number;
	userIds?: number[];
	memberIds?: number[];
	assigneeIds?: number[];
	vocabularyIds?: number[];
	statusId?: number | null;
	priorityId?: number | null;
	labelIds?: number[];
	projectIds?: number[];
	projectId?: number | null;
	phaseIds?: number[];
	phaseId?: number | null;
	destinationColumnId?: number | null;
	columnId?: number | null;
};

export type TaskCreateLockSequence = {
	workspaceId: number;
	userIds: number[];
	vocabularyIds: number[];
	projectIds: number[];
	phaseIds: number[];
	destinationColumnId: number | null;
};

function sortedUnique(ids: number[]): number[] {
	return [...new Set(ids)].sort((a, b) => a - b);
}

/** Build the stable category-and-ID order used by task creation locks. */
export function buildTaskCreateLockSequence(
	workspaceId: number,
	references: TaskCreateLockReferences = {},
): TaskCreateLockSequence {
	const userIds = sortedUnique([
		...(references.actorId == null ? [] : [references.actorId]),
		...(references.userIds ?? []),
		...(references.memberIds ?? []),
		...(references.assigneeIds ?? []),
	]);
	const vocabularyIds = sortedUnique([
		...(references.vocabularyIds ?? []),
		...(references.statusId == null ? [] : [references.statusId]),
		...(references.priorityId == null ? [] : [references.priorityId]),
		...(references.labelIds ?? []),
	]);
	const projectIds = sortedUnique([
		...(references.projectIds ?? []),
		...(references.projectId == null ? [] : [references.projectId]),
	]);
	const phaseIds = sortedUnique([
		...(references.phaseIds ?? []),
		...(references.phaseId == null ? [] : [references.phaseId]),
	]);
	const destinationColumnId =
		references.destinationColumnId ?? references.columnId ?? null;

	return {
		workspaceId,
		userIds,
		vocabularyIds,
		projectIds,
		phaseIds,
		destinationColumnId,
	};
}

export async function lockWorkspaceMutation(
	dbExec: DBExecutor,
	workspaceId: number,
): Promise<{ id: number } | undefined> {
	return dbExec
		.selectFrom("workspaces")
		.select("id")
		.where("id", "=", workspaceId)
		.forUpdate()
		.executeTakeFirst();
}

async function lockMembers(
	dbExec: DBExecutor,
	workspaceId: number,
	userIds: number[],
): Promise<void> {
	if (userIds.length === 0) return;
	await dbExec
		.selectFrom("workspace_members")
		.select("user_id")
		.where("workspace_id", "=", workspaceId)
		.where("user_id", "in", userIds)
		.orderBy("user_id")
		.forUpdate()
		.execute();
}

async function lockVocabularies(
	dbExec: DBExecutor,
	workspaceId: number,
	vocabularyIds: number[],
): Promise<void> {
	if (vocabularyIds.length === 0) return;
	await dbExec
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("workspace_id", "=", workspaceId)
		.where("id", "in", vocabularyIds)
		.orderBy("id")
		.forUpdate()
		.execute();
}

async function lockProjects(
	dbExec: DBExecutor,
	workspaceId: number,
	projectIds: number[],
): Promise<void> {
	if (projectIds.length === 0) return;
	await dbExec
		.selectFrom("tracker_projects")
		.select("id")
		.where("workspace_id", "=", workspaceId)
		.where("id", "in", projectIds)
		.where("deleted_at", "is", null)
		.orderBy("id")
		.forUpdate()
		.execute();
}

async function lockPhases(
	dbExec: DBExecutor,
	workspaceId: number,
	phaseIds: number[],
): Promise<void> {
	if (phaseIds.length === 0) return;
	await dbExec
		.selectFrom("tracker_phases as tp")
		.innerJoin("tracker_projects as tpr", "tpr.id", "tp.project_id")
		.select("tp.id as id")
		.where("tp.id", "in", phaseIds)
		.where("tp.deleted_at", "is", null)
		.where("tpr.workspace_id", "=", workspaceId)
		.where("tpr.deleted_at", "is", null)
		.orderBy("tp.id")
		.forUpdate()
		.execute();
}

async function lockDestinationColumn(
	dbExec: DBExecutor,
	workspaceId: number,
	destinationColumnId: number | null,
): Promise<void> {
	if (destinationColumnId === null) return;
	await dbExec
		.selectFrom("columns")
		.select("id")
		.where("workspace_id", "=", workspaceId)
		.where("id", "=", destinationColumnId)
		.forUpdate()
		.executeTakeFirst();
}

export async function lockTaskCreateReferences(
	dbExec: DBExecutor,
	workspaceId: number,
	references: TaskCreateLockReferences = {},
): Promise<TaskCreateLockSequence> {
	const sequence = buildTaskCreateLockSequence(workspaceId, references);
	await lockWorkspaceMutation(dbExec, workspaceId);
	await lockMembers(dbExec, workspaceId, sequence.userIds);
	await lockVocabularies(dbExec, workspaceId, sequence.vocabularyIds);
	await lockProjects(dbExec, workspaceId, sequence.projectIds);
	await lockPhases(dbExec, workspaceId, sequence.phaseIds);
	await lockDestinationColumn(
		dbExec,
		workspaceId,
		sequence.destinationColumnId,
	);
	return sequence;
}
