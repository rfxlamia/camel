import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useLayoutEffect,
	useState,
} from "react";
import { ApiError } from "../api";
import type {
	BoardCreatePayload,
	TaskCreateFieldErrors,
} from "../shared/taskCreateContracts";
import {
	buildBoardPayload,
	markStagedUploadFailure,
	type StagedImage,
	uploadFailureMessage,
} from "./addCardImageStaging";
import type { TaskTitleEditorHandle } from "./task-entry/TaskTitleEditor";
import type { TaskFieldCommandDefinition } from "./task-entry/taskFieldDefinitions";
import type { TaskMetadataDraft } from "./task-entry/taskMetadataDraft";

const CHIP_FIELD_PREFIXES: Partial<
	Record<keyof TaskCreateFieldErrors, string>
> = {
	assigneeIds: "Assignee",
	priorityId: "Priority",
	labelIds: "Labels",
	projectId: "Project",
	phaseId: "Phase",
	dueDate: "Due date",
};

interface UseAddCardSubmitOptions {
	columnId: number;
	draft: TaskMetadataDraft;
	stagedImages: StagedImage[];
	hasUnreadyStaged: boolean;
	setStagedImages: Dispatch<SetStateAction<StagedImage[]>>;
	resetStagedImages: () => void;
	onAddCard: (payload: BoardCreatePayload) => Promise<void>;
	onSuccess: () => void;
	editorRef: RefObject<TaskTitleEditorHandle | null>;
	editorShellRef: RefObject<HTMLDivElement | null>;
	fields: TaskFieldCommandDefinition[];
	open: boolean;
}

export function useAddCardSubmit({
	columnId,
	draft,
	stagedImages,
	hasUnreadyStaged,
	setStagedImages,
	resetStagedImages,
	onAddCard,
	onSuccess,
	editorRef,
	editorShellRef,
	fields,
	open,
}: UseAddCardSubmitOptions) {
	const [submitting, setSubmitting] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<TaskCreateFieldErrors>({});

	const submit = useCallback(async () => {
		if (submitting || hasUnreadyStaged) return;
		const candidate = editorRef.current?.getSubmitCandidate();
		if (!candidate?.valid) return;

		setSubmitting(true);
		setFieldErrors({});
		try {
			await onAddCard(
				buildBoardPayload(columnId, candidate.title, draft, stagedImages),
			);
			resetStagedImages();
			onSuccess();
		} catch (err) {
			if (err instanceof ApiError && err.fieldErrors) {
				setFieldErrors(err.fieldErrors);
			} else if (stagedImages.some((entry) => entry.kind === "valid")) {
				setStagedImages((current) =>
					markStagedUploadFailure(current, uploadFailureMessage(err)),
				);
			}
		} finally {
			setSubmitting(false);
		}
	}, [
		columnId,
		draft,
		editorRef,
		hasUnreadyStaged,
		onAddCard,
		onSuccess,
		resetStagedImages,
		setStagedImages,
		stagedImages,
		submitting,
	]);

	useLayoutEffect(() => {
		if (!open) return;
		const shell = editorShellRef.current;
		if (!shell) return;
		const selectedFieldIds = new Set(
			fields
				.filter((field) => field.getSelectedOptionIds(draft).length > 0)
				.map((field) => field.id),
		);
		for (const [field, prefix] of Object.entries(CHIP_FIELD_PREFIXES)) {
			if (!selectedFieldIds.has(field)) continue;
			const chip = shell.querySelector<HTMLElement>(
				`button[aria-label^="${prefix}:"]`,
			);
			if (!chip) continue;
			if (fieldErrors[field as keyof TaskCreateFieldErrors]) {
				chip.setAttribute("aria-invalid", "true");
				chip.setAttribute("data-invalid", "true");
			} else {
				chip.removeAttribute("aria-invalid");
				chip.removeAttribute("data-invalid");
			}
		}
	}, [draft, editorShellRef, fieldErrors, fields, open]);

	return { submitting, fieldErrors, submit };
}
