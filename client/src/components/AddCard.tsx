import { Image, Plus } from "lucide-react";
import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import type { BoardCreatePayload } from "../shared/taskCreateContracts";
import type { Column } from "../types";
import { AddCardForm } from "./AddCardForm";
import { useTaskMetadataCatalogs } from "../shared/TaskMetadataCatalogProvider";
import {
	type TaskFileCommandDefinition,
	type TaskTitleEditorHandle,
} from "../shared/TaskTitleEditor";
import { getBoardTaskFieldDefinitions } from "../shared/taskFieldDefinitions";
import {
	createInitialTaskMetadataDraft,
	taskMetadataReducer,
} from "../shared/taskMetadataDraft";
import { useAddCardImageStaging } from "./useAddCardImageStaging";
import { useAddCardSubmit } from "./useAddCardSubmit";

interface Props {
	column: Column;
	onAddCard: (payload: BoardCreatePayload) => Promise<void>;
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
	const {
		stagedImages,
		setStagedImages,
		stageCapMessage,
		hasUnreadyStaged,
		stageFiles,
		removeStagedImage,
		resetStagedImages,
	} = useAddCardImageStaging();
	const editorRef = useRef<TaskTitleEditorHandle>(null);
	const editorShellRef = useRef<HTMLDivElement>(null);
	const atLimit =
		column.wipLimit !== null && column.cards.length >= column.wipLimit;

	const imageFileCommand = useMemo<TaskFileCommandDefinition>(
		() => ({
			kind: "file",
			id: "image",
			label: "Image",
			icon: (
				<Image size={14} className="shrink-0 text-neutral-500" aria-hidden />
			),
			accept: "image/png,image/jpeg",
			multiple: true,
			onFilesSelected: (files) => {
				void stageFiles(files);
			},
		}),
		[stageFiles],
	);

	const close = useCallback(() => {
		resetStagedImages();
		setOpen(false);
	}, [resetStagedImages]);

	const { submitting, submit } = useAddCardSubmit({
		columnId: column.id,
		draft,
		stagedImages,
		hasUnreadyStaged,
		setStagedImages,
		resetStagedImages,
		onAddCard,
		onSuccess: () => {
			dispatch({ type: "reset" });
			setOpen(false);
		},
		editorRef,
		editorShellRef,
		fields,
		open,
	});

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
		<AddCardForm
			submitting={submitting}
			hasUnreadyStaged={hasUnreadyStaged}
			stagedImages={stagedImages}
			stageCapMessage={stageCapMessage}
			fields={fields}
			fileCommand={imageFileCommand}
			draft={draft}
			dispatch={dispatch}
			editorRef={editorRef}
			editorShellRef={editorShellRef}
			onSubmit={() => {
				void submit();
			}}
			onCancel={close}
			onRemoveImage={removeStagedImage}
			onRetryUpload={() => {
				void submit();
			}}
		/>
	);
}
