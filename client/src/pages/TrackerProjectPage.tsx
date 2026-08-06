import { arrayMove } from "@dnd-kit/sortable";
import { ArrowLeft, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError, api } from "../api";
import TrackerConfirmDialog from "../components/tracker/TrackerConfirmDialog";
import TrackerPhaseEditor, {
	type PhaseEditorValues,
} from "../components/tracker/TrackerPhaseEditor";
import TrackerPhaseSection from "../components/tracker/TrackerPhaseSection";
import TrackerProjectHeader from "../components/tracker/TrackerProjectHeader";
import { useBoard } from "../context/BoardContext";
import { positionBetween } from "../lib/position";
import { sortStatusesByPosition } from "../lib/trackerUtils";
import type {
	TrackerItem,
	TrackerPhase,
	TrackerProject,
	TrackerVocabulary,
} from "../types";

const NO_PHASE_KEY = "no-phase";

const RELOAD_EVENTS = new Set([
	"tracker.project.created",
	"tracker.project.updated",
	"tracker.project.deleted",
	"tracker.phase.created",
	"tracker.phase.updated",
	"tracker.phase.deleted",
	"tracker.created",
	"tracker.updated",
	"tracker.deleted",
]);

function collapseStorageKey(projectId: number): string {
	return `tracker:phase-collapse:${projectId}`;
}

function readCollapsedPhases(projectId: number): Set<string> {
	try {
		const raw = sessionStorage.getItem(collapseStorageKey(projectId));
		if (!raw) return new Set();
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((v): v is string => typeof v === "string"));
	} catch {
		return new Set();
	}
}

function writeCollapsedPhases(projectId: number, collapsed: Set<string>): void {
	sessionStorage.setItem(
		collapseStorageKey(projectId),
		JSON.stringify([...collapsed]),
	);
}

function releasedTaskMessage(count: number): string {
	const noun = count === 1 ? "task" : "tasks";
	return `${count} ${noun} will be released to the unassigned list`;
}

function sortByPosition(items: TrackerItem[]): TrackerItem[] {
	return [...items].sort(
		(a, b) =>
			(a.position ?? Number.POSITIVE_INFINITY) -
				(b.position ?? Number.POSITIVE_INFINITY) || a.id - b.id,
	);
}

function reorderNeighborBody(
	reordered: TrackerItem[],
	newIndex: number,
): { beforeId?: number; afterId?: number } | null {
	if (reordered.length < 2) return null;
	if (newIndex === 0) {
		return { afterId: reordered[1].id };
	}
	return { beforeId: reordered[newIndex - 1].id };
}

function optimisticReorderPosition(
	reordered: TrackerItem[],
	newIndex: number,
): number {
	const beforePos =
		newIndex > 0 ? (reordered[newIndex - 1].position ?? null) : null;
	const afterPos =
		newIndex < reordered.length - 1
			? (reordered[newIndex + 1].position ?? null)
			: null;
	return positionBetween(beforePos, afterPos);
}

export default function TrackerProjectPage() {
	const { projectId: projectIdParam } = useParams<{ projectId: string }>();
	const navigate = useNavigate();
	const { activeWorkspaceId, subscribeTrackerEvents, showToast } = useBoard();
	const [projects, setProjects] = useState<TrackerProject[]>([]);
	const [items, setItems] = useState<TrackerItem[]>([]);
	const [statuses, setStatuses] = useState<TrackerVocabulary[]>([]);
	const [priorities, setPriorities] = useState<TrackerVocabulary[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	const [loadSucceeded, setLoadSucceeded] = useState(false);
	const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
	const [renamingProject, setRenamingProject] = useState(false);
	const [projectNameDraft, setProjectNameDraft] = useState("");
	const [projectMenuOpen, setProjectMenuOpen] = useState(false);
	const [projectDeleteOpen, setProjectDeleteOpen] = useState(false);
	const [phaseCreateOpen, setPhaseCreateOpen] = useState(false);
	const [editingPhaseId, setEditingPhaseId] = useState<number | null>(null);
	const [deletingPhaseId, setDeletingPhaseId] = useState<number | null>(null);
	const [phaseEditorError, setPhaseEditorError] = useState<string | null>(null);
	const [phaseEditorSubmitting, setPhaseEditorSubmitting] = useState(false);
	const reorderSeqRef = useRef(0);

	const projectId = Number(projectIdParam);
	const projectIdValid = Number.isInteger(projectId) && projectId > 0;

	useEffect(() => {
		if (!projectIdValid) return;
		setCollapsedKeys(readCollapsedPhases(projectId));
	}, [projectId, projectIdValid]);

	const loadData = useCallback(async () => {
		if (activeWorkspaceId === null) return;
		setLoading(true);
		setLoadError(false);
		try {
			const [projectList, itemList, statusList, priorityList] =
				await Promise.all([
					api.listTrackerProjects(activeWorkspaceId),
					api.listTrackerItems(activeWorkspaceId),
					api.listTrackerVocabularies(activeWorkspaceId, "status"),
					api.listTrackerVocabularies(activeWorkspaceId, "priority"),
				]);
			setProjects(projectList);
			setItems(itemList);
			setStatuses(sortStatusesByPosition(statusList));
			setPriorities(priorityList);
			setLoadSucceeded(true);
		} catch {
			setLoadError(true);
			setLoadSucceeded(false);
			showToast(
				"Couldn't load the tracker. Check your connection and try again.",
				"error",
			);
		} finally {
			setLoading(false);
		}
	}, [activeWorkspaceId, showToast]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	useEffect(() => {
		if (!subscribeTrackerEvents) return;
		return subscribeTrackerEvents((event) => {
			if (RELOAD_EVENTS.has(event.type)) {
				void loadData();
			}
		});
	}, [subscribeTrackerEvents, loadData]);

	const project = useMemo(
		() =>
			projectIdValid
				? projects.find((candidate) => candidate.id === projectId)
				: undefined,
		[projects, projectId, projectIdValid],
	);

	const projectItems = useMemo(
		() =>
			project ? items.filter((item) => item.projectId === project.id) : [],
		[items, project],
	);

	const itemsByPhase = useMemo(() => {
		const map = new Map<number | null, TrackerItem[]>();
		for (const item of projectItems) {
			const key = item.phaseId ?? null;
			const bucket = map.get(key) ?? [];
			bucket.push(item);
			map.set(key, bucket);
		}
		for (const [key, bucket] of map) {
			map.set(key, sortByPosition(bucket));
		}
		return map;
	}, [projectItems]);

	const togglePhase = (key: string) => {
		if (!projectIdValid) return;
		const next = new Set(collapsedKeys);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		writeCollapsedPhases(projectId, next);
		setCollapsedKeys(next);
	};

	const updateProjectInState = (updated: TrackerProject) => {
		setProjects((prev) =>
			prev.map((candidate) =>
				candidate.id === updated.id ? updated : candidate,
			),
		);
	};

	const updatePhaseInState = (updated: TrackerPhase) => {
		setProjects((prev) =>
			prev.map((candidate) => {
				if (candidate.id !== updated.projectId) return candidate;
				return {
					...candidate,
					phases: candidate.phases.map((phase) =>
						phase.id === updated.id ? updated : phase,
					),
				};
			}),
		);
	};

	const appendPhaseInState = (created: TrackerPhase) => {
		setProjects((prev) =>
			prev.map((candidate) => {
				if (candidate.id !== created.projectId) return candidate;
				const phases = [...candidate.phases, created].sort(
					(a, b) => a.position - b.position,
				);
				return { ...candidate, phases };
			}),
		);
	};

	const startRenameProject = () => {
		if (!project) return;
		setProjectNameDraft(project.name);
		setRenamingProject(true);
		setProjectMenuOpen(false);
	};

	const saveProjectRename = async () => {
		if (activeWorkspaceId === null || !project || !projectNameDraft.trim())
			return;
		try {
			const updated = await api.updateTrackerProject(
				activeWorkspaceId,
				project.id,
				{ name: projectNameDraft.trim(), version: project.version },
			);
			updateProjectInState(updated);
			setRenamingProject(false);
		} catch (err) {
			if (err instanceof ApiError && err.code === "version_conflict") {
				showToast(
					"Someone else updated this project first — refreshed.",
					"warning",
				);
				await loadData();
				setRenamingProject(false);
			} else {
				showToast(
					"Couldn't rename the project. Check your connection and try again.",
					"error",
				);
			}
		}
	};

	const confirmDeleteProject = async () => {
		if (activeWorkspaceId === null || !project) return;
		try {
			await api.deleteTrackerProject(activeWorkspaceId, project.id);
			navigate("/tracker");
		} catch {
			showToast(
				"Couldn't delete the project. Check your connection and try again.",
				"error",
			);
		}
	};

	const openPhaseCreate = () => {
		setEditingPhaseId(null);
		setPhaseEditorError(null);
		setPhaseCreateOpen(true);
	};

	const closePhaseEditor = () => {
		setPhaseCreateOpen(false);
		setEditingPhaseId(null);
		setPhaseEditorError(null);
	};

	const submitPhaseCreate = async (values: PhaseEditorValues) => {
		if (activeWorkspaceId === null || !project) return;
		setPhaseEditorSubmitting(true);
		setPhaseEditorError(null);
		try {
			const body: {
				name: string;
				subtitle?: string;
				startDate?: string;
				endDate?: string;
			} = { name: values.name };
			if (values.subtitle) body.subtitle = values.subtitle;
			if (values.startDate) body.startDate = values.startDate;
			if (values.endDate) body.endDate = values.endDate;
			const created = await api.createTrackerPhase(
				activeWorkspaceId,
				project.id,
				body,
			);
			appendPhaseInState(created);
			closePhaseEditor();
		} catch (err) {
			if (
				err instanceof ApiError &&
				(err.status === 400 || err.status === 409)
			) {
				setPhaseEditorError(err.message);
			} else {
				setPhaseEditorError("Could not create the phase. Try again.");
			}
		} finally {
			setPhaseEditorSubmitting(false);
		}
	};

	const submitPhaseUpdate = async (
		phase: TrackerPhase,
		values: PhaseEditorValues,
	) => {
		if (activeWorkspaceId === null) return;
		setPhaseEditorSubmitting(true);
		setPhaseEditorError(null);
		try {
			const patch: {
				name: string;
				version: number;
				startDate?: string | null;
				endDate?: string | null;
			} = { name: values.name, version: phase.version };
			const hadStart = phase.startDate != null;
			const hadEnd = phase.endDate != null;
			const hasStart = values.startDate !== "";
			const hasEnd = values.endDate !== "";
			if (hasStart || hasEnd || hadStart || hadEnd) {
				patch.startDate = values.startDate || null;
				patch.endDate = values.endDate || null;
			}
			const updated = await api.updateTrackerPhase(
				activeWorkspaceId,
				phase.id,
				patch,
			);
			if (updated) {
				updatePhaseInState(updated);
			}
			closePhaseEditor();
		} catch (err) {
			if (err instanceof ApiError && err.code === "version_conflict") {
				showToast(
					"Someone else updated this phase first — refreshed.",
					"warning",
				);
				await loadData();
				closePhaseEditor();
			} else if (err instanceof ApiError && err.status === 400) {
				setPhaseEditorError(err.message);
			} else {
				setPhaseEditorError("Could not save the phase. Try again.");
			}
		} finally {
			setPhaseEditorSubmitting(false);
		}
	};

	const confirmDeletePhase = async () => {
		if (activeWorkspaceId === null || deletingPhaseId === null) return;
		try {
			await api.deleteTrackerPhase(activeWorkspaceId, deletingPhaseId);
			setDeletingPhaseId(null);
			await loadData();
		} catch {
			showToast(
				"Couldn't delete the phase. Check your connection and try again.",
				"error",
			);
		}
	};

	const reorderPhaseItems = async (
		phaseId: number | null,
		oldIndex: number,
		newIndex: number,
		itemKey: string,
	) => {
		if (activeWorkspaceId === null) return;
		const phaseItems = sortByPosition(
			projectItems.filter((item) => (item.phaseId ?? null) === phaseId),
		);
		if (oldIndex === newIndex) return;

		const neighbors = reorderNeighborBody(
			arrayMove(phaseItems, oldIndex, newIndex),
			newIndex,
		);
		if (!neighbors) return;

		const seq = ++reorderSeqRef.current;
		const snapshot = items;
		const reordered = arrayMove(phaseItems, oldIndex, newIndex);
		const movedId = reordered[newIndex].id;
		const optimisticPosition = optimisticReorderPosition(reordered, newIndex);

		setItems((prev) =>
			prev.map((item) =>
				item.id === movedId ? { ...item, position: optimisticPosition } : item,
			),
		);

		try {
			const updated = await api.reorderTrackerItem(
				activeWorkspaceId,
				itemKey,
				neighbors,
			);
			if (seq === reorderSeqRef.current) {
				setItems((prev) =>
					prev.map((item) => (item.id === updated.id ? updated : item)),
				);
			}
		} catch {
			if (seq === reorderSeqRef.current) {
				setItems(snapshot);
				showToast(
					"Couldn't reorder the task. Check your connection and try again.",
					"error",
				);
			}
		}
	};

	if (activeWorkspaceId === null) return null;

	if (!projectIdValid) {
		return (
			<div className="min-h-full bg-white px-4 py-16 text-center md:px-6">
				<p className="text-neutral-600 text-sm">Project not found.</p>
				<button
					type="button"
					onClick={() => navigate("/tracker")}
					className="mt-4 inline-flex items-center gap-1.5 text-primary-600 text-sm hover:text-primary-700"
				>
					<ArrowLeft size={14} aria-hidden />
					Back to Tracker
				</button>
			</div>
		);
	}

	if (loadError) {
		return (
			<div className="min-h-full bg-white px-4 py-16 text-center md:px-6">
				<p className="text-neutral-600 text-sm">
					Couldn&apos;t load the tracker. Check your connection and try again.
				</p>
				<button
					type="button"
					onClick={() => void loadData()}
					className="mt-4 inline-flex items-center gap-1.5 text-primary-600 text-sm hover:text-primary-700"
				>
					Retry
				</button>
			</div>
		);
	}

	if (loading && !loadSucceeded) {
		return (
			<p className="px-4 py-8 text-center text-neutral-500 text-sm md:px-6">
				Loading…
			</p>
		);
	}

	if (loadSucceeded && !project) {
		return (
			<div className="min-h-full bg-white px-4 py-16 text-center md:px-6">
				<p className="text-neutral-600 text-sm">Project not found.</p>
				<button
					type="button"
					onClick={() => navigate("/tracker")}
					className="mt-4 inline-flex items-center gap-1.5 text-primary-600 text-sm hover:text-primary-700"
				>
					<ArrowLeft size={14} aria-hidden />
					Back to Tracker
				</button>
			</div>
		);
	}

	if (!project) return null;

	const noPhaseItems = itemsByPhase.get(null) ?? [];
	const showNoPhase = noPhaseItems.length > 0;
	const isEmpty = project.phases.length === 0 && projectItems.length === 0;
	const deletingPhase = deletingPhaseId
		? project.phases.find((phase) => phase.id === deletingPhaseId)
		: undefined;

	return (
		<div className="min-h-full bg-white">
			<TrackerProjectHeader
				projectName={project.name}
				renaming={renamingProject}
				nameDraft={projectNameDraft}
				menuOpen={projectMenuOpen}
				onBack={() => navigate("/tracker")}
				onStartRename={startRenameProject}
				onCancelRename={() => setRenamingProject(false)}
				onSaveRename={saveProjectRename}
				onNameDraftChange={setProjectNameDraft}
				onMenuOpenChange={setProjectMenuOpen}
				onOpenDelete={() => setProjectDeleteOpen(true)}
			/>

			{isEmpty ? (
				<div className="px-4 py-16 text-center md:px-6">
					{phaseCreateOpen ? (
						<div className="mx-auto max-w-md text-left">
							<TrackerPhaseEditor
								mode="create"
								onSubmit={submitPhaseCreate}
								onCancel={closePhaseEditor}
								submitting={phaseEditorSubmitting}
								error={phaseEditorError}
							/>
						</div>
					) : (
						<>
							<p className="text-neutral-600 text-sm">
								Nothing here yet — add your first phase.
							</p>
							<button
								type="button"
								aria-label="Create first phase"
								onClick={openPhaseCreate}
								className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary-600 px-3 font-medium text-sm text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								<Plus size={15} aria-hidden />
								Create phase
							</button>
						</>
					)}
				</div>
			) : (
				<div>
					{project.phases.map((phase) => {
						const phaseItems = itemsByPhase.get(phase.id) ?? [];
						const phaseKey = String(phase.id);
						const isEditing = editingPhaseId === phase.id;
						return (
							<TrackerPhaseSection
								key={phase.id}
								phase={phase}
								label={phase.name}
								items={phaseItems}
								statuses={statuses}
								priorities={priorities}
								collapsed={collapsedKeys.has(phaseKey)}
								onToggle={() => togglePhase(phaseKey)}
								onReorder={(oldIndex, newIndex, itemKey) =>
									void reorderPhaseItems(phase.id, oldIndex, newIndex, itemKey)
								}
								onRename={() => {
									setPhaseCreateOpen(false);
									setPhaseEditorError(null);
									setEditingPhaseId(phase.id);
								}}
								onDelete={() => setDeletingPhaseId(phase.id)}
							>
								{isEditing && (
									<TrackerPhaseEditor
										mode="edit"
										idPrefix={`phase-${phase.id}`}
										initialName={phase.name}
										initialSubtitle={phase.subtitle ?? ""}
										initialStartDate={phase.startDate ?? ""}
										initialEndDate={phase.endDate ?? ""}
										onSubmit={(values) => void submitPhaseUpdate(phase, values)}
										onCancel={closePhaseEditor}
										submitting={phaseEditorSubmitting}
										error={phaseEditorError}
									/>
								)}
							</TrackerPhaseSection>
						);
					})}
					{showNoPhase && (
						<TrackerPhaseSection
							phase={null}
							label="No phase"
							items={noPhaseItems}
							statuses={statuses}
							priorities={priorities}
							collapsed={collapsedKeys.has(NO_PHASE_KEY)}
							onToggle={() => togglePhase(NO_PHASE_KEY)}
							onReorder={(oldIndex, newIndex, itemKey) =>
								void reorderPhaseItems(null, oldIndex, newIndex, itemKey)
							}
						/>
					)}
					{phaseCreateOpen ? (
						<TrackerPhaseEditor
							mode="create"
							onSubmit={submitPhaseCreate}
							onCancel={closePhaseEditor}
							submitting={phaseEditorSubmitting}
							error={phaseEditorError}
						/>
					) : (
						<div className="px-4 py-3 md:px-6">
							<button
								type="button"
								aria-label="Add phase"
								onClick={openPhaseCreate}
								className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 text-neutral-700 text-sm transition hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								<Plus size={15} aria-hidden />
								Add phase
							</button>
						</div>
					)}
				</div>
			)}

			{projectDeleteOpen && (
				<TrackerConfirmDialog
					ariaLabel="Confirm delete project"
					title="Delete this project?"
					description={releasedTaskMessage(projectItems.length)}
					onCancel={() => setProjectDeleteOpen(false)}
					onConfirm={confirmDeleteProject}
				/>
			)}

			{deletingPhaseId !== null && (
				<TrackerConfirmDialog
					ariaLabel="Confirm delete phase"
					title={`Delete phase “${deletingPhase?.name ?? ""}”?`}
					description="Tasks in this phase will move to No phase."
					onCancel={() => setDeletingPhaseId(null)}
					onConfirm={confirmDeletePhase}
				/>
			)}
		</div>
	);
}
