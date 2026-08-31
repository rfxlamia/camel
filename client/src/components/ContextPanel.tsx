import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, type TicketHistoryEntry } from "../api";
import { type SaveCardResult, useBoard } from "../context/BoardContext";
import { useTicketIntakeChat } from "../hooks/useTicketIntakeChat";
import {
	describeCardEvent,
	findCardInColumns,
	getMissingCardRedirect,
	parseCardId,
} from "../lib/cardPanel";
import type { ActivityEvent, Card, WorkspaceMember } from "../types";
import { formatRelativeTime } from "../types";
import { AssigneePicker } from "./AssigneePicker";
import BoardCardTaxonomyFields from "./BoardCardTaxonomyFields";
import { TicketIntakeChatOverlay } from "./ticketIntake/TicketIntakeChatOverlay";

const inputClass =
	"mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

function issueIdentifierFromUrl(issueUrl: string): string {
	const segment = issueUrl.split("/").pop();
	return segment ?? issueUrl;
}

function assigneeIdsEqual(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false;
	const sortedA = [...a].sort((x, y) => x - y);
	const sortedB = [...b].sort((x, y) => x - y);
	return sortedA.every((id, i) => id === sortedB[i]);
}

function labelIdsEqual(a: number[], b: number[]): boolean {
	return assigneeIdsEqual(a, b);
}

interface TaxonomyBaseline {
	priorityId: number | null;
	labelIds: number[];
	projectId: number | null;
	phaseId: number | null;
}

function taxonomyFromCard(card: Card): TaxonomyBaseline {
	return {
		priorityId: card.priority?.id ?? null,
		labelIds: (card.labels ?? []).map((l) => l.id),
		projectId: card.projectId ?? null,
		phaseId: card.phaseId ?? null,
	};
}

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
		patch: {
			title?: string;
			description?: string;
			assigneeIds?: number[];
			dueDate?: string | null;
			priorityId?: number | null;
			labelIds?: number[];
			projectId?: number | null;
			phaseId?: number | null;
			version?: number;
		},
	) => Promise<SaveCardResult>;
	onDelete: () => Promise<void>;
	onClose: () => void;
}) {
	const { setHasUnsavedCardEdits, activeWorkspaceId, ticketIntakeEnabled, ticketIntakeEvents } =
		useBoard();
	const [title, setTitle] = useState(card.title);
	const [description, setDescription] = useState(card.description);
	const [assigneeIds, setAssigneeIds] = useState<number[]>(
		card.assignees.map((a) => a.id),
	);
	const [dueDate, setDueDate] = useState<string | null>(card.dueDate);
	const initialTaxonomy = taxonomyFromCard(card);
	const [priorityId, setPriorityId] = useState<number | null>(
		initialTaxonomy.priorityId,
	);
	const [labelIds, setLabelIds] = useState<number[]>(initialTaxonomy.labelIds);
	const [projectId, setProjectId] = useState<number | null>(
		initialTaxonomy.projectId,
	);
	const [phaseId, setPhaseId] = useState<number | null>(initialTaxonomy.phaseId);
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	// Card snapshot the draft is based on — "dirty" means the draft differs
	// from it, and a dirty draft is never overwritten by a teammate's refresh.
	// Save sends the baseline version (not the live one), so a concurrent edit
	// still surfaces as a 409 even though SSE already refreshed the board.
	const baselineRef = useRef({
		title: card.title,
		description: card.description,
		assigneeIds: card.assignees.map((a) => a.id),
		dueDate: card.dueDate,
		...initialTaxonomy,
		version: card.version,
	});
	const forceSyncRef = useRef(false);
	const [_syncNonce, setSyncNonce] = useState(0);
	const ticketIntakeChat = useTicketIntakeChat({
		workspaceId: activeWorkspaceId,
		variant: "card",
		ticketIntakeEvents,
	});
	const { open: openTicketIntake } = ticketIntakeChat;

	// Workspace members populate the assignee picker.
	useEffect(() => {
		if (activeWorkspaceId === null) return;
		let active = true;
		api
			.getWorkspaceMembers(activeWorkspaceId)
			.then(({ members }) => {
				if (active) setMembers(members);
			})
			.catch((err) => console.warn("assignee list fetch failed", err));
		return () => {
			active = false;
		};
	}, [activeWorkspaceId]);

	const cardAssigneeKey = card.assignees
		.map((a) => a.id)
		.sort((a, b) => a - b)
		.join(",");
	const cardTaxonomyKey = [
		card.priority?.id ?? "none",
		(card.labels ?? [])
			.map((l) => l.id)
			.sort((a, b) => a - b)
			.join(","),
		card.projectId ?? "none",
		card.phaseId ?? "none",
	].join("|");

	// Re-sync the form from the server card ONLY when the server card changes
	// (card.* / version). The draft title/description/assigneeIds/dueDate are read
	// solely to decide whether to skip the sync (never overwrite in-progress edits) —
	// they are deliberately NOT triggers. Server assignee changes are tracked via the
	// stable `cardAssigneeKey` string rather than `card.assignees` array identity.
	// Both behaviors are covered by ContextPanel.test.tsx ("server→form sync").
	// biome-ignore lint/correctness/useExhaustiveDependencies: draft state is read to gate the sync, not to trigger it — see comment above.
	useEffect(() => {
		const base = baselineRef.current;
		const dirty =
			title !== base.title ||
			description !== base.description ||
			!assigneeIdsEqual(assigneeIds, base.assigneeIds) ||
			dueDate !== base.dueDate ||
			priorityId !== base.priorityId ||
			!labelIdsEqual(labelIds, base.labelIds) ||
			projectId !== base.projectId ||
			phaseId !== base.phaseId;
		if (dirty && !forceSyncRef.current) return;
		forceSyncRef.current = false;
		const nextAssigneeIds = card.assignees.map((a) => a.id);
		const nextTaxonomy = taxonomyFromCard(card);
		baselineRef.current = {
			title: card.title,
			description: card.description,
			assigneeIds: nextAssigneeIds,
			dueDate: card.dueDate,
			...nextTaxonomy,
			version: card.version,
		};
		if (title !== card.title) setTitle(card.title);
		if (description !== card.description) setDescription(card.description);
		if (!assigneeIdsEqual(assigneeIds, nextAssigneeIds)) {
			setAssigneeIds(nextAssigneeIds);
		}
		if (dueDate !== card.dueDate) setDueDate(card.dueDate);
		if (priorityId !== nextTaxonomy.priorityId) {
			setPriorityId(nextTaxonomy.priorityId);
		}
		if (!labelIdsEqual(labelIds, nextTaxonomy.labelIds)) {
			setLabelIds(nextTaxonomy.labelIds);
		}
		if (projectId !== nextTaxonomy.projectId) {
			setProjectId(nextTaxonomy.projectId);
		}
		if (phaseId !== nextTaxonomy.phaseId) setPhaseId(nextTaxonomy.phaseId);
	}, [
		card.title,
		card.description,
		cardAssigneeKey,
		cardTaxonomyKey,
		card.dueDate,
		card.version,
	]);

	useEffect(() => {
		const base = baselineRef.current;
		const dirty =
			title !== base.title ||
			description !== base.description ||
			!assigneeIdsEqual(assigneeIds, base.assigneeIds) ||
			dueDate !== base.dueDate ||
			priorityId !== base.priorityId ||
			!labelIdsEqual(labelIds, base.labelIds) ||
			projectId !== base.projectId ||
			phaseId !== base.phaseId;
		setHasUnsavedCardEdits(dirty);
		return () => setHasUnsavedCardEdits(false);
	}, [
		title,
		description,
		assigneeIds,
		dueDate,
		priorityId,
		labelIds,
		projectId,
		phaseId,
		setHasUnsavedCardEdits,
	]);

	const save = async () => {
		const trimmed = title.trim();
		if (trimmed === "") return;
		const base = baselineRef.current;
		const patch: {
			title: string;
			description: string;
			assigneeIds?: number[];
			dueDate?: string | null;
			priorityId?: number | null;
			labelIds?: number[];
			projectId?: number | null;
			phaseId?: number | null;
			version?: number;
		} = { title: trimmed, description, version: base.version };
		if (!assigneeIdsEqual(assigneeIds, base.assigneeIds)) {
			patch.assigneeIds = assigneeIds;
		}
		if (dueDate !== base.dueDate) patch.dueDate = dueDate;
		if (priorityId !== base.priorityId) patch.priorityId = priorityId;
		if (!labelIdsEqual(labelIds, base.labelIds)) patch.labelIds = labelIds;
		if (projectId !== base.projectId) patch.projectId = projectId;
		if (phaseId !== base.phaseId) patch.phaseId = phaseId;
		const result = await saveCard(card.id, patch);
		if (result === "saved") {
			baselineRef.current = {
				...baselineRef.current,
				title: trimmed,
				description,
				assigneeIds,
				dueDate,
				priorityId,
				labelIds,
				projectId,
				phaseId,
			};
			setTitle(trimmed);
		} else if (result === "conflict") {
			// The board already refreshed to the latest version — adopt it.
			forceSyncRef.current = true;
			setSyncNonce((n) => n + 1);
		}
	};

	// Keep current assignees selectable even if they've since left the workspace.
	const assigneeOptions = [...members];
	for (const assignee of card.assignees) {
		if (!assigneeOptions.some((m) => m.userId === assignee.id)) {
			assigneeOptions.unshift({
				userId: assignee.id,
				username: assignee.username,
				displayName: assignee.displayName,
				role: "member",
			});
		}
	}

	return (
		<section aria-label="Details" className="space-y-3 px-4 py-4">
			<h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
				Details
			</h3>
			<label className="block sm:max-w-44">
				<span className="text-sm font-medium text-neutral-700">Due date</span>
				<input
					type="date"
					className={inputClass}
					value={dueDate ?? ""}
					onChange={(e) =>
						setDueDate(e.target.value === "" ? null : e.target.value)
					}
				/>
			</label>
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
				<span className="text-sm font-medium text-neutral-700">Assignees</span>
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
					priority={card.priority}
					labels={card.labels}
					onPriorityChange={setPriorityId}
					onLabelIdsChange={setLabelIds}
					onProjectChange={(nextProjectId, nextPhaseId) => {
						setProjectId(nextProjectId);
						setPhaseId(nextPhaseId);
					}}
					onPhaseChange={setPhaseId}
				/>
			)}

			<dl className="space-y-1 rounded-md border border-neutral-200 bg-neutral-100 px-3 py-2">
				<MetaRow label="Created" value={card.createdAt} />
				<MetaRow label="Started" value={card.startedAt} />
				<MetaRow label="Done" value={card.doneAt} />
			</dl>

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
					className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Report issue
				</button>
			)}

			{ticketIntakeEnabled && (
				<TicketIntakeChatOverlay
					chat={ticketIntakeChat}
					onClose={ticketIntakeChat.close}
					ariaLabel="Report issue from card"
				/>
			)}

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

function TicketHistorySection({ cardId }: { cardId: number }) {
	const { activeWorkspaceId } = useBoard();
	const [tickets, setTickets] = useState<TicketHistoryEntry[] | null>(null);

	useEffect(() => {
		if (activeWorkspaceId === null) return;
		let active = true;
		api.ticketIntake
			.getHistory(activeWorkspaceId, cardId)
			.then(({ tickets: history }) => {
				if (active) setTickets(history);
			})
			.catch((err) => console.warn("ticket history fetch failed", err));
		return () => {
			active = false;
		};
	}, [activeWorkspaceId, cardId]);

	return (
		<section
			aria-label="Ticket history"
			className="border-t border-neutral-200 px-4 py-4"
		>
			<h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
				Ticket history
			</h3>
			{tickets === null && (
				<p className="mt-3 text-sm text-neutral-500">Loading ticket history...</p>
			)}
			{tickets !== null && tickets.length === 0 && (
				<p className="mt-3 text-sm text-neutral-500">No tickets reported yet.</p>
			)}
			{tickets !== null && tickets.length > 0 && (
				<ol className="mt-3 divide-y divide-neutral-100">
					{tickets.map((ticket) => (
						<li
							key={ticket.issueUrl}
							className="flex items-baseline justify-between gap-4 py-2.5"
						>
							<span className="min-w-0 text-sm leading-snug text-neutral-700">
								<span className="font-medium text-neutral-900">
									{ticket.title}
								</span>{" "}
								<a
									href={ticket.issueUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-primary-600 hover:text-primary-700 hover:underline"
								>
									{issueIdentifierFromUrl(ticket.issueUrl)}
								</a>
							</span>
							<time
								dateTime={ticket.createdAt}
								className="shrink-0 tabular-nums text-xs text-neutral-400"
							>
								{formatRelativeTime(ticket.createdAt)}
							</time>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

function ActivitySection({ cardId }: { cardId: number }) {
	const { activeWorkspaceId } = useBoard();
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
			.catch((err) => console.warn("card activity fetch failed", err));
		return () => {
			active = false;
		};
	}, [activeWorkspaceId, cardId]);

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
				<ol className="mt-3 divide-y divide-neutral-100">
					{events.map((e) => (
						<li
							key={e.id}
							className="flex items-baseline justify-between gap-4 py-2.5"
						>
							<span className="min-w-0 text-sm leading-snug text-neutral-700">
								<span className="font-medium text-neutral-900">
									{e.actor?.displayName ?? "Someone"}
								</span>{" "}
								{describeCardEvent(e)}
							</span>
							<time
								dateTime={e.createdAt}
								className="shrink-0 tabular-nums text-xs text-neutral-400"
							>
								{formatRelativeTime(e.createdAt)}
							</time>
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
	const { columns, saveCard, deleteCard, showToast } = useBoard();

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
					<TicketHistorySection cardId={card.id} />
				</div>
			</aside>
		</>
	);
}
