import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { api } from "../api";
import type { PresenceUser } from "../types";
import { useWorkspace } from "./WorkspaceContext";

const HEARTBEAT_INTERVAL_MS = 25_000;
const PRESENCE_REFRESH_MS = 30_000;

interface PresenceContextValue {
	presence: PresenceUser[];
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

export function usePresence(): PresenceContextValue {
	const ctx = useContext(PresenceContext);
	if (!ctx) {
		throw new Error("usePresence must be used within PresenceProvider");
	}
	return ctx;
}

export function PresenceProvider({ children }: { children: ReactNode }) {
	const { activeWorkspaceId } = useWorkspace();
	const [presence, setPresence] = useState<PresenceUser[]>([]);
	const [presenceWorkspaceId, setPresenceWorkspaceId] =
		useState(activeWorkspaceId);

	// Render-phase reset: never paint new workspace id with stale presence.
	if (presenceWorkspaceId !== activeWorkspaceId) {
		setPresenceWorkspaceId(activeWorkspaceId);
		setPresence([]);
	}

	useEffect(() => {
		if (activeWorkspaceId === null) return;

		let active = true;
		const applyPresence = (users: PresenceUser[]) => {
			if (!active) return;
			setPresence(users);
		};

		const beat = () => {
			void api
				.heartbeat(activeWorkspaceId)
				.catch((err) => console.debug("heartbeat failed", err));
			void api
				.getPresence(activeWorkspaceId)
				.then(({ users }) => applyPresence(users))
				.catch((err) => console.debug("presence fetch failed", err));
		};
		beat();
		const heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
		const presenceTimer = setInterval(
			() =>
				void api
					.getPresence(activeWorkspaceId)
					.then(({ users }) => applyPresence(users))
					.catch((err) => console.debug("presence refresh failed", err)),
			PRESENCE_REFRESH_MS,
		);

		return () => {
			active = false;
			clearInterval(heartbeatTimer);
			clearInterval(presenceTimer);
		};
	}, [activeWorkspaceId]);

	const value = useMemo(() => ({ presence }), [presence]);

	return (
		<PresenceContext.Provider value={value}>
			{children}
		</PresenceContext.Provider>
	);
}
