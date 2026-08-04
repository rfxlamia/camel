import { ArrowLeft, ListTodo } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError } from "../api";
import PageHeader from "../components/PageHeader";
import TrackerChangelog from "../components/tracker/TrackerChangelog";
import { useBoard } from "../context/BoardContext";
import type { TrackerEvent, TrackerItem } from "../types";

const inputClass =
	"mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

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
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const baselineRef = useRef({ title: "", description: "", version: 0 });

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

			setItem(loaded);
			setTitle(loaded.title);
			setDescription(loaded.description ?? "");
			baselineRef.current = {
				title: loaded.title,
				description: loaded.description ?? "",
				version: loaded.version,
			};
			setEvents(changelog.events);
		} finally {
			setLoading(false);
		}
	}, [activeWorkspaceId, navigate, routeKey]);

	useEffect(() => {
		void loadItem();
	}, [loadItem]);

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

	const handleSave = async () => {
		if (activeWorkspaceId === null || !item) return;
		setSaving(true);
		try {
			const updated = await api.updateTrackerItem(
				activeWorkspaceId,
				item.key,
				{
					title,
					description,
					version: baselineRef.current.version,
				},
			);
			setItem(updated);
			setTitle(updated.title);
			setDescription(updated.description ?? "");
			baselineRef.current = {
				title: updated.title,
				description: updated.description ?? "",
				version: updated.version,
			};
			const changelog = await api.getTrackerChangelog(
				activeWorkspaceId,
				updated.key,
			);
			setEvents(changelog.events);
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

	if (activeWorkspaceId === null || !routeKey) return null;

	if (loading && !item) {
		return (
			<div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
				<div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
					Loading…
				</div>
			</div>
		);
	}

	if (!item) {
		return (
			<div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
				<p className="text-sm text-neutral-600">Tracker item not found.</p>
				<button
					type="button"
					onClick={() => navigate("/tracker")}
					className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:text-primary-800"
				>
					<ArrowLeft size={14} aria-hidden />
					Back to tracker
				</button>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
			<PageHeader
				icon={ListTodo}
				title={item.key}
				subtitle={item.status.name}
				actions={
					<button
						type="button"
						onClick={() => navigate("/tracker")}
						className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<ArrowLeft size={14} aria-hidden />
						Back
					</button>
				}
			/>

			<div className="mt-6 space-y-6">
				<section className="rounded-lg border border-neutral-200 bg-white p-5">
					<div>
						<label
							htmlFor="tracker-title"
							className="text-sm font-medium text-neutral-700"
						>
							Title
						</label>
						<input
							id="tracker-title"
							type="text"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							className={inputClass}
						/>
					</div>
					<div className="mt-4">
						<label
							htmlFor="tracker-description"
							className="text-sm font-medium text-neutral-700"
						>
							Description
						</label>
						<textarea
							id="tracker-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={4}
							className={inputClass}
						/>
					</div>
					<div className="mt-4 flex justify-end">
						<button
							type="button"
							onClick={() => void handleSave()}
							disabled={saving}
							className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60"
						>
							{saving ? "Saving…" : "Save"}
						</button>
					</div>
				</section>

				<section>
					<h2 className="mb-3 text-sm font-semibold text-neutral-900">
						Changelog
					</h2>
					<TrackerChangelog events={events} />
				</section>
			</div>
		</div>
	);
}
