import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { CardAttachmentUploadResponse } from "../../api";
import type { PreparedImagePair } from "../../shared/imageAttachments";
import { TicketIntakeChatOverlay } from "../../shared/TicketIntakeChatOverlay";
import { useTicketIntakeChat } from "../../shared/useTicketIntakeChat";
import type { Card, WorkspaceMember } from "../../types";
import { AssigneePicker } from "./AssigneePicker";
import BoardCardTaxonomyFields from "./BoardCardTaxonomyFields";
import CardAttachments from "./CardAttachments";
import type { FocusEntryButtonRenderer } from "./contextPanelPrimitives";
import { inputClass, MetaRow } from "./contextPanelPrimitives";

export interface ContextPanelEditorViewProps {
	activeWorkspaceId: number | null;
	assigneeIds: number[];
	assigneeOptions: WorkspaceMember[];
	card: Card;
	children?: ReactNode;
	deleteAttachment: (attachmentId: number) => Promise<void>;
	description: string;
	dueDate: string | null;
	labelIds: number[];
	onClose: () => void;
	openTicketIntake: ReturnType<typeof useTicketIntakeChat>["open"];
	phaseId: number | null;
	priorityId: number | null;
	projectId: number | null;
	renderFocusEntryButton: FocusEntryButtonRenderer;
	save: () => Promise<void>;
	setAssigneeIds: Dispatch<SetStateAction<number[]>>;
	setDescription: Dispatch<SetStateAction<string>>;
	setDueDate: Dispatch<SetStateAction<string | null>>;
	setLabelIds: Dispatch<SetStateAction<number[]>>;
	setPhaseId: Dispatch<SetStateAction<number | null>>;
	setPriorityId: Dispatch<SetStateAction<number | null>>;
	setProjectId: Dispatch<SetStateAction<number | null>>;
	showTaskActions: boolean;
	ticketIntakeChat: ReturnType<typeof useTicketIntakeChat>;
	ticketIntakeEnabled: boolean;
	title: string;
	setTitle: Dispatch<SetStateAction<string>>;
	uploadAttachments: (
		pairs: PreparedImagePair[],
	) => Promise<CardAttachmentUploadResponse>;
}

export function ContextPanelEditorView({
	activeWorkspaceId,
	assigneeIds,
	assigneeOptions,
	card,
	children,
	deleteAttachment,
	description,
	dueDate,
	labelIds,
	onClose,
	openTicketIntake,
	phaseId,
	priorityId,
	projectId,
	renderFocusEntryButton,
	save,
	setAssigneeIds,
	setDescription,
	setDueDate,
	setLabelIds,
	setPhaseId,
	setPriorityId,
	setProjectId,
	showTaskActions,
	ticketIntakeChat,
	ticketIntakeEnabled,
	title,
	setTitle,
	uploadAttachments,
}: ContextPanelEditorViewProps) {
	return (
		<>
			{showTaskActions && (
				<div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-neutral-200 px-4 py-2">
					{renderFocusEntryButton({
						source: "board",
						taskId: card.id,
						taskKey: card.key ?? null,
					})}
					{activeWorkspaceId !== null && ticketIntakeEnabled && (
						<button
							type="button"
							onClick={() =>
								openTicketIntake({
									variant: "card",
									prefill: {
										title: card.title,
										description: card.description,
										cardId: card.id,
										cardLink: `/board/card/${card.id}`,
									},
								})
							}
							className="rounded-md px-2.5 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Report issue
						</button>
					)}
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<section aria-label="Details" className="space-y-3 px-4 py-4">
					<h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">
						Details
					</h3>
					<label className="block">
						<span className="text-sm font-medium text-neutral-700">Title</span>
						<input
							className={inputClass}
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Card title"
						/>
					</label>
					<label className="block">
						<span className="text-sm font-medium text-neutral-700">
							Description
						</span>
						<textarea
							className={inputClass}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={4}
							placeholder="Add details..."
						/>
					</label>
					<div className="min-w-0">
						<span className="text-sm font-medium text-neutral-700">
							Assignees
						</span>
						<AssigneePicker
							members={assigneeOptions}
							value={assigneeIds}
							onChange={setAssigneeIds}
						/>
					</div>

					{activeWorkspaceId !== null && (
						<BoardCardTaxonomyFields
							workspaceId={activeWorkspaceId}
							priorityId={priorityId}
							labelIds={labelIds}
							projectId={projectId}
							phaseId={phaseId}
							projectName={card.projectName}
							phaseName={card.phaseName}
							priority={card.priority}
							labels={card.labels}
							dueDate={dueDate}
							onDueDateChange={setDueDate}
							onPriorityChange={setPriorityId}
							onLabelIdsChange={setLabelIds}
							onProjectChange={(nextProjectId, nextPhaseId) => {
								setProjectId(nextProjectId);
								setPhaseId(nextPhaseId);
							}}
							onPhaseChange={setPhaseId}
						/>
					)}

					{/* Passive timestamps — no surface of their own, so the Properties
			    block stays the only filled container in the form. */}
					<dl className="space-y-1 border-t border-neutral-200 pt-3">
						<MetaRow label="Created" value={card.createdAt} />
						<MetaRow label="Started" value={card.startedAt} />
						<MetaRow label="Done" value={card.doneAt} />
					</dl>
				</section>
				{activeWorkspaceId !== null && (
					<CardAttachments
						card={card}
						workspaceId={activeWorkspaceId}
						onUpload={uploadAttachments}
						onDelete={deleteAttachment}
					/>
				)}
				{children}
			</div>

			{ticketIntakeEnabled && (
				<TicketIntakeChatOverlay
					chat={ticketIntakeChat}
					onClose={ticketIntakeChat.close}
					ariaLabel="Report issue from card"
				/>
			)}

			<div className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 bg-white px-4 py-3">
				<button
					onClick={onClose}
					className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Cancel
				</button>
				<button
					onClick={() => void save()}
					className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Save changes
				</button>
			</div>
		</>
	);
}
