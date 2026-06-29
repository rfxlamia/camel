import { createContext, type ReactNode, useContext } from "react";
import { useBoard } from "./BoardContext";
import {
	type UseNotificationsResult,
	useNotifications,
} from "../hooks/useNotifications";

const NotificationsContext = createContext<UseNotificationsResult | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
	const { activeWorkspaceId } = useBoard();
	const value = useNotifications(activeWorkspaceId);

	return (
		<NotificationsContext.Provider value={value}>
			{children}
		</NotificationsContext.Provider>
	);
}

export function useNotificationsContext(): UseNotificationsResult {
	const ctx = useContext(NotificationsContext);
	if (!ctx) {
		throw new Error(
			"useNotificationsContext must be used within NotificationsProvider",
		);
	}
	return ctx;
}
