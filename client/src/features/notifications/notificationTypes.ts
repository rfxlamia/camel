export type AppNotificationType =
	| "card_assigned"
	| "due_date_changed"
	| "due_date_reminder"
	| "welcome"
	| "member_joined"
	| "system_alert";

export interface AppNotification {
	id: number;
	type: AppNotificationType;
	title: string;
	body: string | null;
	cardId: number | null;
	boardId?: number | null;
	actorId: number | null;
	readAt: string | null;
	sourceDeleted: boolean;
	createdAt: string;
}

export interface NotificationsResponse {
	notifications: AppNotification[];
	unreadCount: number;
	nextCursor: number | null;
}
