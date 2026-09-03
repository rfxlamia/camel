import { ListTodo, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, api } from "../../api";
import type { TaskCreateFieldErrors } from "../../lib/taskCreateContracts";
import { sortStatusesByPosition } from "../../lib/trackerUtils";
import type {
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import {
	getTrackerTaskFieldDefinitions,
	type TrackerFieldLockContext,
} from "../task-entry/taskFieldDefinitions";
import type { TaskMetadataCatalogs } from "../task-entry/TaskMetadataCatalogProvider";
import {
	TaskTitleEditor,
	type TaskTitleEditorHandle,
} from "../task-entry/TaskTitleEditor";
import {
	createInitialTaskMetadataDraft,
	selectTaskMetadataPayload,
	taskMetadataReducer,
	type TaskMetadataProject,
} from "../task-entry/taskMetadataDraft";
import {
	TrackerCreateMetadataFields,
	type TrackerCreatePickerName,
} from "./TrackerCreateMetadataFields";

interface Props {
	workspaceId: number;
	onClose: () => void;
	onCreated: () => void;
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	/** Preselected status — set when opening from a status group's + button. */
	defaultStatusId?: number;
	/** Locked project — set when opening from a project WBS page. */
	defaultProjectId?: number;
	/** Locked phase — omit for project-only; pass null for the No phase bucket. */
	defaultPhaseId?: number | null;
}

function toMetadataProjects(projects: TrackerProject[]): TaskMetadataProject[] {
	return projects.map((project) => ({
		id: project.id,
		phases: project.phases.map((phase) => ({
			id: phase.id,
			projectId: project.id,
		})),
	}));
}

function resolveInitialStatusId(
	statuses: TrackerVocabulary[],
	defaultStatusId?: number,
): number | null {
	if (defaultStatusId !== undefined) return defaultStatusId;
	const ordered = sortStatusesByPosition(statuses);
	if (ordered.length === 0) return null;
	const backlog = ordered.find((s) => s.name.toLowerCase() === "backlog");
	return (backlog ?? ordered[0]).id;
}

function isValidLockContext(lock: TrackerFieldLockContext | undefined): boolean {
	if (!lock?.lockedProjectId) return false;
	const projects = lock.projects ?? [];
	const project = projects.find((candidate) => candidate.id === lock.lockedProjectId);
	if (!project) return false;
	if (lock.lockedPhaseId == null) return true;
	return project.phases.some((phase) => phase.id === lock.lockedPhaseId);
}

export default function TrackerCreateModal({
	workspaceId,
	onClose,
	onCreated,
	statuses,
	priorities,
	defaultStatusId,
	defaultProjectId,
	defaultPhaseId,
}: Props) {
	const [description, setDescription] = useState("");
	const [labels, setLabels] = useState<TrackerVocabulary[]>([]);
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	const [projects, setProjects] = useState<TrackerProject[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<TaskCreateFieldErrors>({});
	const [createMore, setCreateMore] = useState(false);
	const [openPicker, setOpenPicker] = useState<TrackerCreatePickerName | null>(null);
	const [lockReleased, setLockReleased] = useState(false);
	const [titleEditorKey, setTitleEditorKey] = useState(0);
	const [titleValid, setTitleValid] = useState(false);
	const titleEditorRef = useRef<TaskTitleEditorHandle>(null);

	const orderedStatuses = useMemo(
		() => sortStatusesByPosition(statuses),
		[statuses],
	);

	const metadataProjects = useMemo(
		() => toMetadataProjects(projects),
		[projects],
	);

	const lockContext = useMemo((): TrackerFieldLockContext | undefined => {
		if (lockReleased || defaultProjectId === undefined) return undefined;
		return {
			lockedProjectId: defaultProjectId,
			lockedPhaseId: defaultPhaseId,
			projects: metadataProjects,
		};
	}, [defaultPhaseId, defaultProjectId, lockReleased, metadataProjects]);

	const hideProjectPickers =
		defaultProjectId !== undefined &&
		!lockReleased &&
		isValidLockContext(lockContext);

	const [metadataDraft, dispatchMetadata] = useReducer(
		taskMetadataReducer,
		undefined,
		() =>
			createInitialTaskMetadataDraft({
				statusId: resolveInitialStatusId(statuses, defaultStatusId),
				projectId: defaultProjectId ?? null,
				phaseId: defaultPhaseId !== undefined ? defaultPhaseId : null,
			}),
	);

	const catalogs = useMemo((): TaskMetadataCatalogs => {
		const noopRetry = () => {};
		return {
			assignee:
				members.length > 0
					? { status: "ready", items: members }
					: { status: "empty" },
			priority:
				priorities.length > 0
					? { status: "ready", items: priorities }
					: { status: "empty" },
			label:
				labels.length > 0 ? { status: "ready", items: labels } : { status: "empty" },
			status:
				statuses.length > 0
					? { status: "ready", items: statuses }
					: { status: "empty" },
			project:
				projects.length > 0
					? { status: "ready", items: projects }
					: { status: "empty" },
			retry: noopRetry,
		};
	}, [labels, members, priorities, projects, statuses]);

	const commandFields = useMemo(
		() => getTrackerTaskFieldDefinitions(catalogs, lockContext),
		[catalogs, lockContext],
	);

	useEffect(() => {
		if (metadataDraft.statusId !== null || orderedStatuses.length === 0) return;
		const backlog = orderedStatuses.find(
			(s) => s.name.toLowerCase() === "backlog",
		);
		dispatchMetadata({
			type: "setField",
			field: "statusId",
			value: (backlog ?? orderedStatuses[0]).id,
		});
	}, [metadataDraft.statusId, orderedStatuses]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const [labelList, memberList, projectList] = await Promise.all([
				api.listTrackerVocabularies(workspaceId, "label"),
				api.getWorkspaceMembers(workspaceId),
				api.listTrackerProjects(workspaceId),
			]);
			if (cancelled) return;
			setLabels(labelList);
			setMembers(memberList.members);
			setProjects(projectList);
		})();
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	useEffect(() => {
		if (projects.length === 0) return;
		dispatchMetadata({
			type: "setProject",
			projectId: metadataDraft.projectId,
			projects: metadataProjects,
		});
	}, [metadataProjects, metadataDraft.projectId, projects.length]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (openPicker) {
				setOpenPicker(null);
				return;
			}
			if (titleEditorRef.current?.peelEscapeLayer()) return;
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose, openPicker]);

	const resetDraft = () => {
		dispatchMetadata({
			type: "reset",
			preserve: ["statusId", "projectId", "phaseId"],
		});
		setDescription("");
		setFieldErrors({});
		setError(null);
		setOpenPicker(null);
		setTitleEditorKey((key) => key + 1);
		setTitleValid(false);
	};

	const handleSubmit = async (e?: FormEvent) => {
		e?.preventDefault();
		const candidate = titleEditorRef.current?.getSubmitCandidate();
		if (!candidate?.valid || submitting) return;
		setSubmitting(true);
		setError(null);
		setFieldErrors({});
		try {
			const trimmedDescription = description.trim();
			const metadata = selectTaskMetadataPayload(metadataDraft);
			const body: Parameters<typeof api.createWorkItem>[1] = {
				title: candidate.title,
				priorityId: metadataDraft.priorityId,
				...metadata,
			};
			if (trimmedDescription) body.description = trimmedDescription;
			await api.createWorkItem(workspaceId, body);
			onCreated();
			if (createMore) resetDraft();
			else onClose();
		} catch (err) {
			if (err instanceof ApiError) {
				if (err.status === 400) {
					setError(err.message);
					if (err.fieldErrors) {
						setFieldErrors(err.fieldErrors);
						if (
							defaultProjectId !== undefined &&
							!lockReleased &&
							(err.fieldErrors.projectId || err.fieldErrors.phaseId)
						) {
							setLockReleased(true);
							dispatchMetadata({ type: "removeField", field: "projectId" });
						}
					}
				} else {
					setError("Could not create the item. Try again.");
				}
			} else {
				setError("Could not create the item. Try again.");
			}
		} finally {
			setSubmitting(false);
		}
	};

	const titleFilled = titleValid;

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/40 p-4 pt-[10vh] backdrop-blur-[2px]">
			<div
				className="absolute inset-0"
				data-testid="tracker-create-backdrop"
				onMouseDown={() => (openPicker ? setOpenPicker(null) : onClose())}
				aria-hidden
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="tracker-create-title"
				className="relative w-full max-w-2xl rounded-xl border border-neutral-200 bg-white shadow-[0_16px_48px_rgba(23,42,62,0.18)]"
			>
				<div className="flex items-center justify-between px-4 pt-3.5 pb-1">
					<div className="flex min-w-0 items-center gap-2">
						<span className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
							<ListTodo size={13} aria-hidden />
							Tracker
						</span>
						<span className="text-neutral-400" aria-hidden>
							›
						</span>
						<h2
							id="tracker-create-title"
							className="truncate font-medium text-neutral-900 text-sm"
						>
							New item
						</h2>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<X size={16} aria-hidden />
					</button>
				</div>

				<form
					onSubmit={(e) => void handleSubmit(e)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							void handleSubmit();
						}
					}}
				>
					<div className="px-4 pt-2">
						<div
							className="w-full font-medium text-[20px] text-neutral-900 leading-tight"
							data-field-error={fieldErrors.title ?? undefined}
						>
							<TaskTitleEditor
								key={titleEditorKey}
								ref={titleEditorRef}
								fields={commandFields}
								draft={metadataDraft}
								dispatch={dispatchMetadata}
								placeholder="Item title"
								fieldErrors={fieldErrors}
								suppressPlainEnter
								layeredEscape
								onTitleChange={(plain) => setTitleValid(plain.trim().length > 0)}
							/>
						</div>
						<label
							htmlFor="tracker-create-item-description"
							className="sr-only"
						>
							Description
						</label>
						<textarea
							id="tracker-create-item-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={4}
							placeholder="Add description…"
							data-field-error={fieldErrors.description ?? undefined}
							aria-invalid={fieldErrors.description ? true : undefined}
							className="mt-2 w-full resize-none border-0 bg-transparent text-neutral-700 text-sm placeholder:text-neutral-500 focus:outline-none"
						/>
					</div>

					<div className="px-4 pb-3">
						<TrackerCreateMetadataFields
							draft={metadataDraft}
							dispatch={dispatchMetadata}
							openPicker={openPicker}
							onOpenPickerChange={setOpenPicker}
							statuses={statuses}
							priorities={priorities}
							labels={labels}
							members={members}
							projects={projects}
							hideProjectPickers={hideProjectPickers}
							fieldErrors={fieldErrors}
						/>
					</div>

					<div className="flex items-center justify-end gap-3 border-neutral-200 border-t px-4 py-3">
						{error && (
							<p
								role="alert"
								className="mr-auto text-error-900 text-sm font-medium"
							>
								{error}
							</p>
						)}
						<button
							type="button"
							role="switch"
							aria-checked={createMore}
							onClick={() => setCreateMore((v) => !v)}
							className="inline-flex items-center gap-2 text-neutral-600 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<span
								className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${
									createMore ? "bg-primary-600" : "bg-neutral-300"
								}`}
								aria-hidden
							>
								<span
									className={`h-3 w-3 rounded-full bg-white transition-transform ${
										createMore ? "translate-x-3" : ""
									}`}
								/>
							</span>
							Create more
						</button>
						<button
							type="button"
							onClick={onClose}
							className="rounded-md px-3 py-1.5 text-neutral-700 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!titleFilled || submitting}
							className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none"
						>
							Create item
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
