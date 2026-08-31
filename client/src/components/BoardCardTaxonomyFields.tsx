import { Folder, Plus, Signpost, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { NO_PRIORITY, resolveToggle, sortStatusesByPosition } from "../lib/trackerUtils";
import type { TrackerPhase, TrackerProject, TrackerVocabulary } from "../types";
import { LabelDot, PriorityGlyph, priorityBars } from "./tracker/TrackerGlyphs";
import {
	type PickerOption,
	TrackerPropertyPicker,
} from "./tracker/TrackerPropertyPicker";

type PickerName = "priority" | "labels" | "project" | "phase";
type LoadState = "loading" | "ready" | "error";

const NO_PROJECT = "no-project";
const NO_PHASE = "no-phase";

export interface BoardCardTaxonomyFieldsProps {
	workspaceId: number;
	priorityId: number | null;
	labelIds: number[];
	projectId: number | null;
	phaseId: number | null;
	/** Fallback display when workspace lists are unavailable. */
	priority?: TrackerVocabulary | null;
	labels?: TrackerVocabulary[];
	projectName?: string | null;
	phaseName?: string | null;
	onPriorityChange: (priorityId: number | null) => void;
	onLabelIdsChange: (labelIds: number[]) => void;
	onProjectChange: (projectId: number | null, phaseId: number | null) => void;
	onPhaseChange: (phaseId: number | null) => void;
}

function mergeVocabulary(
	list: TrackerVocabulary[],
	fallback: TrackerVocabulary | null | undefined,
): TrackerVocabulary[] {
	if (!fallback) return list;
	if (list.some((item) => item.id === fallback.id)) return list;
	return [...list, fallback];
}

function mergeLabels(
	list: TrackerVocabulary[],
	fallback: TrackerVocabulary[],
): TrackerVocabulary[] {
	const merged = [...list];
	for (const label of fallback) {
		if (!merged.some((item) => item.id === label.id)) merged.push(label);
	}
	return merged;
}

/**
 * Board card taxonomy pickers — priority, labels, project, and phase.
 * Reuses tracker vocabulary loaders and TrackerPropertyPicker chrome.
 * No status control; selections survive empty/loading/error option lists.
 */
export default function BoardCardTaxonomyFields({
	workspaceId,
	priorityId,
	labelIds,
	projectId,
	phaseId,
	priority,
	labels: selectedLabels = [],
	projectName,
	phaseName,
	onPriorityChange,
	onLabelIdsChange,
	onProjectChange,
	onPhaseChange,
}: BoardCardTaxonomyFieldsProps) {
	const [openPicker, setOpenPicker] = useState<PickerName | null>(null);
	const [priorities, setPriorities] = useState<TrackerVocabulary[]>([]);
	const [labels, setLabels] = useState<TrackerVocabulary[]>([]);
	const [projects, setProjects] = useState<TrackerProject[]>([]);
	const [vocabularyLoadState, setVocabularyLoadState] =
		useState<LoadState>("loading");
	const [projectsLoadState, setProjectsLoadState] =
		useState<LoadState>("loading");

	useEffect(() => {
		let active = true;
		setVocabularyLoadState("loading");
		setProjectsLoadState("loading");
		void (async () => {
			const [priorityResult, labelResult, projectResult] =
				await Promise.allSettled([
					api.listTrackerVocabularies(workspaceId, "priority"),
					api.listTrackerVocabularies(workspaceId, "label"),
					api.listTrackerProjects(workspaceId),
				]);
			if (!active) return;
			setPriorities(
				priorityResult.status === "fulfilled" ? priorityResult.value : [],
			);
			setLabels(labelResult.status === "fulfilled" ? labelResult.value : []);
			setProjects(
				projectResult.status === "fulfilled" ? projectResult.value : [],
			);
			setVocabularyLoadState(
				priorityResult.status === "fulfilled" &&
					labelResult.status === "fulfilled"
					? "ready"
					: "error",
			);
			setProjectsLoadState(
				projectResult.status === "fulfilled" ? "ready" : "error",
			);
		})();
		return () => {
			active = false;
		};
	}, [workspaceId]);

	const orderedPriorities = useMemo(
		() => sortStatusesByPosition(mergeVocabulary(priorities, priority)),
		[priorities, priority],
	);
	const orderedLabels = useMemo(
		() => sortStatusesByPosition(mergeLabels(labels, selectedLabels)),
		[labels, selectedLabels],
	);

	const selectedProject =
		projects.find((p) => p.id === projectId) ??
		(projectId != null && projectName
			? ({
					id: projectId,
					name: projectName,
					startDate: null,
					endDate: null,
					position: 0,
					version: 0,
					phases:
						phaseId != null && phaseName
							? [
									{
										id: phaseId,
										projectId,
										name: phaseName,
										subtitle: "",
										startDate: null,
										endDate: null,
										position: 0,
										version: 0,
										createdAt: "",
										updatedAt: "",
									} satisfies TrackerPhase,
								]
							: [],
				} satisfies TrackerProject)
			: undefined);

	const selectedPhase = selectedProject?.phases.find((p) => p.id === phaseId);

	const priorityOptions: PickerOption[] = [
		{
			id: NO_PRIORITY,
			label: "No priority",
			selected: priorityId === null,
			icon: <PriorityGlyph bars={0} />,
		},
		...orderedPriorities.map((p) => ({
			id: String(p.id),
			label: p.name,
			selected: p.id === priorityId,
			icon: <PriorityGlyph bars={priorityBars(orderedPriorities, p.id)} />,
		})),
	];

	const labelOptions: PickerOption[] = orderedLabels.map((l) => ({
		id: String(l.id),
		label: l.name,
		selected: labelIds.includes(l.id),
		icon: <LabelDot colour={l.colour} />,
	}));

	const projectList =
		selectedProject && !projects.some((p) => p.id === selectedProject.id)
			? [selectedProject, ...projects]
			: projects.length > 0
				? projects
				: selectedProject
					? [selectedProject]
					: [];

	const projectOptions: PickerOption[] = [
		{
			id: NO_PROJECT,
			label: "No project",
			selected: projectId === null,
		},
		...projectList.map((p) => ({
			id: String(p.id),
			label: p.name,
			selected: p.id === projectId,
		})),
	];

	const phaseOptions: PickerOption[] = [
		{
			id: NO_PHASE,
			label: "No phase",
			selected: phaseId === null,
		},
		...(selectedProject?.phases ?? []).map((ph) => ({
			id: String(ph.id),
			label: ph.name,
			selected: ph.id === phaseId,
		})),
	];

	const selectedPriority =
		orderedPriorities.find((p) => p.id === priorityId) ?? priority;
	const visibleLabels = orderedLabels.filter((l) => labelIds.includes(l.id));

	const showPriorityPicker =
		orderedPriorities.length > 0 || priorityId !== null || priority != null;
	const showLabelPicker =
		orderedLabels.length > 0 || labelIds.length > 0 || selectedLabels.length > 0;
	const showProjectPicker =
		projects.length > 0 || projectId != null || projectName != null;
	const showPhasePicker =
		projectId != null &&
		((selectedProject?.phases ?? []).length > 0 ||
			phaseId != null ||
			phaseName != null);

	const listHint =
		vocabularyLoadState === "loading" || projectsLoadState === "loading"
			? "Loading options…"
			: vocabularyLoadState === "error" || projectsLoadState === "error"
				? "Couldn't load all options — current values kept."
				: null;

	return (
		<div
			aria-label="Card taxonomy"
			className="space-y-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-3"
		>
			<h4 className="text-sm font-medium text-neutral-700">Properties</h4>
			{listHint && (
				<p className="text-xs text-neutral-500" role="status">
					{listHint}
				</p>
			)}

			<div className="flex flex-wrap items-center gap-1.5">
				{showPriorityPicker && (
					<TrackerPropertyPicker
						placeholder="Priority"
						value={selectedPriority?.name}
						icon={
							<PriorityGlyph
								bars={
									selectedPriority
										? priorityBars(orderedPriorities, selectedPriority.id)
										: 0
								}
							/>
						}
						searchPlaceholder="Set priority to…"
						options={priorityOptions}
						open={openPicker === "priority"}
						onOpenChange={(open) => setOpenPicker(open ? "priority" : null)}
						onSelect={(id) =>
							onPriorityChange(id === NO_PRIORITY ? null : Number(id))
						}
					/>
				)}

				{showProjectPicker && (
					<TrackerPropertyPicker
						placeholder="Project"
						value={selectedProject?.name}
						icon={
							<Folder
								size={14}
								className="shrink-0 text-neutral-500"
								aria-hidden
							/>
						}
						searchPlaceholder="Set project to…"
						options={projectOptions}
						open={openPicker === "project"}
						onOpenChange={(open) => setOpenPicker(open ? "project" : null)}
						onSelect={(id) =>
							onProjectChange(
								id === NO_PROJECT ? null : Number(id),
								null,
							)
						}
					/>
				)}

				{showPhasePicker && (
					<TrackerPropertyPicker
						placeholder="Phase"
						value={selectedPhase?.name}
						icon={
							<Signpost
								size={14}
								className="shrink-0 text-neutral-500"
								aria-hidden
							/>
						}
						searchPlaceholder="Set phase to…"
						options={phaseOptions}
						open={openPicker === "phase"}
						onOpenChange={(open) => setOpenPicker(open ? "phase" : null)}
						onSelect={(id) =>
							onPhaseChange(id === NO_PHASE ? null : Number(id))
						}
					/>
				)}
			</div>

			{showLabelPicker && (
				<div>
					<span className="text-sm font-medium text-neutral-700">Labels</span>
					<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
						{visibleLabels.map((label) => (
							<span
								key={label.id}
								className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white py-0.5 pr-2 pl-1.5 text-xs text-neutral-600"
							>
								<LabelDot colour={label.colour} />
								{label.name}
							</span>
						))}
						<TrackerPropertyPicker
							placeholder="Add label"
							variant={visibleLabels.length > 0 ? "inline" : "chip"}
							size="compact"
							triggerLabel="Add label"
							icon={
								visibleLabels.length > 0 ? (
									<Plus size={14} className="text-neutral-500" aria-hidden />
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
							open={openPicker === "labels"}
							onOpenChange={(open) => setOpenPicker(open ? "labels" : null)}
							onSelect={(id) =>
								onLabelIdsChange(resolveToggle(labelIds, Number(id)))
							}
							multiple
						/>
					</div>
				</div>
			)}
		</div>
	);
}
