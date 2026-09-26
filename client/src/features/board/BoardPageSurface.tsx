import { closestCorners, DndContext, DragOverlay } from "@dnd-kit/core";
import { Columns3 } from "lucide-react";
import { useCallback } from "react";
import { Outlet, useNavigate } from "react-router";
import EmptyState from "../../shared/EmptyState";
import { TaskMetadataCatalogProvider } from "../../shared/TaskMetadataCatalogProvider";
import { useShowToast } from "../../shared/ToastContext";
import { useWorkspace } from "../../shared/WorkspaceContext";
import type { Card } from "../../types";
import { AddColumn } from "./AddColumn";
import type { useBoard } from "./BoardContext";
import { BoardToolbar } from "./BoardToolbar";
import CalendarView from "./CalendarView";
import { CardBody } from "./CardView";
import ColumnView from "./ColumnView";
import ListView from "./ListView";
import TemplatePicker from "./TemplatePicker";
import TrashZone from "./TrashZone";
import { WORKSPACE_TEMPLATES } from "./templates";
import { useBoardDragInteractions } from "./useBoardDragInteractions";
import { useBoardPageActions } from "./useBoardPageActions";

export function BoardPageSurface({
	board,
}: {
	board: ReturnType<typeof useBoard>;
}) {
	const { columns, loadError, saveCard } = board;
	const { activeWorkspaceId, boardViewMode, setBoardViewMode } = useWorkspace();
	const showToast = useShowToast();
	const navigate = useNavigate();
	const onOpenCard = useCallback(
		(card: Card) => navigate(`/board/card/${card.id}`),
		[navigate],
	);
	const {
		activeCard,
		changeColumn,
		onDragEnd,
		onDragOver,
		onDragStart,
		revert,
		sensors,
		setActiveCard,
	} = useBoardDragInteractions({ activeWorkspaceId, board, showToast });
	const {
		onAddCard,
		onAddColumn,
		onApplyTemplate,
		onStartBlank,
		onUpdateColumn,
		pickerState,
		startBlank,
	} = useBoardPageActions({ activeWorkspaceId, board, showToast });
	return (
		<div className="flex h-full flex-col">
			{/* Board identity heading — visually carried by the toolbar/columns, but
			    kept in the document so heading order starts at h1 (topbar is a span). */}
			<h1 className="sr-only">Board</h1>
			{columns !== null && (
				<BoardToolbar
					columns={columns}
					boardViewMode={boardViewMode}
					setBoardViewMode={setBoardViewMode}
				/>
			)}

			<div className="board-canvas relative flex-1 overflow-x-auto p-6">
				{loadError && (
					<div className="mx-auto max-w-md rounded-md border border-error-500 bg-error-100 px-4 py-3 text-sm text-error-900">
						Couldn't load the board. Check that the server is running, then
						refresh.
					</div>
				)}
				{!loadError && columns === null && (
					<p className="text-sm text-neutral-500">Loading board...</p>
				)}
				{!loadError && columns && boardViewMode === "board" && (
					<DndContext
						sensors={sensors}
						collisionDetection={closestCorners}
						onDragStart={onDragStart}
						onDragOver={onDragOver}
						onDragEnd={onDragEnd}
						onDragCancel={() => {
							setActiveCard(null);
							revert();
						}}
					>
						{columns.length === 0 ? (
							<div className="flex h-full items-center justify-center">
								{startBlank ? (
									<EmptyState
										icon={Columns3}
										title="Start your board"
										description="Columns are the stages your work moves through — like To do, In progress, and Done. Add your first one to get going."
										action={<AddColumn onAddColumn={onAddColumn} />}
									/>
								) : (
									<TemplatePicker
										templates={WORKSPACE_TEMPLATES}
										state={pickerState}
										onApply={onApplyTemplate}
										onStartBlank={onStartBlank}
									/>
								)}
							</div>
						) : (
							<TaskMetadataCatalogProvider workspaceId={activeWorkspaceId}>
								<div className="flex h-full items-start gap-5 pb-2">
									{columns.map((column, i) => (
										<div
											key={column.id}
											className="animate-rise-in shrink-0"
											style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
										>
											<ColumnView
												column={column}
												onOpenCard={onOpenCard}
												onAddCard={onAddCard}
												onUpdateColumn={onUpdateColumn}
											/>
										</div>
									))}
									<AddColumn onAddColumn={onAddColumn} />
								</div>
							</TaskMetadataCatalogProvider>
						)}
						<DragOverlay>
							{activeCard && (
								<div className="rotate-2 cursor-grabbing rounded-md border border-primary-300 bg-white py-2.5 pr-3 pl-3.5 shadow-lg ring-1 ring-primary-600/10">
									<CardBody card={activeCard} />
								</div>
							)}
						</DragOverlay>
						<TrashZone visible={activeCard !== null} />
					</DndContext>
				)}
				{!loadError && columns !== null && boardViewMode === "list" && (
					<ListView
						columns={columns}
						onOpenCard={onOpenCard}
						onColumnChange={(card, toColumnId) =>
							void changeColumn(card, toColumnId)
						}
					/>
				)}
				{!loadError && columns !== null && boardViewMode === "calendar" && (
					<CalendarView
						columns={columns}
						onOpenCard={onOpenCard}
						saveCard={saveCard}
					/>
				)}
			</div>

			{/* Context panel route (/board/card/:id) renders here. */}
			<Outlet />
		</div>
	);
}
