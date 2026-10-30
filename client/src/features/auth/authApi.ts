import type { ApiRequest } from "../../shared/apiRequest";
import type { User } from "../../types";

export function createAuthApi(request: ApiRequest) {
	return {
		register: (username: string, password: string, displayName: string) =>
			request<{ user: User }>("/auth/register", {
				method: "POST",
				body: JSON.stringify({ username, password, displayName }),
			}),

		login: (username: string, password: string) =>
			request<{ user: User }>("/auth/login", {
				method: "POST",
				body: JSON.stringify({ username, password }),
			}),

		logout: () => request<void>("/auth/logout", { method: "POST" }),

		me: () => request<{ user: User }>("/auth/me"),

		setUsername: (username: string, displayName?: string) =>
			request<{ ok: boolean }>("/auth/set-username", {
				method: "POST",
				body: JSON.stringify({ username, displayName }),
			}),

		setPassword: (password: string) =>
			request<{ ok: boolean }>("/auth/set-password", {
				method: "POST",
				body: JSON.stringify({ password }),
			}),

		changePassword: (currentPassword: string, newPassword: string) =>
			request<{ ok: boolean }>("/auth/change-password", {
				method: "POST",
				body: JSON.stringify({ currentPassword, newPassword }),
			}),

		startOAuth: async (provider: "google" | "github") => {
			const data = await request.raw<{ url?: string }>(
				"/auth/sign-in/social",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						provider,
						callbackURL: "/api/auth/complete-oauth",
						redirect: false,
					}),
					credentials: "same-origin",
				},
				undefined,
				false,
			);
			if (data.url) window.location.href = data.url;
		},
	};
}
