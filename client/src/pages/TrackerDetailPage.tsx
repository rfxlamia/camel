import { ArrowLeft, Folder, Signpost } from "lucide-react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError, api } from "../api";
import TrackerChangelog from "../components/tracker/TrackerChangelog";
import TrackerDateFields from "../components/tracker/TrackerDateFields";
import {
	type PickerOption,
	TrackerPropertyPicker,
} from "../components/tracker/TrackerPropertyPicker";
import TrackerProperties, {
	type PropertyPatch,
} from "../components/tracker/TrackerProperties";
import { useBoard } from "../context/BoardContext";
import { isTaskOverdue } from "../lib/trackerRollup";
import { resolveToggle } from "../lib/trackerUtils";
import type {
	TrackerEvent,
	TrackerProject,
	TrackerVocabulary,
	WorkItem,
	WorkspaceMember,
} from "../types";
import { updateWorkItem, updateWorkItemStatus } from "../lib/workItemMutations";

type ItemPropertyPatch = PropertyPatch & {
	projectId?: number;
	phaseId?: number | null;
};

function trackerEventKey(
	event: { type: string; payload?: unknown; trackerItemId?: number },
	itemKey: string,
	itemId: number | null,
	itemSource: WorkItem["source"] | null,
): boolean {
	const payload = event.payload as { key?: string } | undefined;
	if (payload?.key) return payload.key === itemKey;
	if (
		event.type.startsWith("card.") &&
		payload?.key &&
		payload.key === itemKey
	) {
		return true;
	}
	if (event.trackerItemId != null && itemId != null && itemSource === "tracker") {
		return event.trackerItemId === itemId;
	}
	return false;
}

/** Grows a borderless textarea to fit its content, so no inner scrollbar shows. */
function autoGrow(el: HTMLTextAreaElement | null) {
	if (!el) return;
	el.style.height = "auto";
	el.style.height = `${el.scrollHeight}px`;
}

export default function TrackerDetailPage() {
	const { key: routeKey } = useParams<{ key: string }>();
	const navigate = useNavigate();
	const {
		activeWorkspaceId,
		showToast,
		refreshTrackerList,
		subscribeTrackerEvents,
	} = useBoard();

	const [item, setItem] = useState<WorkItem | null>(null);
	const [events, setEvents] = useState<TrackerEvent[]>([]);
	const [statuses, setStatuses] = useState<TrackerVocabulary[]>([]);
	const [priorities, setPriorities] = useState<TrackerVocabulary[]>([]);
	const [labels, setLabels] = useState<TrackerVocabulary[]>([]);
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	const [projects, setProjects] = useState<TrackerProject[]>([]);
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [openRailPicker, setOpenRailPicker] = useState<"project" | "phase" | null>(
		null,
	);
	// The server copy is the draft's baseline, so `item` doubles as it. A
	// property PATCH or an SSE refresh moves the baseline without touching the
	// draft — see loadItem.
	const itemRef = useRef<WorkItem | null>(null);
	// Property picks and draft saves share one queue: each PATCH carries a
	// version, so two in flight at once would make the second one conflict.
	const mutationChainRef = useRef<Promise<void>>(Promise.resolve());
	const loadSeqRef = useRef(0);

	const titleRef = useRef<HTMLTextAreaElement>(null);
	const descriptionRef = useRef<HTMLTextAreaElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the draft text is the resize trigger, not a value the effect reads
	useLayoutEffect(() => autoGrow(titleRef.current), [title]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: as above, for the description
	useLayoutEffect(() => autoGrow(descriptionRef.current), [description]);

	const applyItem = useCallback((next: WorkItem) => {
		const prev = itemRef.current;
		itemRef.current = next;
		setItem(next);
		// An unsaved draft survives a refresh; a clean field follows the server.
		setTitle((draft) => (prev && draft !== prev.title ? draft : next.title));
		setDescription((draft) =>
			prev && draft !== (prev.description ?? "")
				? draft
				: (next.description ?? ""),
		);
		setStartDate((draft) =>
			prev && draft !== (prev.startDate ?? "") ? draft : (next.startDate ?? ""),
		);
		setEndDate((draft) =>
			prev && draft !== (prev.endDate ?? "") ? draft : (next.endDate ?? ""),
		);
	}, []);

	const loadItem = useCallback(async () => {
		if (activeWorkspaceId === null || !routeKey) return;
		const seq = ++loadSeqRef.current;
		const workspaceId = activeWorkspaceId;
		const key = routeKey;
		setLoading(true);
		try {
			const [loaded, changelog] = await Promise.all([
				api.getTrackerItem(workspaceId, key),
				api.getTrackerChangelog(workspaceId, key),
			]);

			if (seq !== loadSeqRef.current) return;

			if (loaded.canonicalKey && loaded.redirectFrom) {
				navigate(`/tracker/${loaded.canonicalKey}`, { replace: true });
				return;
			}

			applyItem(loaded);
			setEvents(changelog.events);
		} finally {
			if (seq === loadSeqRef.current) {
				setLoading(false);
			}
		}
	}, [activeWorkspaceId, applyItem, navigate, routeKey]);

	useEffect(() => {
		void loadItem();
	}, [loadItem]);

	// Vocabularies and members feed the property rail only — a failure there
	// hides the pickers rather than breaking the page.
	useEffect(() => {
		if (activeWorkspaceId === null) return;
		let cancelled = false;
		void (async () => {
			try {
				const [statusList, priorityList, labelList, memberList, projectList] =
					await Promise.all([
						api.listTrackerVocabularies(activeWorkspaceId, "status"),
						api.listTrackerVocabularies(activeWorkspaceId, "priority"),
						api.listTrackerVocabularies(activeWorkspaceId, "label"),
						api.getWorkspaceMembers(activeWorkspaceId),
						api.listTrackerProjects(activeWorkspaceId),
					]);
				if (cancelled) return;
				setStatuses(statusList);
				setPriorities(priorityList);
				setLabels(labelList);
				setMembers(memberList.members);
				setProjects(projectList);
			} catch {
				// Rail degrades to read-only.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [activeWorkspaceId]);

	useEffect(() => {
		if (!subscribeTrackerEvents || !item) return;
		return subscribeTrackerEvents((event) => {
			if (!trackerEventKey(event, item.key, item.id, item.source)) return;

			if (event.type === "tracker.deleted") {
				refreshTrackerList();
				navigate("/tracker", { replace: true });
				return;
			}

			if (
				event.type === "tracker.updated" ||
				event.type === "card.updated" ||
				event.type === "card.moved" ||
				event.type === "card.reordered"
			) {
				void loadItem();
			}

			if (event.type === "card.deleted") {
				refreshTrackerList();
				navigate("/tracker", { replace: true });
			}
		});
	}, [subscribeTrackerEvents, item, navigate, refreshTrackerList, loadItem]);

	// Deliberately swallows its own failure: the write it follows already
	// succeeded, so a stale feed must not be reported as a failed save.
	const refreshChangelog = async (key: string) => {
		if (activeWorkspaceId === null) return;
		try {
			const changelog = await api.getTrackerChangelog(activeWorkspaceId, key);
			setEvents(changelog.events);
		} catch {
			// Feed catches up on the next load.
		}
	};

	const resolvePropertyPatch = (
		patch: ItemPropertyPatch,
		current: WorkItem,
	): Record<string, unknown> => {
		const { assigneeToggle, labelToggle, ...rest } = patch;
		const result: Record<string, unknown> = { ...rest };

		if (assigneeToggle !== undefined) {
			const ids = current.assignees.map((a) => a.id);
			result.assigneeIds = resolveToggle(ids, assigneeToggle);
		}
		if (labelToggle !== undefined) {
			const ids = current.labels.map((l) => l.id);
			result.labelIds = resolveToggle(ids, labelToggle);
		}
		return result;
	};

	const enqueueMutation = (task: () => Promise<void>) => {
		mutationChainRef.current = mutationChainRef.current
			.catch(() => {
				// Prior task failed; the queue must stay usable.
			})
			.then(task);
	};

	// Properties commit on pick, matching the list row. The returned item moves
	// the version forward so a later title save does not hit a phantom conflict.
	const changeProperty = (patch: ItemPropertyPatch) => {
		if (activeWorkspaceId === null) return;
		enqueueMutation(async () => {
			const current = itemRef.current;
			if (!current) return;
			const workspaceId = activeWorkspaceId;
			try {
				const resolved = resolvePropertyPatch(patch, current);
				const { statusId, ...rest } = resolved;
				const updated =
					statusId !== undefined && typeof statusId === "number"
						? await updateWorkItemStatus(
								workspaceId,
								current,
								statusId,
								current.version,
							)
						: await updateWorkItem(workspaceId, current, {
								...rest,
								version: current.version,
							} as Parameters<typeof updateWorkItem>[2]);
				applyItem(updated);
				await refreshChangelog(updated.key);
				refreshTrackerList();
			} catch (err) {
				if (err instanceof ApiError && err.code === "version_conflict") {
					showToast(
						"Someone else updated this tracker item first — refreshed.",
						"warning",
					);
					try {
						await loadItem();
					} catch {
						// Refresh failure must not break the mutation queue.
					}
					return;
				}
				showToast(
					"Couldn't save the tracker item. Check your connection and try again.",
					"error",
				);
			}
		});
	};

	const dirty =
		item !== null &&
		(title !== item.title ||
			description !== (item.description ?? "") ||
			startDate !== (item.startDate ?? "") ||
			endDate !== (item.endDate ?? ""));

	const handleSave = () => {
		const current = itemRef.current;
		if (activeWorkspaceId === null || !current || !title.trim()) return;
		const workspaceId = activeWorkspaceId;
		const draftTitle = title;
		const draftDescription = description;
		const draftStartDate = startDate;
		const draftEndDate = endDate;
		setSaving(true);
		enqueueMutation(async () => {
			try {
				const latest = itemRef.current;
				if (!latest) return;
				const patch: {
					title: string;
					description: string;
					version: number;
					startDate?: string | null;
					endDate?: string | null;
				} = {
					title: draftTitle,
					description: draftDescription,
					version: latest.version,
				};
				if (draftStartDate !== (latest.startDate ?? "")) {
					patch.startDate = draftStartDate || null;
				}
				if (draftEndDate !== (latest.endDate ?? "")) {
					patch.endDate = draftEndDate || null;
				}
				const updated = await updateWorkItem(workspaceId, latest, patch);
				itemRef.current = updated;
				setItem(updated);
				setTitle(updated.title);
				setDescription(updated.description ?? "");
				setStartDate(updated.startDate ?? "");
				setEndDate(updated.endDate ?? "");
				await refreshChangelog(updated.key);
				refreshTrackerList();
				setSaveError(null);
				showToast("Tracker item saved", "success");
			} catch (err) {
				if (err instanceof ApiError && err.code === "version_conflict") {
					showToast(
						"Someone else updated this tracker item first — refreshed.",
						"warning",
					);
					try {
						await loadItem();
					} catch {
						// Refresh failure must not break the mutation queue.
					}
					return;
				}
				if (err instanceof ApiError && err.status === 400) {
					setSaveError(err.message);
					return;
				}
				showToast(
					"Couldn't save the tracker item. Check your connection and try again.",
					"error",
				);
			} finally {
				setSaving(false);
			}
		});
	};

	const discardDraft = () => {
		const current = itemRef.current;
		if (!current) return;
		setTitle(current.title);
		setDescription(current.description ?? "");
		setStartDate(current.startDate ?? "");
		setEndDate(current.endDate ?? "");
		setSaveError(null);
	};

	const onDraftKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void handleSave();
		}
	};

	if (activeWorkspaceId === null || !routeKey) return null;

	if (loading && !item) {
		return (
			<p className="px-4 py-16 text-center text-neutral-500 text-sm md:px-6">
				Loading…
			</p>
		);
	}

	if (!item) {
		return (
			<div className="px-4 py-16 text-center md:px-6">
				<p className="text-neutral-600 text-sm">Tracker item not found.</p>
				<button
					type="button"
					onClick={() => navigate("/tracker")}
					className="mt-3 inline-flex items-center gap-1.5 font-medium text-primary-700 text-sm hover:text-primary-800"
				>
					<ArrowLeft size={14} aria-hidden />
					Back to tracker
				</button>
			</div>
		);
	}

	const selectedProject = projects.find((p) => p.id === item.projectId);
	const selectedPhase = selectedProject?.phases.find((p) => p.id === item.phaseId);
	const projectOptions: PickerOption[] = projects.map((p) => ({
		id: String(p.id),
		label: p.name,
		selected: p.id === item.projectId,
	}));
	const phaseOptions: PickerOption[] = (selectedProject?.phases ?? []).map(
		(ph) => ({
			id: String(ph.id),
			label: ph.name,
			selected: ph.id === item.phaseId,
		}),
	);

	return (
		<div className="min-h-full bg-white">
			{/* Breadcrumb only — the item's identity lives in the title below, the
			    way an issue reads as a document rather than a form. */}
			<div className="sticky top-0 z-20 flex h-11 items-center gap-1.5 border-neutral-200 border-b bg-white px-4 md:px-6">
				<button
					type="button"
					onClick={() => navigate("/tracker")}
					className="-ml-1.5 rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					aria-label="Back to tracker"
				>
					<ArrowLeft size={15} aria-hidden />
				</button>
				<button
					type="button"
					onClick={() => navigate("/tracker")}
					className="rounded-md px-1.5 py-1 text-neutral-600 text-sm transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Tracker
				</button>
				<span className="text-neutral-300" aria-hidden>
					/
				</span>
				<span className="px-1.5 font-mono text-neutral-900 text-sm tabular-nums">
					{item.key}
				</span>
			</div>

			<div className="flex flex-col lg:flex-row lg:items-stretch">
				<div className="min-w-0 flex-1">
					<div className="mx-auto max-w-2xl px-4 py-8 md:px-6">
						<label htmlFor="tracker-title" className="sr-only">
							Title
						</label>
						<textarea
							id="tracker-title"
							ref={titleRef}
							value={title}
							rows={1}
							onChange={(e) => setTitle(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
									e.preventDefault();
									return;
								}
								onDraftKeyDown(e);
							}}
							placeholder="Item title"
							className="w-full resize-none overflow-hidden border-0 bg-transparent font-semibold text-[25px] text-neutral-900 leading-[1.25] tracking-tight placeholder:text-neutral-400 focus:outline-none"
						/>

						<label htmlFor="tracker-description" className="sr-only">
							Description
						</label>
						<textarea
							id="tracker-description"
							ref={descriptionRef}
							value={description}
							rows={3}
							onChange={(e) => setDescription(e.target.value)}
							onKeyDown={onDraftKeyDown}
							placeholder="Add a description…"
							className="mt-4 min-h-24 w-full resize-none overflow-hidden border-0 bg-transparent text-[15px] text-neutral-700 leading-relaxed placeholder:text-neutral-400 focus:outline-none"
						/>

						{/* The save affordance exists only while there is something to
						    save, so a read-only visit stays chrome-free. */}
						{dirty && (
							<div className="sticky bottom-0 z-10 mt-4 flex items-center gap-2 border-neutral-200 border-t bg-white/95 py-3 backdrop-blur-sm">
								<span className="text-neutral-500 text-xs">
									Unsaved changes
								</span>
								{saveError && (
									<p
										role="alert"
										className="mr-auto text-error-900 text-sm font-medium"
									>
										{saveError}
									</p>
								)}
								<span className="ml-auto flex items-center gap-1.5">
									<button
										type="button"
										onClick={discardDraft}
										className="rounded-md px-2.5 py-1.5 text-neutral-600 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
									>
										Discard
									</button>
									<button
										type="button"
										onClick={() => void handleSave()}
										disabled={saving || !title.trim()}
										className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none"
									>
										{saving ? "Saving…" : "Save"}
									</button>
								</span>
							</div>
						)}

						{item.source === "board" && (
							<section className="mt-8 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
								<h2 className="font-medium text-[11px] text-neutral-500 uppercase tracking-[0.08em]">
									Board
								</h2>
								<dl className="mt-2 space-y-1 text-sm text-neutral-700">
									{item.columnName && (
										<div className="flex gap-2">
											<dt className="text-neutral-500">Column</dt>
											<dd>{item.columnName}</dd>
										</div>
									)}
									{item.dueDate && (
										<div className="flex gap-2">
											<dt className="text-neutral-500">Due</dt>
											<dd>{item.dueDate}</dd>
										</div>
									)}
								</dl>
								<button
									type="button"
									onClick={() => navigate("/board")}
									className="mt-3 font-medium text-primary-700 text-sm hover:text-primary-800"
								>
									Open on board
								</button>
							</section>
						)}

						<section className="mt-10 border-neutral-200 border-t pt-6">
							<h2 className="mb-4 font-medium text-[11px] text-neutral-500 uppercase tracking-[0.08em]">
								Activity
							</h2>
							<TrackerChangelog events={events} />
						</section>
					</div>
				</div>

				<div className="order-first shrink-0 border-neutral-200 lg:order-none lg:w-[264px] lg:shrink-0 lg:border-l [&>aside]:lg:border-l-0 [&>aside]:lg:w-full">
					<div className="border-neutral-200 border-b px-4 py-4 md:px-6 lg:border-b-0 lg:px-5 lg:pt-6 lg:pb-4">
						<h2 className="font-medium text-[11px] text-neutral-500 uppercase tracking-[0.08em]">
							{item.source === "board" ? "Due date" : "Schedule"}
						</h2>
						<div className="mt-3">
							{item.source === "board" ? (
								<p className="text-neutral-700 text-sm">
									{item.dueDate ?? "No due date"}
								</p>
							) : (
								<>
									<TrackerDateFields
										idPrefix="tracker-detail"
										layout="rail"
										startDate={startDate}
										endDate={endDate}
										onStartDateChange={setStartDate}
										onEndDateChange={setEndDate}
									/>
									{isTaskOverdue(item) && (
										<p
											aria-label="Overdue"
											className="mt-2 font-medium text-error-900 text-xs"
										>
											Overdue
										</p>
									)}
								</>
							)}
						</div>
						{projects.length > 0 && (
							<div className="mt-4 flex flex-col gap-1.5">
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
									open={openRailPicker === "project"}
									onOpenChange={(open) =>
										setOpenRailPicker(open ? "project" : null)
									}
									onSelect={(id) =>
										changeProperty({ projectId: Number(id), phaseId: null })
									}
								/>
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
									open={openRailPicker === "phase"}
									onOpenChange={(open) =>
										setOpenRailPicker(open ? "phase" : null)
									}
									onSelect={(id) => {
										if (item.projectId == null) return;
										changeProperty({
											projectId: item.projectId,
											phaseId: Number(id),
										});
									}}
								/>
							</div>
						)}
					</div>
					<TrackerProperties
						item={item}
						statuses={statuses}
						priorities={priorities}
						labels={labels}
						members={members}
						onChange={changeProperty}
					/>
				</div>
			</div>
		</div>
	);
}
