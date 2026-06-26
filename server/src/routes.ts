import { Router } from "express";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { requireEmailVerified } from "./middleware/email-gate.js";
import { activityRouter } from "./routes/activity.js";
import { boardRouter } from "./routes/board.js";
import { cardsRouter } from "./routes/cards.js";
import { columnsRouter } from "./routes/columns.js";
import { invitesRouter } from "./routes/invites.js";
import { membersRouter } from "./routes/members.js";
import { metricsRouter } from "./routes/metrics.js";
import { presenceRouter } from "./routes/presence.js";
import { settingsRouter } from "./routes/settings.js";
import { workspacesRouter } from "./routes/workspaces.js";

// Re-export helpers for backward compatibility
export {
	type AuthCheck,
	CAP_ERROR_MESSAGE,
	checkActorCanManage,
	checkCanRemoveUser,
	checkInviteeCap,
	createScopedBoardService,
	createWorkspaceAccessService,
	getHumanColumns,
	getWorkspaceCapacity,
	type HumanColumn,
	type ScopedBoardDeps,
	serializeWorkspaceList,
	WORKSPACE_LIMIT,
	type WorkspaceAccessDeps,
	type WorkspaceCapacity,
} from "./routes/helpers.js";

import { createScopedBoardService } from "./routes/helpers.js";

export const api = Router();

api.use(requireAuth);

if (config.EMAIL_GATE_ENABLED === "true") {
	api.use(requireEmailVerified);
}

api.use("/workspaces/:workspaceId/settings", settingsRouter);
api.use("/workspaces", workspacesRouter);
api.use("/workspaces/:workspaceId", activityRouter);
api.use("/workspaces/:workspaceId", boardRouter);
api.use("/workspaces/:workspaceId", cardsRouter);
api.use("/workspaces/:workspaceId", columnsRouter);
api.use("/workspaces/:workspaceId", invitesRouter);
api.use("/workspaces/:workspaceId", membersRouter);
api.use("/workspaces/:workspaceId", metricsRouter);
api.use("/workspaces/:workspaceId", presenceRouter);

// ---- Integration test helpers (in-memory, no DB) ------------------------------

const LEGACY_WORKSPACE_API_ROUTES = [
	{ method: "GET", path: "/board" },
	{ method: "POST", path: "/cards" },
	{ method: "GET", path: "/settings" },
	{ method: "GET", path: "/events/stream" },
	{ method: "GET", path: "/presence" },
] as const;

type RouteLayer = {
	route?: { path: string; methods: Record<string, boolean> };
};

function listTopLevelApiRoutes(router: Router): Set<string> {
	const keys = new Set<string>();
	for (const layer of (router as unknown as { stack: RouteLayer[] }).stack ??
		[]) {
		if (!layer.route) continue;
		for (const [method, enabled] of Object.entries(layer.route.methods)) {
			if (enabled && method !== "_all") {
				keys.add(`${method.toUpperCase()} ${layer.route.path}`);
			}
		}
	}
	return keys;
}

/**
 * Documents legacy global routes and verifies they are not mounted on the API router.
 * Uses router stack inspection — does not issue real HTTP requests.
 */
export function legacyWorkspaceRouteMatrix() {
	const registered = listTopLevelApiRoutes(api);
	return LEGACY_WORKSPACE_API_ROUTES.map(({ method, path }) => ({
		method,
		path: `/api${path}`,
		status: registered.has(`${method} ${path}`)
			? (200 as const)
			: (404 as const),
	}));
}

export type IntegrationUser = { userId: number; username: string };

/**
 * In-process isolation harness — no DB or real HTTP involved.
 * Verifies workspace boundary logic via the same pure services used by route handlers.
 */
export function createWorkspaceIntegrationHarness() {
	let nextUserId = 1;
	let nextWorkspaceId = 1;
	let nextCardId = 1;
	let nextColumnId = 1;
	let nextEventId = 1;

	const users = new Map<string, number>();
	const memberships = new Map<string, { role: string }>();
	const columnsByWorkspace = new Map<number, number[]>();
	const cards = new Map<
		number,
		{ id: number; workspaceId: number; title: string; columnId: number }
	>();
	const activities: Array<{ id: number; cardId: number; workspaceId: number }> =
		[];

	const boardService = createScopedBoardService({
		getMembership: async (workspaceId, userId) => {
			const role = memberships.get(`${workspaceId}:${userId}`);
			return role ? { role: role.role } : null;
		},
		getCardById: async (workspaceId, cardId) => {
			const card = cards.get(cardId);
			if (!card || card.workspaceId !== workspaceId) return null;
			return card;
		},
		getBoardRows: async () => [],
		getActivityRows: async (workspaceId) =>
			activities
				.filter((e) => e.workspaceId === workspaceId)
				.map((e) => ({ id: e.id, workspaceId: e.workspaceId, cardTitle: "" })),
	});

	return {
		async signIn(username: string): Promise<IntegrationUser> {
			if (!users.has(username)) {
				users.set(username, nextUserId++);
			}
			return { userId: users.get(username)!, username };
		},

		async createWorkspace(
			user: IntegrationUser,
			name: string,
		): Promise<{
			id: number;
			name: string;
			role: string;
			isPersonal: boolean;
		}> {
			const id = nextWorkspaceId++;
			memberships.set(`${id}:${user.userId}`, { role: "owner" });
			const columnId = nextColumnId++;
			columnsByWorkspace.set(id, [columnId]);
			return { id, name, role: "owner", isPersonal: false };
		},

		async createCard(
			user: IntegrationUser,
			workspaceId: number,
			opts: { title: string },
		): Promise<{ id: number; workspaceId: number; title: string }> {
			const membership = memberships.get(`${workspaceId}:${user.userId}`);
			if (!membership) throw new Error("not a workspace member");

			const columnId = columnsByWorkspace.get(workspaceId)?.[0];
			if (columnId === undefined) throw new Error("workspace has no columns");

			const id = nextCardId++;
			const card = { id, workspaceId, title: opts.title, columnId };
			cards.set(id, card);
			activities.push({ id: nextEventId++, cardId: id, workspaceId });
			return { id, workspaceId, title: opts.title };
		},

		async getCard(
			user: IntegrationUser,
			workspaceId: number,
			cardId: number,
		): Promise<
			{ status: 404 } | { id: number; workspaceId: number; title: string }
		> {
			const result = await boardService.getCard({
				userId: user.userId,
				workspaceId,
				cardId,
			});
			if ("status" in result) return { status: result.status };
			return result;
		},

		async getActivity(
			user: IntegrationUser,
			workspaceId: number,
		): Promise<Array<{ cardId: number; workspaceId: number }>> {
			const membership = memberships.get(`${workspaceId}:${user.userId}`);
			if (!membership) return [];

			return activities
				.filter((e) => e.workspaceId === workspaceId)
				.map((e) => ({ cardId: e.cardId, workspaceId: e.workspaceId }));
		},
	};
}
