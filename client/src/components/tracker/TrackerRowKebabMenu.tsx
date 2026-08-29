import { Folder, Signpost, Tag, UserRound } from "lucide-react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	POPOVER_WIDTH,
	computePopoverPosition,
} from "../../lib/popoverPlacement";
import { NO_PRIORITY } from "../../lib/trackerUtils";
import type {
	TrackerItem,
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import { Avatar, LabelDot, PriorityGlyph } from "./TrackerGlyphs";
import {
	TrackerPropertyPicker,
} from "./TrackerPropertyPicker";
import { TrackerRowDatePopover } from "./TrackerRowDatePopover";
import { buildTrackerRowPickerState } from "./trackerRowPickerOptions";

type ActiveField =
	| "date"
	| "project"
	| "phase"
	| "priority"
	| "assignee"
	| "label"
	| null;

export interface TrackerRowKebabMenuProps {
	anchorRef: RefObject<HTMLElement>;
	idPrefix: string;
	item: TrackerItem;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projects?: TrackerProject[];
	priorities: TrackerVocabulary[];
	labels?: TrackerVocabulary[];
	members?: WorkspaceMember[];
	onDateChange?: (dates: {
		startDate: string | null;
		endDate: string | null;
	}) => void;
	onProjectChange?: (projectId: number) => void;
	onPhaseChange?: (phaseId: number) => void;
	onPriorityChange?: (priorityId: number | null) => void;
	onAssigneeToggle?: (toggledId: number) => void;
	onLabelToggle?: (toggledId: number) => void;
}

export function TrackerRowKebabMenu({
	anchorRef,
	idPrefix,
	item,
	open,
	onOpenChange,
	projects,
	priorities,
	labels,
	members,
	onDateChange,
	onProjectChange,
	onPhaseChange,
	onPriorityChange,
	onAssigneeToggle,
	onLabelToggle,
}: TrackerRowKebabMenuProps) {
	const [activeField, setActiveField] = useState<ActiveField>(null);
	const pendingFieldRef = useRef<ActiveField>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const [panelCoords, setPanelCoords] = useState<{
		top: number;
		left: number;
	} | null>(null);

	useEffect(() => {
		if (!open) setActiveField(null);
	}, [open]);

	const requestField = useCallback((next: ActiveField) => {
		setActiveField((current) => {
			if (current === "date" && next !== "date" && next !== null) {
				pendingFieldRef.current = next;
				return null;
			}
			return next;
		});
	}, []);

	useEffect(() => {
		if (activeField === null && pendingFieldRef.current !== null) {
			const pending = pendingFieldRef.current;
			pendingFieldRef.current = null;
			setActiveField(pending);
		}
	}, [activeField]);

	const closePanel = useCallback(() => {
		setActiveField(null);
		onOpenChange(false);
		anchorRef.current?.focus();
	}, [anchorRef, onOpenChange]);

	useEffect(() => {
		if (!open) {
			anchorRef.current?.focus();
		}
	}, [open, anchorRef]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: MouseEvent) => {
			const target = e.target as Node;
			if (panelRef.current?.contains(target)) return;
			if (anchorRef.current?.contains(target)) return;
			const datePopover = document.querySelector(
				`[data-tracker-row-date-popover="${idPrefix}"]`,
			);
			if (datePopover?.contains(target)) return;
			closePanel();
		};
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [open, closePanel, anchorRef, idPrefix]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") closePanel();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, closePanel]);

	useLayoutEffect(() => {
		if (!open) {
			setPanelCoords(null);
			return;
		}

		const updatePosition = () => {
			const anchor = anchorRef.current;
			if (!anchor) return;
			const triggerRect = anchor.getBoundingClientRect();
			const position = computePopoverPosition({
				trigger: triggerRect,
				popoverWidth: POPOVER_WIDTH,
				popoverHeight: 400,
				align: "right",
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
			});
			setPanelCoords({ top: position.top, left: position.left });
		};

		updatePosition();
		window.addEventListener("resize", updatePosition);
		document.addEventListener("scroll", updatePosition, true);
		return () => {
			window.removeEventListener("resize", updatePosition);
			document.removeEventListener("scroll", updatePosition, true);
		};
	}, [open, anchorRef]);

	const {
		selectedProject,
		selectedPhase,
		dateLabel,
		projectLabel,
		phaseLabel,
		priorityLabel,
		bars: priorityBarsCount,
		projectOptions,
		phaseOptions,
		priorityOptions,
		assigneeOptions,
		assigneeValue,
		labelOptions,
		labelValue,
	} = buildTrackerRowPickerState({
		item,
		projects,
		priorities,
		labels,
		members,
	});

	if (!open) return null;

	return createPortal(
		<div
			ref={panelRef}
			role="dialog"
			aria-label={`More properties for ${item.key}`}
			style={{
				position: "fixed",
				top: panelCoords?.top ?? 0,
				left: panelCoords?.left ?? 0,
				zIndex: 50,
			}}
			className="w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-[0_8px_24px_rgba(23,42,62,0.12)]"
		>
			<div className="mb-3 flex items-center justify-between gap-2">
				<h2 className="font-medium text-neutral-900 text-sm">
					Properties
				</h2>
				<button
					type="button"
					aria-label="Close properties panel"
					onClick={closePanel}
					className="rounded-md px-2 py-1 text-neutral-600 text-xs hover:bg-neutral-100"
				>
					Close
				</button>
			</div>

			<div className="flex flex-col gap-2">
				{onDateChange ? (
					<TrackerRowDatePopover
						startDate={item.startDate ?? null}
						endDate={item.endDate ?? null}
						triggerLabel={dateLabel}
						idPrefix={idPrefix}
						open={activeField === "date"}
						onOpenChange={(nextOpen) =>
							requestField(nextOpen ? "date" : null)
						}
						onCommit={onDateChange}
					/>
				) : null}

				{onProjectChange ? (
					<div data-testid={`${idPrefix}-project`}>
						<TrackerPropertyPicker
							placeholder="Set project"
							value={selectedProject?.name}
							triggerLabel={`Project: ${projectLabel}`}
							icon={
								<Folder
									size={12}
									className="shrink-0 text-primary-700"
									aria-hidden
								/>
							}
							searchPlaceholder="Set project to…"
							options={projectOptions}
							open={activeField === "project"}
							onOpenChange={(nextOpen) =>
								requestField(nextOpen ? "project" : null)
							}
							onSelect={(id) => onProjectChange(Number(id))}
							size="compact"
						/>
					</div>
				) : null}

				{onPhaseChange ? (
					<div data-testid={`${idPrefix}-phase`}>
						<TrackerPropertyPicker
							placeholder="Set phase"
							value={selectedPhase?.name}
							triggerLabel={`Phase: ${phaseLabel}`}
							icon={
								<Signpost
									size={12}
									className="shrink-0 text-primary-700"
									aria-hidden
								/>
							}
							searchPlaceholder="Set phase to…"
							options={phaseOptions}
							open={activeField === "phase"}
							onOpenChange={(nextOpen) =>
								requestField(nextOpen ? "phase" : null)
							}
							onSelect={(id) => onPhaseChange(Number(id))}
							size="compact"
						/>
					</div>
				) : null}

				{onPriorityChange ? (
					<div data-testid={`${idPrefix}-priority`}>
						<TrackerPropertyPicker
							placeholder="Priority"
							value={item.priority?.name}
							triggerLabel={`Priority: ${priorityLabel}`}
							icon={<PriorityGlyph bars={priorityBarsCount} size={13} />}
							searchPlaceholder="Change priority…"
							options={priorityOptions}
							open={activeField === "priority"}
							onOpenChange={(nextOpen) =>
								requestField(nextOpen ? "priority" : null)
							}
							onSelect={(id) =>
								onPriorityChange(id === NO_PRIORITY ? null : Number(id))
							}
							size="compact"
						/>
					</div>
				) : null}

				{onAssigneeToggle ? (
					<div data-testid={`${idPrefix}-assignees`}>
						{members && members.length > 0 ? (
							<TrackerPropertyPicker
								placeholder="Assignees"
								value={assigneeValue}
								triggerLabel="Assignees"
								icon={
									item.assignees.length > 0 ? (
										<Avatar name={item.assignees[0].displayName} size={16} />
									) : (
										<UserRound
											size={14}
											className="shrink-0 text-neutral-500"
											aria-hidden
										/>
									)
								}
								searchPlaceholder="Assign to…"
								options={assigneeOptions}
								open={activeField === "assignee"}
								onOpenChange={(nextOpen) =>
									requestField(nextOpen ? "assignee" : null)
								}
								onSelect={(id) => onAssigneeToggle(Number(id))}
								multiple
								size="compact"
							/>
						) : (
							<p className="px-1 text-neutral-500 text-xs">
								No members in this workspace
							</p>
						)}
					</div>
				) : null}

				{onLabelToggle ? (
					<div data-testid={`${idPrefix}-labels`}>
						{labels && labels.length > 0 ? (
							<TrackerPropertyPicker
								placeholder="Labels"
								value={labelValue}
								triggerLabel="Labels"
								icon={
									item.labels.length > 0 ? (
										<LabelDot colour={item.labels[0].colour} />
									) : (
										<Tag
											size={12}
											className="shrink-0 text-neutral-500"
											aria-hidden
										/>
									)
								}
								searchPlaceholder="Change or add labels…"
								options={labelOptions}
								open={activeField === "label"}
								onOpenChange={(nextOpen) =>
									requestField(nextOpen ? "label" : null)
								}
								onSelect={(id) => onLabelToggle(Number(id))}
								multiple
								size="compact"
							/>
						) : (
							<p className="px-1 text-neutral-500 text-xs">
								No labels in this workspace
							</p>
						)}
					</div>
				) : null}
			</div>
		</div>,
		document.body,
	);
}
