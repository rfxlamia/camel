import {
	type FormEvent,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { ApiError, api } from "../../api";
import type { TaskMetadataCatalogs } from "../../shared/TaskMetadataCatalogProvider";
import type { TaskTitleEditorHandle } from "../../shared/TaskTitleEditor";
import type { TaskCreateFieldErrors } from "../../shared/taskCreateContracts";
import {
	getTrackerTaskFieldDefinitions,
	type TrackerFieldLockContext,
} from "../../shared/taskFieldDefinitions";
import {
	createInitialTaskMetadataDraft,
	selectTaskMetadataPayload,
	taskMetadataReducer,
} from "../../shared/taskMetadataDraft";
import { sortStatusesByPosition } from "../../shared/trackerUtils";
import type {
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import type { TrackerCreatePickerName } from "./TrackerCreateMetadataFields";
import {
	isValidLockContext,
	resolveInitialStatusId,
	toMetadataProjects,
} from "./trackerCreateLock";

export interface TrackerCreateModalProps {
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

export function useTrackerCreateModal({
	workspaceId,
	onClose,
	onCreated,
	statuses,
	priorities,
	defaultStatusId,
	defaultProjectId,
	defaultPhaseId,
}: TrackerCreateModalProps) {
	const [description, setDescription] = useState("");
	const [labels, setLabels] = useState<TrackerVocabulary[]>([]);
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	const [projects, setProjects] = useState<TrackerProject[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<TaskCreateFieldErrors>({});
	const [createMore, setCreateMore] = useState(false);
	const [openPicker, setOpenPicker] = useState<TrackerCreatePickerName | null>(
		null,
	);
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
		const noopRetry = () => undefined;
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
				labels.length > 0
					? { status: "ready", items: labels }
					: { status: "empty" },
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
			if (err instanceof ApiError && err.status === 400) {
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
		} finally {
			setSubmitting(false);
		}
	};

	return {
		onClose,
		statuses,
		priorities,
		description,
		setDescription,
		labels,
		members,
		projects,
		submitting,
		error,
		fieldErrors,
		createMore,
		setCreateMore,
		openPicker,
		setOpenPicker,
		titleEditorKey,
		setTitleValid,
		titleEditorRef,
		hideProjectPickers,
		metadataDraft,
		dispatchMetadata,
		commandFields,
		handleSubmit,
		titleFilled: titleValid,
	};
}
