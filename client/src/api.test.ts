import { describe, expect, it, vi } from "vitest";

// Mock fetch globally for API tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Settings API methods", () => {
	it("getSettings returns SettingsMap", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					boardName: "Dev Team",
					logoPath: "/uploads/logo.png",
					version: 1,
				}),
		});

		const { api } = await import("./api");
		const result = await api.getSettings(7);
		expect(result).toEqual({
			boardName: "Dev Team",
			logoPath: "/uploads/logo.png",
			version: 1,
		});
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/settings",
			expect.any(Object),
		);
	});

	it("updateSettings sends PATCH with body", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					boardName: "New Name",
					logoPath: "/logo.png",
					version: 2,
				}),
		});

		const { api } = await import("./api");
		await api.updateSettings(7, [
			{ key: "board_name", textValue: "New Name", version: 1 },
		]);

		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/settings",
			expect.objectContaining({
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
			}),
		);
	});

	it("resetSettings sends DELETE", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 204,
			json: () => Promise.resolve(undefined),
		});

		const { api } = await import("./api");
		await api.resetSettings(7);

		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/settings",
			expect.objectContaining({ method: "DELETE" }),
		);
	});

	it("uploadLogo sends FormData via POST", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					boardName: "Camel",
					logoPath: "/uploads/new.png",
					version: 2,
				}),
		});

		const { api } = await import("./api");
		const file = new File(["test"], "logo.png", { type: "image/png" });
		const result = await api.uploadLogo(7, file);

		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/settings/logo",
			expect.objectContaining({ method: "POST" }),
		);
		expect(result.logoPath).toBe("/uploads/new.png");
	});
});

describe("scoped settings API", () => {
	it("uses workspace-prefixed settings paths and removes resetApp", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					boardName: "Alpha",
					logoPath: "/logo.png",
					version: 1,
				}),
		});
		const { api } = await import("./api");

		await api.getSettings(7);
		await api.updateSettings(7, [
			{ key: "board_name", textValue: "Alpha", version: 1 },
		]);

		expect(mockFetch).toHaveBeenNthCalledWith(
			1,
			"/api/workspaces/7/settings",
			expect.any(Object),
		);
		expect(mockFetch).toHaveBeenNthCalledWith(
			2,
			"/api/workspaces/7/settings",
			expect.objectContaining({ method: "PATCH" }),
		);
		expect("resetApp" in api).toBe(false);
	});
});

describe("scoped board API paths", () => {
	it("prefixes board, metrics, activity, presence, and card methods with workspace id", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: () => Promise.resolve({}),
		});
		const { api } = await import("./api");

		await api.getBoard(7);
		await api.getMetrics(7);
		await api.getMetricsHistory(7);
		await api.getActivity(7);
		await api.getPresence(7);
		await api.getCard(7, 42);
		await api.createCard(7, { columnId: 1, title: "New" });
		await api.moveCard(7, 42, { toColumnId: 2, index: 3, version: 3 });

		const paths = mockFetch.mock.calls.map(([path]) => path);
		expect(paths).toEqual([
			"/api/workspaces/7/board",
			"/api/workspaces/7/metrics",
			"/api/workspaces/7/metrics/history",
			"/api/workspaces/7/activity",
			"/api/workspaces/7/presence",
			"/api/workspaces/7/cards/42",
			"/api/workspaces/7/cards",
			"/api/workspaces/7/cards/42/move",
		]);

		const moveCall = mockFetch.mock.calls.find(
			([path]) => path === "/api/workspaces/7/cards/42/move",
		);
		expect(moveCall).toBeDefined();
		const moveBody = JSON.parse((moveCall![1] as RequestInit).body as string);
		expect(moveBody).toEqual({ toColumnId: 2, index: 3, version: 3 });
		expect(moveBody).not.toHaveProperty("position");
	});
});

describe("workspace create and invite API contracts", () => {
	it("creates workspaces and accepts invites through scoped endpoints", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					id: 9,
					name: "Launch",
					role: "owner",
					isPersonal: false,
				}),
		});
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ workspaceId: 7, role: "member" }),
		});
		const { api } = await import("./api");

		await api.createWorkspace({ name: "Launch" });
		await api.acceptInvite(7, 12);

		expect(mockFetch).toHaveBeenNthCalledWith(
			1,
			"/api/workspaces",
			expect.objectContaining({ method: "POST" }),
		);
		expect(mockFetch).toHaveBeenNthCalledWith(
			2,
			"/api/workspaces/7/invites/12/accept",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("surfaces the 409 cap message for create and accept failures", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValue({
			ok: false,
			status: 409,
			json: () =>
				Promise.resolve({ error: "You've reached the workspace limit (10)." }),
		});
		const { api } = await import("./api");

		await expect(api.createWorkspace({ name: "Extra" })).rejects.toMatchObject({
			status: 409,
			message: "You've reached the workspace limit (10).",
		});
		await expect(api.acceptInvite(7, 12)).rejects.toMatchObject({
			status: 409,
			message: "You've reached the workspace limit (10).",
		});
	});
});

describe("workspace API methods", () => {
	it("calls documented workspace and membership endpoints", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: () => Promise.resolve({}),
		});
		const { api } = await import("./api");

		await api.getWorkspaces();
		await api.createWorkspace({ name: "Launch" });
		await api.getWorkspaceMembers(7);
		await api.addWorkspaceMember(7, { username: "iris" });
		await api.acceptInvite(7, 12);
		await api.declineInvite(7, 12);
		await api.transferWorkspaceOwnership(7, {
			newOwnerId: 2,
			previousOwnerRole: "admin",
		});
		await api.deleteWorkspace(7);

		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces",
			expect.any(Object),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces",
			expect.objectContaining({ method: "POST" }),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/members",
			expect.any(Object),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/members",
			expect.objectContaining({ method: "POST" }),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/invites/12/accept",
			expect.objectContaining({ method: "POST" }),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/invites/12",
			expect.objectContaining({ method: "DELETE" }),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/transfer-ownership",
			expect.objectContaining({ method: "POST" }),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7",
			expect.objectContaining({ method: "DELETE" }),
		);
	});
});

describe("Agent API methods", () => {
	it("createAgentBoard sends POST with intent and returns boardId + explanation", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({ boardId: 1, explanation: "Created 3 columns" }),
		});
		const { api } = await import("./api");

		const result = await api.createAgentBoard(7, "Build a task tracker");
		expect(result).toEqual({ boardId: 1, explanation: "Created 3 columns" });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/agent/boards",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("sendAgentBoardMessage sends POST with message", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({ explanation: "Updated", boardUpdated: true }),
		});
		const { api } = await import("./api");

		const result = await api.sendAgentBoardMessage(
			7,
			1,
			"Add a testing column",
		);
		expect(result).toEqual({ explanation: "Updated", boardUpdated: true });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/agent/boards/1/message",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("approveAgentBoard sends POST and returns void (204)", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 204,
		});
		const { api } = await import("./api");

		const result = await api.approveAgentBoard(7, 1);
		expect(result).toBeUndefined();
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/agent/boards/1/approve",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("getAgentBoards returns array of boards", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve([
					{
						id: 1,
						workspaceId: 7,
						templateId: "kanban",
						originalIntent: "Build a tracker",
						status: "approved",
						executionStatus: "done",
						createdAt: "2026-06-14T00:00:00Z",
						columns: [],
					},
				]),
		});
		const { api } = await import("./api");

		const result = await api.getAgentBoards(7);
		expect(result).toHaveLength(1);
		expect(result[0].status).toBe("approved");
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/agent/boards",
			expect.any(Object),
		);
	});

	it("getAgentBoard returns single board by id", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					id: 1,
					workspaceId: 7,
					templateId: "kanban",
					originalIntent: "Build a tracker",
					status: "pending",
					executionStatus: "idle",
					createdAt: "2026-06-14T00:00:00Z",
					columns: [
						{
							id: 10,
							slug: "research",
							name: "Research",
							position: 1,
							reasoning: true,
							systemPrompt: "You are a researcher",
							cards: [],
						},
					],
				}),
		});
		const { api } = await import("./api");

		const result = await api.getAgentBoard(7, 1);
		expect(result.id).toBe(1);
		expect(result.columns).toHaveLength(1);
		expect(result.columns[0].slug).toBe("research");
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/agent/boards/1",
			expect.any(Object),
		);
	});

	it("getAgentCardOutput returns output for a column slug", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					columnSlug: "research",
					output: "Here is the research output.",
					thinking: "Let me analyze...",
				}),
		});
		const { api } = await import("./api");

		const result = await api.getAgentCardOutput(7, 1, "research");
		expect(result.columnSlug).toBe("research");
		expect(result.output).toBe("Here is the research output.");
		expect(result.thinking).toBe("Let me analyze...");
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/agent/boards/1/outputs/research",
			expect.any(Object),
		);
	});
});

describe("sendAgentBoardMessage structured payloads", () => {
	it("sends { message: string } body when called with a string argument", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({ explanation: "Got it", boardUpdated: false }),
		});
		const { api } = await import("./api");

		await api.sendAgentBoardMessage(7, 1, "What about subsidies?");

		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ message: "What about subsidies?" });
	});

	it("sends { action: 'confirm_regenerate' } body when called with structured payload", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({ explanation: "Regenerating...", boardUpdated: true }),
		});
		const { api } = await import("./api");

		await api.sendAgentBoardMessage(7, 1, { action: "confirm_regenerate" });

		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ action: "confirm_regenerate" });
	});

	it("sends { action: 'cancel_regenerate' } body when called with structured payload", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({ explanation: "Cancelled.", boardUpdated: false }),
		});
		const { api } = await import("./api");

		await api.sendAgentBoardMessage(7, 1, { action: "cancel_regenerate" });

		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ action: "cancel_regenerate" });
	});

	it("preserves the POST method and correct URL for all payload types", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ explanation: "ok", boardUpdated: false }),
		});
		const { api } = await import("./api");

		await api.sendAgentBoardMessage(7, 1, "hello");
		await api.sendAgentBoardMessage(7, 1, { action: "confirm_regenerate" });

		expect(mockFetch.mock.calls[0][0]).toBe(
			"/api/workspaces/7/agent/boards/1/message",
		);
		expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "POST" });
		expect(mockFetch.mock.calls[1][0]).toBe(
			"/api/workspaces/7/agent/boards/1/message",
		);
		expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: "POST" });
	});
});
