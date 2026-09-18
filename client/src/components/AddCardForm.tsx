import type { Dispatch, Ref } from "react";
import { AddCardImageChips } from "./AddCardImageChips";
import type { StagedImage } from "./addCardImageStaging";
import {
	type TaskFieldCommandDefinition,
	type TaskFileCommandDefinition,
	TaskTitleEditor,
	type TaskTitleEditorHandle,
} from "../shared/TaskTitleEditor";
import type {
	TaskMetadataAction,
	TaskMetadataDraft,
} from "../shared/taskMetadataDraft";

interface AddCardFormProps {
	submitting: boolean;
	hasUnreadyStaged: boolean;
	stagedImages: StagedImage[];
	stageCapMessage: string | null;
	fields: TaskFieldCommandDefinition[];
	fileCommand: TaskFileCommandDefinition;
	draft: TaskMetadataDraft;
	dispatch: Dispatch<TaskMetadataAction>;
	editorRef: Ref<TaskTitleEditorHandle>;
	editorShellRef: Ref<HTMLDivElement>;
	onSubmit: () => void;
	onCancel: () => void;
	onRemoveImage: (id: string) => void;
	onRetryUpload: () => void;
}

export function AddCardForm({
	submitting,
	hasUnreadyStaged,
	stagedImages,
	stageCapMessage,
	fields,
	fileCommand,
	draft,
	dispatch,
	editorRef,
	editorShellRef,
	onSubmit,
	onCancel,
	onRemoveImage,
	onRetryUpload,
}: AddCardFormProps) {
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
					onSubmit();
				}}
				onKeyDown={(event) => {
					if (event.key !== "Enter" || event.shiftKey) return;
					if (event.currentTarget.querySelector('[role="listbox"]')) return;
					event.preventDefault();
					onSubmit();
				}}
			>
				<div
					ref={editorShellRef}
					className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus-within:border-primary-600 focus-within:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)]"
				>
					<TaskTitleEditor
						ref={editorRef}
						fields={fields}
						fileCommands={[fileCommand]}
						draft={draft}
						dispatch={dispatch}
						placeholder="What needs doing?"
						ariaLabel="Task title"
					/>
				</div>
				<AddCardImageChips
					stagedImages={stagedImages}
					onRemove={onRemoveImage}
					onRetry={onRetryUpload}
				/>
				{stageCapMessage ? (
					<p className="mt-1 text-error-700 text-xs">{stageCapMessage}</p>
				) : null}
				<div className="mt-2 flex gap-2">
					<button
						type="submit"
						disabled={hasUnreadyStaged}
						className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60"
					>
						Add to board
					</button>
					<button
						type="button"
						onClick={onCancel}
						className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700"
					>
						Cancel
					</button>
				</div>
			</form>
		</div>
	);
}
