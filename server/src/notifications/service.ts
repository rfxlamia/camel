import { pool } from "../db/pool.js";
import { domainBus, EVENTS, type DomainEvent } from "../events.js";

type PushFn = (
	userId: number,
	workspaceId: number,
	notification: Record<string, unknown>,
) => void;
let pushFn: PushFn = () => undefined;

export function registerPush(fn: PushFn): void {
	pushFn = fn;
}

async function insertNotification(params: {
	userId: number;
	workspaceId: number;
	type: string;
	title: string;
	body?: string;
	cardId?: number | null;
	boardId?: number | null;
	actorId?: number | null;
}): Promise<Record<string, unknown> | null> {
	try {
		const { rows } = await pool.query(
			`INSERT INTO notifications (user_id, workspace_id, type, title, body, card_id, board_id, actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
			[
				params.userId,
				params.workspaceId,
				params.type,
				params.title,
				params.body ?? null,
				params.cardId ?? null,
				params.boardId ?? null,
				params.actorId ?? null,
			],
		);
		return rows[0] ?? null;
	} catch (err) {
		console.error(
			`Failed to insert notification (type=${params.type}, user=${params.userId}):`,
			err,
		);
		return null;
	}
}

function onCardAssigned(event: DomainEvent): void {
	const { assigneeId, cardId, cardTitle, actorDisplayName } = event.payload as {
		assigneeId: number | null;
		cardId: number;
		cardTitle: string;
		actorDisplayName: string;
	};
	if (!assigneeId || assigneeId === event.actorId) return;
	void insertNotification({
		userId: assigneeId,
		workspaceId: event.workspaceId,
		type: "card_assigned",
		title: `${actorDisplayName} assigned '${cardTitle}' to you`,
		cardId,
		boardId: event.workspaceId,
		actorId: event.actorId,
	}).then((n) => n && pushFn(assigneeId, event.workspaceId, n));
}

function onCardDueDateChanged(event: DomainEvent): void {
	const { assigneeId, cardId, cardTitle, actorDisplayName, oldDueDate, newDueDate } =
		event.payload as {
			assigneeId: number | null;
			cardId: number;
			cardTitle: string;
			actorDisplayName: string;
			oldDueDate: string | null;
			newDueDate: string | null;
		};
	if (!assigneeId || assigneeId === event.actorId) return;
	const title = !newDueDate
		? `${actorDisplayName} removed due date from '${cardTitle}'`
		: oldDueDate
			? `${actorDisplayName} changed due date of '${cardTitle}' from ${oldDueDate} to ${newDueDate}`
			: `${actorDisplayName} set due date of '${cardTitle}' to ${newDueDate}`;
	void insertNotification({
		userId: assigneeId,
		workspaceId: event.workspaceId,
		type: "due_date_changed",
		title,
		cardId,
		boardId: event.workspaceId,
		actorId: event.actorId,
	}).then((n) => n && pushFn(assigneeId, event.workspaceId, n));
}

function onCardDueDateRemoved(event: DomainEvent): void {
	onCardDueDateChanged({
		...event,
		payload: { ...event.payload, newDueDate: null },
	});
}

function onMemberJoined(event: DomainEvent): void {
	const { newMemberId, newMemberDisplayName, workspaceName, existingMemberIds } =
		event.payload as {
			newMemberId: number;
			newMemberDisplayName: string;
			workspaceName: string;
			existingMemberIds: number[];
		};
	void (async () => {
		const { rows } = await pool.query(
			`SELECT id FROM notifications
         WHERE user_id = $1 AND workspace_id = $2 AND type = 'welcome'
         LIMIT 1`,
			[newMemberId, event.workspaceId],
		);
		if (rows.length === 0) {
			const n = await insertNotification({
				userId: newMemberId,
				workspaceId: event.workspaceId,
				type: "welcome",
				title: `Welcome to ${workspaceName}! Start by exploring the board.`,
			});
			if (n) pushFn(newMemberId, event.workspaceId, n);
		}
	})();
	for (const memberId of existingMemberIds) {
		if (memberId === newMemberId) continue;
		void insertNotification({
			userId: memberId,
			workspaceId: event.workspaceId,
			type: "member_joined",
			title: `${newMemberDisplayName} joined ${workspaceName}`,
			actorId: newMemberId,
		}).then((n) => n && pushFn(memberId, event.workspaceId, n));
	}
}

function onCardDeleted(event: DomainEvent): void {
	const { cardId } = event.payload as { cardId: number };
	void pool
		.query(
			"UPDATE notifications SET source_deleted = true WHERE card_id = $1",
			[cardId],
		)
		.catch((err) => {
			console.error(
				`Failed to mark notifications source_deleted for card ${cardId}:`,
				err,
			);
		});
}

async function onSystemAlert(event: DomainEvent): Promise<void> {
	const { title, body } = event.payload as { title: string; body?: string };
	const { rows } = await pool.query(
		"SELECT user_id FROM workspace_members WHERE workspace_id = $1",
		[event.workspaceId],
	);
	for (const row of rows) {
		const n = await insertNotification({
			userId: row.user_id,
			workspaceId: event.workspaceId,
			type: "system_alert",
			title,
			body,
			actorId: event.actorId,
		});
		if (n) pushFn(row.user_id, event.workspaceId, n);
	}
}

const onSystemAlertHandler = (event: DomainEvent): void => {
	void onSystemAlert(event);
};

export function initNotificationService(): () => void {
	domainBus.on(EVENTS.CARD_ASSIGNED, onCardAssigned);
	domainBus.on(EVENTS.CARD_DUE_DATE_CHANGED, onCardDueDateChanged);
	domainBus.on(EVENTS.CARD_DUE_DATE_REMOVED, onCardDueDateRemoved);
	domainBus.on(EVENTS.MEMBER_JOINED, onMemberJoined);
	domainBus.on(EVENTS.CARD_DELETED, onCardDeleted);
	domainBus.on(EVENTS.SYSTEM_ALERT, onSystemAlertHandler);
	return () => {
		domainBus.off(EVENTS.CARD_ASSIGNED, onCardAssigned);
		domainBus.off(EVENTS.CARD_DUE_DATE_CHANGED, onCardDueDateChanged);
		domainBus.off(EVENTS.CARD_DUE_DATE_REMOVED, onCardDueDateRemoved);
		domainBus.off(EVENTS.MEMBER_JOINED, onMemberJoined);
		domainBus.off(EVENTS.CARD_DELETED, onCardDeleted);
		domainBus.off(EVENTS.SYSTEM_ALERT, onSystemAlertHandler);
	};
}
