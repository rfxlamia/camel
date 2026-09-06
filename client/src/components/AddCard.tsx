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
import {
	MAX_ATTACHMENT_COUNT,
	prepareImageAttachment,
	type PreparedImagePair,
} from "../lib/imageAttachments";
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
	type TaskFileCommandDefinition,
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

const STAGE_CAP_MESSAGE = "Max 3 images per card";

type StagedImage =
	| {
			id: string;
			kind: "valid";
			name: string;
			prepared: PreparedImagePair;
			previewUrl: string;
	  }
	| {
			id: string;
			kind: "invalid";
			name: string;
			file: File;
			error: string;
	  }
	| {
			id: string;
			kind: "loading";
			name: string;
	  }
	| {
			id: string;
			kind: "network-error";
			name: string;
			prepared: PreparedImagePair;
			previewUrl: string;
			error: string;
	  };

function createStageId(): string {
	return crypto.randomUUID();
}

function buildBoardPayload(
	columnId: number,
	title: string,
	draft: ReturnType<typeof createInitialTaskMetadataDraft>,
	stagedImages: StagedImage[],
): BoardCreatePayload {
	const metadata = selectTaskMetadataPayload(draft);
	const { statusId: _statusId, startDate: _startDate, endDate: _endDate, ...boardMetadata } =
		metadata;
	const attachments = stagedImages
		.filter(
			(entry): entry is Extract<StagedImage, { kind: "valid" }> =>
				entry.kind === "valid",
		)
		.map((entry) => entry.prepared);
	return {
		columnId,
		title,
		...boardMetadata,
		...(attachments.length > 0 ? { attachments } : {}),
	};
}

function countStagedSlots(entries: StagedImage[]): number {
	return entries.filter((entry) => entry.kind !== "loading").length;
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
	const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
	const [stageCapMessage, setStageCapMessage] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<TaskCreateFieldErrors>({});
	const editorRef = useRef<TaskTitleEditorHandle>(null);
	const editorShellRef = useRef<HTMLDivElement>(null);
	const previewUrlsRef = useRef<string[]>([]);
	const atLimit =
		column.wipLimit !== null && column.cards.length >= column.wipLimit;

	const trackPreviewUrl = useCallback((url: string) => {
		previewUrlsRef.current.push(url);
	}, []);

	const revokePreviewUrls = useCallback(() => {
		for (const url of previewUrlsRef.current) {
			URL.revokeObjectURL(url);
		}
		previewUrlsRef.current = [];
	}, []);

	const resetStagedImages = useCallback(() => {
		revokePreviewUrls();
		setStagedImages([]);
		setStageCapMessage(null);
	}, [revokePreviewUrls]);

	const removeStagedImage = useCallback((id: string) => {
		setStagedImages((current) => {
			const removed = current.find((entry) => entry.id === id);
			if (
				removed &&
				(removed.kind === "valid" || removed.kind === "network-error")
			) {
				URL.revokeObjectURL(removed.previewUrl);
				previewUrlsRef.current = previewUrlsRef.current.filter(
					(url) => url !== removed.previewUrl,
				);
			}
			return current.filter((entry) => entry.id !== id);
		});
		setStageCapMessage(null);
	}, []);

	const stageFiles = useCallback(
		async (files: File[]) => {
			setStageCapMessage(null);
			for (const file of files) {
				const loadingId = createStageId();
				let rejected = false;
				setStagedImages((current) => {
					if (countStagedSlots(current) >= MAX_ATTACHMENT_COUNT) {
						rejected = true;
						return current;
					}
					return [
						...current,
						{ id: loadingId, kind: "loading", name: file.name },
					];
				});
				if (rejected) {
					setStageCapMessage(STAGE_CAP_MESSAGE);
					return;
				}

				const result = await prepareImageAttachment(file);
				setStagedImages((current) => {
					const next = current.filter((entry) => entry.id !== loadingId);
					if (result.kind === "invalid") {
						return [
							...next,
							{
								id: createStageId(),
								kind: "invalid",
								name: result.file.name,
								file: result.file,
								error: result.error,
							},
						];
					}
					const previewUrl = URL.createObjectURL(result.original);
					trackPreviewUrl(previewUrl);
					return [
						...next,
						{
							id: createStageId(),
							kind: "valid",
							name: result.original.name,
							prepared: result.prepared,
							previewUrl,
						},
					];
				});
			}
		},
		[trackPreviewUrl],
	);

	const imageFileCommand = useMemo<TaskFileCommandDefinition>(
		() => ({
			kind: "file",
			id: "image",
			label: "Image",
			accept: "image/png,image/jpeg",
			multiple: true,
			onFilesSelected: (files) => {
				void stageFiles(files);
			},
		}),
		[stageFiles],
	);

	const hasInvalidStaged = stagedImages.some(
		(entry) => entry.kind === "invalid",
	);

	const submit = useCallback(async () => {
		if (submitting || hasInvalidStaged) return;
		const candidate = editorRef.current?.getSubmitCandidate();
		if (!candidate?.valid) return;

		setSubmitting(true);
		setFieldErrors({});
		try {
			const payload = buildBoardPayload(
				column.id,
				candidate.title,
				draft,
				stagedImages,
			);
			await onAddCard(payload);
			dispatch({ type: "reset" });
			resetStagedImages();
			setOpen(false);
		} catch (err) {
			if (err instanceof ApiError && err.fieldErrors) {
				setFieldErrors(err.fieldErrors);
			}
		} finally {
			setSubmitting(false);
		}
	}, [
		column.id,
		draft,
		hasInvalidStaged,
		onAddCard,
		resetStagedImages,
		stagedImages,
		submitting,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-sync chip aria-invalid when chips mount or errors change
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
			{submitting ? (
				<div
					className="rounded-md border border-neutral-300 bg-white px-3 py-4 text-neutral-700 text-sm"
					aria-busy="true"
				>
					Adding card…
				</div>
			) : null}
			<form
				className={submitting ? "hidden" : undefined}
				aria-hidden={submitting ? true : undefined}
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
						fileCommands={[imageFileCommand]}
						draft={draft}
						dispatch={dispatch}
						placeholder="What needs doing?"
						ariaLabel="Task title"
					/>
				</div>
				{stagedImages.length > 0 ? (
					<div className="mt-2 flex flex-wrap items-center gap-1.5">
						{stagedImages.map((entry) => {
							const invalid =
								entry.kind === "invalid" || entry.kind === "network-error";
							const tone = invalid
								? "bg-error-100 text-error-900"
								: entry.kind === "loading"
									? "bg-neutral-100 text-neutral-700"
									: "bg-primary-100 text-primary-800";
							const label = `Image: ${entry.name}`;
							const ariaLabel =
								entry.kind === "invalid" || entry.kind === "network-error"
									? `${label}. ${entry.error}`
									: label;
							return (
								<span
									key={entry.id}
									className={`group inline-flex max-w-full items-center gap-0.5 rounded-full py-0.5 pr-1 pl-2 text-xs ${tone}`}
								>
									<button
										type="button"
										aria-label={ariaLabel}
										aria-invalid={invalid ? true : undefined}
										data-invalid={invalid ? "true" : undefined}
										className="max-w-40 truncate focus:outline-none"
									>
										{entry.kind === "loading" ? "Preparing…" : entry.name}
									</button>
									{entry.kind !== "loading" ? (
										<button
											type="button"
											aria-label={`Remove Image: ${entry.name}`}
											onClick={() => removeStagedImage(entry.id)}
											className="shrink-0 rounded-full px-1 leading-none opacity-50 transition hover:bg-black/10 hover:opacity-100"
										>
											×
										</button>
									) : null}
									{entry.kind === "network-error" ? (
										<button
											type="button"
											aria-label={`Retry Image: ${entry.name}`}
											onClick={() => {
												void submit();
											}}
											className="shrink-0 rounded-full px-1 leading-none underline opacity-80 hover:opacity-100"
										>
											Retry
										</button>
									) : null}
								</span>
							);
						})}
					</div>
				) : null}
				{stageCapMessage ? (
					<p className="mt-1 text-error-700 text-xs">{stageCapMessage}</p>
				) : null}
				<div className="mt-2 flex gap-2">
					<button
						type="submit"
						disabled={hasInvalidStaged}
						className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60"
					>
						Add to board
					</button>
					<button
						type="button"
						onClick={() => {
							resetStagedImages();
							setOpen(false);
						}}
						className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700"
					>
						Cancel
					</button>
				</div>
			</form>
		</div>
	);
}
