import { X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { useShowToast } from "../../shared/ToastContext";
import type { useBoard } from "./BoardContext";
import { ContextPanelEditor } from "./ContextPanelEditor";
import {
	ActivitySection,
	DangerZone,
	TicketHistorySection,
} from "./ContextPanelSections";
import {
	findCardInColumns,
	getMissingCardRedirect,
	parseCardId,
} from "./cardPanel";
import type { FocusEntryButtonRenderer } from "./contextPanelPrimitives";

/**
 * Route-driven card context panel (/board/card/:id). Slides in from the right
 * over the board on desktop; full-screen below 768px. The card itself is
 * derived from board columns — if the id is invalid or the card disappears,
 * the panel closes and the URL is cleared.
 */
export function ContextPanelSurface({
	board,
	renderFocusEntryButton,
}: {
	board: ReturnType<typeof useBoard>;
	renderFocusEntryButton: FocusEntryButtonRenderer;
}) {
	const { cardId: cardIdParam } = useParams();
	const navigate = useNavigate();
	const { columns, saveCard, deleteCard } = board;
	const showToast = useShowToast();

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
			showToast("This card was deleted.", "info");
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
			showToast("Couldn't delete the card. Try again.", "error");
		}
	}, [cardId, deleteCard, showToast]);

	if (!card) return null;

	const columnTitle =
		columns?.find((c) => c.id === card.columnId)?.title ?? null;

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
					{/* Wayfinding, not identity: the title lives in the Title field a
					    few rows down, so repeating it here said nothing twice. The
					    dialog's accessible name still carries the title. */}
					<h2 className="min-w-0 truncate text-sm font-medium text-neutral-600">
						{card.key && (
							<span className="font-mono tabular-nums text-neutral-900">
								{card.key}
							</span>
						)}
						{card.key && columnTitle && (
							<span className="px-1.5 text-neutral-300" aria-hidden>
								·
							</span>
						)}
						{columnTitle ?? (card.key ? null : "Card details")}
					</h2>
					<button
						onClick={close}
						aria-label="Close panel"
						className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<X size={18} aria-hidden />
					</button>
				</header>
				<ContextPanelEditor
					key={card.id}
					board={board}
					card={card}
					saveCard={saveCard}
					onClose={close}
					renderFocusEntryButton={renderFocusEntryButton}
				>
					<ActivitySection board={board} cardId={card.id} />
					<TicketHistorySection cardId={card.id} />
					<DangerZone onDelete={onDelete} />
				</ContextPanelEditor>
			</aside>
		</>
	);
}
