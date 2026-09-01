import { Folder, Signpost } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NO_PRIORITY, sortStatusesByPosition } from "../../lib/trackerUtils";
import type {
	WorkItem,
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import { PriorityGlyph, StatusGlyph, statusGlyphSpec } from "./TrackerGlyphs";
import {
	type PickerOption,
	TrackerPropertyPicker,
} from "./TrackerPropertyPicker";
import {
	TrackerRowDatePopover,
	type TrackerRowDatePopoverHandle,
} from "./TrackerRowDatePopover";
import { TrackerRowKebabTrigger } from "./TrackerRowKebabTrigger";
import { TrackerRowMemberLabelFields } from "./TrackerRowMemberLabel";
import TrackerRowShell from "./TrackerRowShell";
import type { TrackerAuxiliaryLoadState } from "./trackerAuxiliaryState";
import { buildTrackerRowPickerState } from "./trackerRowPickerOptions";

type OpenPicker =
	| "date"
	| "status"
	| "priority"
	| "project"
	| "phase"
	| "assignees"
	| "labels"
	| "kebab"
	| null;

interface Props {
	item: WorkItem;
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	onStatusChange: (statusId: number) => void;
	onDateChange?: (dates: {
		startDate: string | null;
		endDate: string | null;
	}) => void;
	onPriorityChange?: (priorityId: number | null) => void;
	projects?: TrackerProject[];
	onProjectChange?: (projectId: number) => void;
	onPhaseChange?: (phaseId: number) => void;
	members?: WorkspaceMember[];
	labels?: TrackerVocabulary[];
	labelsLoadState?: TrackerAuxiliaryLoadState;
	membersLoadState?: TrackerAuxiliaryLoadState;
	onAssigneeToggle?: (toggledId: number) => void;
	onLabelToggle?: (toggledId: number) => void;
}

/**
 * One issue line. Column rhythm is fixed (priority · key · status · title ·
 * labels · assignee · date) so the eye scans straight down each property
 * instead of following ragged content — the Linear reading pattern.
 *
 * The whole row opens the item, except the status glyph, which opens a status
 * menu in place. That is why the navigation target is an overlay button behind
 * the content rather than a wrapper: a button may not nest inside a button.
 */
export default function TrackerRow({
	item,
	statuses,
	priorities,
	onStatusChange,
	onDateChange,
	onPriorityChange,
	projects,
	onProjectChange,
	onPhaseChange,
	members,
	labels,
	labelsLoadState,
	membersLoadState,
	onAssigneeToggle,
	onLabelToggle,
}: Props) {
	const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
	const pendingPickerRef = useRef<OpenPicker>(null);
	const datePopoverRef = useRef<TrackerRowDatePopoverHandle>(null);
	const kebabRef = useRef<HTMLButtonElement>(null);
	const glyph = statusGlyphSpec(statuses, item.status.id);
	const {
		selectedProject,
		selectedPhase,
		dateLabel,
		projectLabel,
		phaseLabel,
		priorityLabel,
		bars,
		projectOptions,
		phaseOptions,
		priorityOptions,
	} = buildTrackerRowPickerState({
		item,
		projects,
		priorities,
		labels,
		members,
	});

	const requestPicker = (next: OpenPicker) => {
		if (openPicker === "date" && next !== "date" && next !== null) {
			if (datePopoverRef.current?.tryClose() === false) return;
			pendingPickerRef.current = next;
			setOpenPicker(null);
			return;
		}
		setOpenPicker(next);
	};

	useEffect(() => {
		if (openPicker === null && pendingPickerRef.current !== null) {
			const pending = pendingPickerRef.current;
			pendingPickerRef.current = null;
			setOpenPicker(pending);
		}
	}, [openPicker]);

	const statusOptions: PickerOption[] = sortStatusesByPosition(statuses).map(
		(status) => ({
			id: String(status.id),
			label: status.name,
			icon: <StatusGlyph spec={statusGlyphSpec(statuses, status.id)} />,
			selected: status.id === item.status.id,
		}),
	);

	return (
		<TrackerRowShell itemKey={item.key} itemTitle={item.title}>
			{onPriorityChange ? (
				<span
					data-testid={`row-inline-priority-${item.key}`}
					className="pointer-events-auto hidden shrink-0 lg:block"
				>
					<TrackerPropertyPicker
						variant="inline"
						triggerLabel={`Priority: ${priorityLabel}`}
						placeholder="Priority"
						searchPlaceholder="Change priority…"
						icon={<PriorityGlyph bars={bars} size={13} />}
						options={priorityOptions}
						open={openPicker === "priority"}
						onOpenChange={(open) => requestPicker(open ? "priority" : null)}
						onSelect={(id) =>
							onPriorityChange(id === NO_PRIORITY ? null : Number(id))
						}
					/>
				</span>
			) : (
				<span
					className="hidden shrink-0 sm:block"
					title={item.priority ? item.priority.name : "No priority"}
				>
					<PriorityGlyph bars={bars} size={13} />
				</span>
			)}
			<span className="w-14 shrink-0 truncate font-mono text-neutral-500 text-xs tabular-nums">
				{item.key}
			</span>
			<span className="pointer-events-auto shrink-0">
				<TrackerPropertyPicker
					variant="inline"
					triggerLabel={`${item.status.name}, ${item.key}`}
					placeholder="Status"
					searchPlaceholder="Change status…"
					icon={<StatusGlyph spec={glyph} size={13} />}
					options={statusOptions}
					open={openPicker === "status"}
					onOpenChange={(open) => requestPicker(open ? "status" : null)}
					onSelect={(id) => onStatusChange(Number(id))}
				/>
			</span>
			<span className="min-w-0 flex-1 truncate text-neutral-900">
				{item.title}
			</span>
			{projects !== undefined && onProjectChange && (
				<span
					data-testid={`row-inline-project-${item.key}`}
					className="pointer-events-auto hidden w-28 shrink-0 lg:block"
				>
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
						open={openPicker === "project"}
						onOpenChange={(open) => requestPicker(open ? "project" : null)}
						onSelect={(id) => onProjectChange(Number(id))}
						size="row"
					/>
				</span>
			)}
			{projects !== undefined && onPhaseChange && (
				<span
					data-testid={`row-inline-phase-${item.key}`}
					className="pointer-events-auto hidden w-24 shrink-0 lg:block"
				>
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
						open={openPicker === "phase"}
						onOpenChange={(open) => requestPicker(open ? "phase" : null)}
						onSelect={(id) => onPhaseChange(Number(id))}
						size="row"
					/>
				</span>
			)}
			<TrackerRowMemberLabelFields
				item={item}
				labels={labels}
				members={members}
				labelsLoadState={labelsLoadState}
				membersLoadState={membersLoadState}
				onLabelToggle={onLabelToggle}
				onAssigneeToggle={onAssigneeToggle}
				labelsOpen={openPicker === "labels"}
				assigneesOpen={openPicker === "assignees"}
				onLabelsOpenChange={(open) => requestPicker(open ? "labels" : null)}
				onAssigneesOpenChange={(open) =>
					requestPicker(open ? "assignees" : null)
				}
			/>
			{onDateChange ? (
				<span className="pointer-events-auto hidden min-w-[9rem] shrink-0 truncate text-right text-neutral-500 text-xs tabular-nums lg:block">
					<TrackerRowDatePopover
						ref={datePopoverRef}
						startDate={item.startDate ?? null}
						endDate={item.endDate ?? null}
						triggerLabel={dateLabel}
						idPrefix={`tracker-row-inline-${item.key}`}
						open={openPicker === "date"}
						onOpenChange={(open) => requestPicker(open ? "date" : null)}
						onCommit={onDateChange}
					/>
				</span>
			) : (
				<time className="hidden w-12 shrink-0 text-right text-neutral-500 text-xs tabular-nums lg:block">
					{new Date(item.createdAt).toLocaleDateString(undefined, {
						month: "short",
						day: "numeric",
					})}
				</time>
			)}
			<TrackerRowKebabTrigger
				item={item}
				kebabRef={kebabRef}
				openPicker={openPicker}
				requestPicker={requestPicker}
				projects={projects}
				priorities={priorities}
				labels={labels}
				members={members}
				labelsLoadState={labelsLoadState}
				membersLoadState={membersLoadState}
				{...(onDateChange ? { onDateChange } : {})}
				{...(onProjectChange ? { onProjectChange } : {})}
				{...(onPhaseChange ? { onPhaseChange } : {})}
				{...(onPriorityChange ? { onPriorityChange } : {})}
				{...(onAssigneeToggle ? { onAssigneeToggle } : {})}
				{...(onLabelToggle ? { onLabelToggle } : {})}
			/>
		</TrackerRowShell>
	);
}
