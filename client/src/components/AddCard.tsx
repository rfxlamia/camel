import { Plus } from "lucide-react";
import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { ApiError } from "../api";
import type {
	BoardCreatePayload,
	TaskCreateFieldErrors,
} from "../lib/taskCreateContracts";
import type { Column } from "../types";
import { getBoardTaskFieldDefinitions } from "./task-entry/taskFieldDefinitions";
import {
	createInitialTaskMetadataDraft,
	selectTaskMetadataPayload,
	taskMetadataReducer,
} from "./task-entry/taskMetadataDraft";
import { useTaskMetadataCatalogs } from "./task-entry/TaskMetadataCatalogProvider";
import {
	TaskTitleEditor,
	type TaskTitleEditorHandle,
} from "./task-entry/TaskTitleEditor";

interface Props {
	column: Column;
	onAddCard: (payload: BoardCreatePayload) => Promise<void>;
}

const CHIP_FIELD_PREFIXES: Partial<Record<keyof TaskCreateFieldErrors, string>> =
	{
		assigneeIds: "Assignee",
		priorityId: "Priority",
		labelIds: "Labels",
		projectId: "Project",
		phaseId: "Phase",
		dueDate: "Due date",
	};

function buildBoardPayload(
	columnId: number,
	title: string,
	draft: ReturnType<typeof createInitialTaskMetadataDraft>,
): BoardCreatePayload {
	const metadata = selectTaskMetadataPayload(draft);
	const { statusId: _statusId, startDate: _startDate, endDate: _endDate, ...boardMetadata } =
		metadata;
	return {
		columnId,
		title,
		...boardMetadata,
	};
}

export default function AddCard({ column, onAddCard }: Props) {
	const catalogs = useTaskMetadataCatalogs();
	const fields = useMemo(
		() => getBoardTaskFieldDefinitions(catalogs),
		[catalogs],
	);
	const [open, setOpen] = useState(false);
	const [draft, dispatch] = useReducer(
		taskMetadataReducer,
		undefined,
		createInitialTaskMetadataDraft,
	);
	const [submitting, setSubmitting] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<TaskCreateFieldErrors>({});
	const editorRef = useRef<TaskTitleEditorHandle>(null);
	const editorShellRef = useRef<HTMLDivElement>(null);
	const atLimit =
		column.wipLimit !== null && column.cards.length >= column.wipLimit;

	const submit = useCallback(async () => {
		if (submitting) return;
		const candidate = editorRef.current?.getSubmitCandidate();
		if (!candidate?.valid) return;

		setSubmitting(true);
		setFieldErrors({});
		try {
			const payload = buildBoardPayload(column.id, candidate.title, draft);
			await onAddCard(payload);
			dispatch({ type: "reset" });
			setOpen(false);
		} catch (err) {
			if (err instanceof ApiError && err.fieldErrors) {
				setFieldErrors(err.fieldErrors);
			}
		} finally {
			setSubmitting(false);
		}
	}, [column.id, draft, onAddCard, submitting]);

	useLayoutEffect(() => {
		const shell = editorShellRef.current;
		if (!shell) return;
		for (const [field, prefix] of Object.entries(CHIP_FIELD_PREFIXES)) {
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
	}, [draft, fieldErrors, fields, open]);

	if (!open) {
		return (
			<button
				onClick={() => setOpen(true)}
				disabled={atLimit}
				title={atLimit ? "WIP limit reached" : undefined}
				className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-primary-600 transition-colors hover:bg-primary-100 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"
			>
				<Plus size={15} className="shrink-0" aria-hidden />
				Add card
			</button>
		);
	}

	return (
		<div className="mt-2 space-y-2">
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
				onKeyDown={(event) => {
					if (event.key !== "Enter" || event.shiftKey) return;
					if (event.currentTarget.querySelector('[role="listbox"]')) return;
					event.preventDefault();
					void submit();
				}}
			>
				<div
					ref={editorShellRef}
					className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus-within:border-primary-600 focus-within:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)]"
				>
					<TaskTitleEditor
						ref={editorRef}
						fields={fields}
						draft={draft}
						dispatch={dispatch}
						placeholder="What needs doing?"
					/>
				</div>
				<div className="mt-2 flex gap-2">
					<button
						type="submit"
						disabled={submitting}
						className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60"
					>
						Add to board
					</button>
					<button
						type="button"
						onClick={() => setOpen(false)}
						className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700"
					>
						Cancel
					</button>
				</div>
			</form>
		</div>
	);
}
