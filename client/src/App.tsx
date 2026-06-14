import { useEffect, useState } from "react";
import { Navigate, RouterProvider, createBrowserRouter } from "react-router";
import { api } from "./api";
import type { User } from "./types";
import AuthPage from "./components/AuthPage";
import ContextPanel from "./components/ContextPanel";
import LoadingCamel from "./components/LoadingCamel";
import { BoardProvider, useBoard } from "./context/BoardContext";
import AppLayout from "./layout/AppLayout";
import ActivityPage from "./pages/ActivityPage";
import BoardPage from "./pages/BoardPage";
import SettingsPage from "./pages/SettingsPage";

function LoadingScreen() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-2">
			<LoadingCamel size={200} />
			<p className="text-sm text-neutral-500">Loading...</p>
		</div>
	);
}

// Dashboard loads lazily so Recharts stays out of the initial bundle.
const router = createBrowserRouter([
	{
		path: "/",
		Component: AppLayout,
		HydrateFallback: LoadingScreen,
		children: [
			{ index: true, element: <Navigate to="/board" replace /> },
			{
				path: "board",
				Component: BoardPage,
				children: [{ path: "card/:cardId", Component: ContextPanel }],
			},
			{
				path: "dashboard",
				lazy: async () => ({
					Component: (await import("./pages/DashboardPage")).default,
				}),
			},
			{
				path: "agent",
				lazy: async () => ({
					Component: (await import("./pages/AgentPage")).default,
				}),
			},
			{
				path: "history",
				lazy: async () => ({
					Component: (await import("./pages/HistoryPage")).default,
				}),
			},
			{ path: "activity", Component: ActivityPage },
			{ path: "settings", Component: SettingsPage },
			{ path: "*", element: <Navigate to="/board" replace /> },
		],
	},
]);

function AuthenticatedApp() {
	const { workspacesReady } = useBoard();

	if (!workspacesReady) return <LoadingScreen />;

	return <RouterProvider router={router} />;
}

export default function App() {
	const [user, setUser] = useState<User | null>(null);
	const [authChecked, setAuthChecked] = useState(false);

	// Session check on first load.
	useEffect(() => {
		api
			.me()
			.then(({ user }) => setUser(user))
			.catch(() => setUser(null))
			.finally(() => setAuthChecked(true));
	}, []);

	if (!authChecked) return <LoadingScreen />;
	if (!user) return <AuthPage onAuth={setUser} />;

	return (
		<BoardProvider user={user} onSignedOut={() => setUser(null)}>
			<AuthenticatedApp />
		</BoardProvider>
	);
}
