import { db } from "../db/kysely.js";
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
		const row = await db
			.insertInto("notifications")
			.values({
				user_id: params.userId,
				workspace_id: params.workspaceId,
				type: params.type,
				title: params.title,
				body: params.body ?? null,
				card_id: params.cardId ?? null,
				board_id: params.boardId ?? null,
				actor_id: params.actorId ?? null,
			})
			.returningAll()
			.executeTakeFirst();
		return row ?? null;
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
		const existing = await db
			.selectFrom("notifications")
			.select("id")
			.where("user_id", "=", newMemberId)
			.where("workspace_id", "=", event.workspaceId)
			.where("type", "=", "welcome")
			.limit(1)
			.executeTakeFirst();
		if (!existing) {
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
	void db
		.updateTable("notifications")
		.set({ source_deleted: true })
		.where("card_id", "=", cardId)
		.execute()
		.catch((err) => {
			console.error(
				`Failed to mark notifications source_deleted for card ${cardId}:`,
				err,
			);
		});
}

async function onSystemAlert(event: DomainEvent): Promise<void> {
	const { title, body } = event.payload as { title: string; body?: string };
	const rows = await db
		.selectFrom("workspace_members")
		.select("user_id")
		.where("workspace_id", "=", event.workspaceId)
		.execute();
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
