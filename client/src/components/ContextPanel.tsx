import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { X } from "lucide-react";
import { api } from "../api";
import type { ActivityEvent, Card } from "../types";
import { formatRelativeTime } from "../types";
import { useBoard, type SaveCardResult } from "../context/BoardContext";
import {
	describeCardEvent,
	findCardInColumns,
	getMissingCardRedirect,
	parseCardId,
} from "../lib/cardPanel";
import { ToolTrace } from "./ToolTrace";

const inputClass =
	"mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

function MetaRow({ label, value }: { label: string; value: string | null }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<dt className="text-sm text-neutral-600">{label}</dt>
			<dd className="text-sm text-neutral-800">
				{value ? formatRelativeTime(value) : "—"}
			</dd>
		</div>
	);
}

function DetailsSection({
	card,
	saveCard,
	onDelete,
	onClose,
}: {
	card: Card;
	saveCard: (
		id: number,
		patch: { title?: string; description?: string; version?: number },
	) => Promise<SaveCardResult>;
	onDelete: () => Promise<void>;
	onClose: () => void;
}) {
	const { setHasUnsavedCardEdits } = useBoard();
	const [title, setTitle] = useState(card.title);
	const [description, setDescription] = useState(card.description);
	// Card snapshot the draft is based on — "dirty" means the draft differs
	// from it, and a dirty draft is never overwritten by a teammate's refresh.
	// Save sends the baseline version (not the live one), so a concurrent edit
	// still surfaces as a 409 even though SSE already refreshed the board.
	const baselineRef = useRef({
		title: card.title,
		description: card.description,
		version: card.version,
	});
	const forceSyncRef = useRef(false);
	const [syncNonce, setSyncNonce] = useState(0);

	useEffect(() => {
		const base = baselineRef.current;
		const dirty = title !== base.title || description !== base.description;
		if (dirty && !forceSyncRef.current) return;
		forceSyncRef.current = false;
		baselineRef.current = {
			title: card.title,
			description: card.description,
			version: card.version,
		};
		setTitle(card.title);
		setDescription(card.description);
	}, [
		card.title,
		card.description,
		card.version,
		title,
		description,
		syncNonce,
	]);

	useEffect(() => {
		const base = baselineRef.current;
		const dirty = title !== base.title || description !== base.description;
		setHasUnsavedCardEdits(dirty);
		return () => setHasUnsavedCardEdits(false);
	}, [title, description, setHasUnsavedCardEdits]);

	const save = async () => {
		const trimmed = title.trim();
		if (trimmed === "") return;
		const result = await saveCard(card.id, {
			title: trimmed,
			description,
			version: baselineRef.current.version,
		});
		if (result === "saved") {
			baselineRef.current = {
				...baselineRef.current,
				title: trimmed,
				description,
			};
			setTitle(trimmed);
		} else if (result === "conflict") {
			// The board already refreshed to the latest version — adopt it.
			forceSyncRef.current = true;
			setSyncNonce((n) => n + 1);
		}
	};

	return (
		<section aria-label="Details" className="space-y-3 px-4 py-4">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
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

			<dl className="space-y-1 rounded-md border border-neutral-200 bg-neutral-100 px-3 py-2">
				<MetaRow label="Created" value={card.createdAt} />
				<MetaRow label="Started" value={card.startedAt} />
				<MetaRow label="Done" value={card.doneAt} />
			</dl>

			<div className="flex items-center justify-between pt-1">
				<button
					onClick={() => void onDelete()}
					className="rounded-md px-3 py-1.5 text-sm font-medium text-error-500 hover:bg-error-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Delete card
				</button>
				<div className="flex gap-2">
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
			</div>
		</section>
	);
}

function ActivitySection({ cardId }: { cardId: number }) {
	const { activeWorkspaceId, refreshTick } = useBoard();
	const [events, setEvents] = useState<ActivityEvent[] | null>(null);

	// Fetched on open and after every board refresh, so teammate changes show
	// up through the existing SSE → refresh model.
	useEffect(() => {
		if (activeWorkspaceId === null) return;
		let active = true;
		api
			.getCardActivity(activeWorkspaceId, cardId)
			.then(({ events }) => {
				if (active) setEvents(events);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [activeWorkspaceId, cardId, refreshTick]);

	return (
		<section
			aria-label="Activity"
			className="border-t border-neutral-200 px-4 py-4"
		>
			<h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
				Activity
			</h3>
			{events === null && (
				<p className="mt-3 text-sm text-neutral-500">Loading activity...</p>
			)}
			{events !== null && events.length === 0 && (
				<p className="mt-3 text-sm text-neutral-500">No activity yet.</p>
			)}
			{events !== null && events.length > 0 && (
				<ol className="mt-3 space-y-2.5">
					{events.map((e) => (
						<li key={e.id} className="text-sm text-neutral-800">
							<span className="font-medium text-neutral-900">
								{e.actor?.displayName ?? "Someone"}
							</span>{" "}
							{describeCardEvent(e)}
							<span className="text-neutral-500">
								{" "}
								· {formatRelativeTime(e.createdAt)}
							</span>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

/**
 * Route-driven card context panel (/board/card/:id). Slides in from the right
 * over the board on desktop; full-screen below 768px. The card itself is
 * derived from board columns — if the id is invalid or the card disappears,
 * the panel closes and the URL is cleared.
 */
export default function ContextPanel() {
	const { cardId: cardIdParam } = useParams();
	const navigate = useNavigate();
	const { columns, saveCard, deleteCard, showToast, toolTrace } = useBoard();

	const cardId = parseCardId(cardIdParam);
	const card = findCardInColumns(columns, cardId);
	const hadCardRef = useRef(false);
	const selfDeleteRef = useRef(false);

	// Single close rule: once the board is loaded, a panel whose card is not in
	// columns closes. Covers invalid ids (R1.3), teammate deletes (R4.3), and
	// SSE-drop staleness. Toast only if the panel was actually showing the card.
	useEffect(() => {
		if (columns === null) return;
		if (card) {
			hadCardRef.current = true;
			return;
		}
		if (hadCardRef.current && !selfDeleteRef.current) {
			showToast("This card was deleted.");
			navigate("/board", { replace: true });
			return;
		}
		const redirect = getMissingCardRedirect({
			cardId,
			boardLoaded: true,
			cardFound: false,
		});
		if (redirect) {
			navigate(redirect.to, { replace: redirect.replace });
		}
	}, [cardId, columns, card, navigate, showToast]);

	const close = useCallback(() => navigate("/board"), [navigate]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [close]);

	const onDelete = useCallback(async () => {
		if (cardId === null) return;
		selfDeleteRef.current = true;
		try {
			await deleteCard(cardId);
			// The refresh inside deleteCard removed the card from columns; the
			// effect above closes the panel silently.
		} catch {
			selfDeleteRef.current = false;
			showToast("Couldn't delete the card. Try again.");
		}
	}, [cardId, deleteCard, showToast]);

	if (!card) return null;

	return (
		<>
			{/* Transparent click-capture layer: a click on the board area closes
          the panel (R4.4) and locks background interaction while open. */}
			<div
				className="fixed inset-0 z-30 overscroll-none"
				onClick={close}
				aria-hidden
			/>
			<aside
				role="dialog"
				aria-label={`Card details: ${card.title}`}
				className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-neutral-200 bg-white shadow-lg animate-panel-in motion-reduce:animate-none md:w-104"
			>
				<header className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
					<h2 className="min-w-0 truncate text-md font-semibold text-neutral-900">
						{card.title}
					</h2>
					<button
						onClick={close}
						aria-label="Close panel"
						className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<X size={18} aria-hidden />
					</button>
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
					<DetailsSection
						key={card.id}
						card={card}
						saveCard={saveCard}
						onDelete={onDelete}
						onClose={close}
					/>
					<ActivitySection cardId={card.id} />
					{toolTrace && toolTrace.length > 0 && (
						<section
							aria-label="Tool Trace"
							className="border-t border-neutral-200 px-4 py-4"
						>
							<h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
								Tool Activity
							</h3>
							<div className="mt-3">
								<ToolTrace steps={toolTrace} />
							</div>
						</section>
					)}
				</div>
			</aside>
		</>
	);
}
