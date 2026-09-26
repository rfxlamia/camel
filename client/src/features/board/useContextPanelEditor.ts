import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { PreparedImagePair } from "../../shared/imageAttachments";
import { useTicketIntakeChat } from "../../shared/useTicketIntakeChat";
import { useWorkspace } from "../../shared/WorkspaceContext";
import type { Card, WorkspaceMember } from "../../types";
import type { SaveCardResult, useBoard } from "./BoardContext";
import {
	assigneeIdsEqual,
	type FocusEntryButtonRenderer,
	labelIdsEqual,
	taxonomyFromCard,
} from "./contextPanelPrimitives";

export interface ContextPanelEditorInput {
	board: ReturnType<typeof useBoard>;
	card: Card;
	renderFocusEntryButton: FocusEntryButtonRenderer;
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
}

export function useContextPanelEditor({
	board,
	card,
	renderFocusEntryButton,
	saveCard,
}: ContextPanelEditorInput) {
	const {
		setHasUnsavedCardEdits,
		activeWorkspaceId,
		ticketIntakeEnabled,
		focusModeEnabled,
	} = useWorkspace();
	const { ticketIntakeEvents, refresh, cancelScheduledRefresh } = board;
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
	const [phaseId, setPhaseId] = useState<number | null>(
		initialTaxonomy.phaseId,
	);
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
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

	const uploadAttachments = useCallback(
		async (pairs: PreparedImagePair[]) => {
			if (activeWorkspaceId === null) {
				throw new Error("Workspace not available");
			}
			const response = await api.uploadCardAttachments(
				activeWorkspaceId,
				card.id,
				pairs,
			);
			cancelScheduledRefresh();
			await refresh();
			return response;
		},
		[activeWorkspaceId, cancelScheduledRefresh, card.id, refresh],
	);

	const deleteAttachment = useCallback(
		async (attachmentId: number) => {
			if (activeWorkspaceId === null) {
				throw new Error("Workspace not available");
			}
			await api.deleteCardAttachment(activeWorkspaceId, card.id, attachmentId);
			cancelScheduledRefresh();
			await refresh();
		},
		[activeWorkspaceId, cancelScheduledRefresh, card.id, refresh],
	);

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
			forceSyncRef.current = true;
			setSyncNonce((n) => n + 1);
		}
	};

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

	const showTaskActions =
		focusModeEnabled || (activeWorkspaceId !== null && ticketIntakeEnabled);

	return {
		activeWorkspaceId,
		assigneeIds,
		assigneeOptions,
		card,
		deleteAttachment,
		description,
		dueDate,
		labelIds,
		openTicketIntake,
		phaseId,
		priorityId,
		projectId,
		renderFocusEntryButton,
		save,
		setAssigneeIds,
		setDescription,
		setDueDate,
		setLabelIds,
		setPhaseId,
		setPriorityId,
		setProjectId,
		showTaskActions,
		ticketIntakeChat,
		ticketIntakeEnabled,
		title,
		setTitle,
		uploadAttachments,
	};
}
