import { ArrowLeft } from "lucide-react";
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
import TrackerProperties, {
	type PropertyPatch,
} from "../components/tracker/TrackerProperties";
import { useBoard } from "../context/BoardContext";
import type {
	TrackerEvent,
	TrackerItem,
	TrackerVocabulary,
	WorkspaceMember,
} from "../types";

function trackerEventKey(
	event: { type: string; payload?: unknown; trackerItemId?: number },
	itemKey: string,
	itemId: number | null,
): boolean {
	const payload = event.payload as { key?: string } | undefined;
	if (payload?.key) return payload.key === itemKey;
	if (event.trackerItemId != null && itemId != null) {
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

	const [item, setItem] = useState<TrackerItem | null>(null);
	const [events, setEvents] = useState<TrackerEvent[]>([]);
	const [statuses, setStatuses] = useState<TrackerVocabulary[]>([]);
	const [priorities, setPriorities] = useState<TrackerVocabulary[]>([]);
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	// The server copy is the draft's baseline, so `item` doubles as it. A
	// property PATCH or an SSE refresh moves the baseline without touching the
	// draft — see loadItem.
	const itemRef = useRef<TrackerItem | null>(null);
	// Property picks are serialised: each PATCH carries a version, so two in
	// flight at once would make the second one conflict with the first.
	const propertyChainRef = useRef<Promise<void>>(Promise.resolve());

	const titleRef = useRef<HTMLTextAreaElement>(null);
	const descriptionRef = useRef<HTMLTextAreaElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the draft text is the resize trigger, not a value the effect reads
	useLayoutEffect(() => autoGrow(titleRef.current), [title]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: as above, for the description
	useLayoutEffect(() => autoGrow(descriptionRef.current), [description]);

	const applyItem = useCallback((next: TrackerItem) => {
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
	}, []);

	const loadItem = useCallback(async () => {
		if (activeWorkspaceId === null || !routeKey) return;
		setLoading(true);
		try {
			const [loaded, changelog] = await Promise.all([
				api.getTrackerItem(activeWorkspaceId, routeKey),
				api.getTrackerChangelog(activeWorkspaceId, routeKey),
			]);

			if (loaded.canonicalKey && loaded.redirectFrom) {
				navigate(`/tracker/${loaded.canonicalKey}`, { replace: true });
				return;
			}

			applyItem(loaded);
			setEvents(changelog.events);
		} finally {
			setLoading(false);
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
				const [statusList, priorityList, memberList] = await Promise.all([
					api.listTrackerVocabularies(activeWorkspaceId, "status"),
					api.listTrackerVocabularies(activeWorkspaceId, "priority"),
					api.getWorkspaceMembers(activeWorkspaceId),
				]);
				if (cancelled) return;
				setStatuses(statusList);
				setPriorities(priorityList);
				setMembers(memberList.members);
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
			if (!trackerEventKey(event, item.key, item.id)) return;

			if (event.type === "tracker.deleted") {
				refreshTrackerList();
				navigate("/tracker", { replace: true });
				return;
			}

			if (event.type === "tracker.updated") {
				void loadItem();
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

	// Properties commit on pick, matching the list row. The returned item moves
	// the version forward so a later title save does not hit a phantom conflict.
	const changeProperty = (patch: PropertyPatch) => {
		if (activeWorkspaceId === null) return;
		propertyChainRef.current = propertyChainRef.current.then(async () => {
			const current = itemRef.current;
			if (!current) return;
			try {
				const updated = await api.updateTrackerItem(
					activeWorkspaceId,
					current.key,
					{ ...patch, version: current.version },
				);
				applyItem(updated);
				await refreshChangelog(updated.key);
				refreshTrackerList();
			} catch (err) {
				if (err instanceof ApiError && err.code === "version_conflict") {
					showToast(
						"Someone else updated this tracker item first — refreshed.",
						"warning",
					);
					await loadItem();
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
		(title !== item.title || description !== (item.description ?? ""));

	const handleSave = async () => {
		const current = itemRef.current;
		if (activeWorkspaceId === null || !current || !title.trim()) return;
		setSaving(true);
		try {
			const updated = await api.updateTrackerItem(
				activeWorkspaceId,
				current.key,
				{ title, description, version: current.version },
			);
			itemRef.current = updated;
			setItem(updated);
			setTitle(updated.title);
			setDescription(updated.description ?? "");
			await refreshChangelog(updated.key);
			refreshTrackerList();
			showToast("Tracker item saved", "success");
		} catch (err) {
			if (err instanceof ApiError && err.code === "version_conflict") {
				showToast(
					"Someone else updated this tracker item first — refreshed.",
					"warning",
				);
				await loadItem();
				return;
			}
			showToast(
				"Couldn't save the tracker item. Check your connection and try again.",
				"error",
			);
		} finally {
			setSaving(false);
		}
	};

	const discardDraft = () => {
		const current = itemRef.current;
		if (!current) return;
		setTitle(current.title);
		setDescription(current.description ?? "");
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

						<section className="mt-10 border-neutral-200 border-t pt-6">
							<h2 className="mb-4 font-medium text-[11px] text-neutral-500 uppercase tracking-[0.08em]">
								Activity
							</h2>
							<TrackerChangelog events={events} />
						</section>
					</div>
				</div>

				<TrackerProperties
					item={item}
					statuses={statuses}
					priorities={priorities}
					members={members}
					onChange={changeProperty}
				/>
			</div>
		</div>
	);
}
