import { useEffect, useState } from "react";
import { Navigate, RouterProvider, createBrowserRouter } from "react-router";
import { api } from "./api";
import type { User } from "./types";
import AuthPage from "./components/AuthPage";
import { BoardProvider } from "./context/BoardContext";
import AppLayout from "./layout/AppLayout";
import ActivityPage from "./pages/ActivityPage";
import BoardPage from "./pages/BoardPage";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
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
      { path: "board", Component: BoardPage },
      {
        path: "dashboard",
        lazy: async () => ({
          Component: (await import("./pages/DashboardPage")).default,
        }),
      },
      { path: "activity", Component: ActivityPage },
      { path: "*", element: <Navigate to="/board" replace /> },
    ],
  },
]);

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
      <RouterProvider router={router} />
    </BoardProvider>
  );
}
