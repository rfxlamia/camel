import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock fetch globally for API tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockPublishAutoError = vi.fn();
vi.mock("./lib/ticketIntakeBus", () => ({
	publishAutoError: (...args: unknown[]) => mockPublishAutoError(...args),
}));

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
	it("serializes additive Board create metadata", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 201,
			json: () => Promise.resolve({}),
		});
		const { api } = await import("./api");

		await api.createCard(7, {
			columnId: 1,
			title: "Plan release",
			assigneeIds: [2, 3],
			priorityId: 4,
			labelIds: [5, 6],
			projectId: 8,
			phaseId: 9,
			dueDate: "2026-09-30",
		});

		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toMatchObject({
			columnId: 1,
			title: "Plan release",
			description: "",
			assigneeIds: [2, 3],
			priorityId: 4,
			labelIds: [5, 6],
			projectId: 8,
			phaseId: 9,
			dueDate: "2026-09-30",
		});
		expect(body).not.toHaveProperty("statusId");
	});

	it("preserves Board structured field errors", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 400,
			json: () =>
				Promise.resolve({
					error: "Some task fields are invalid",
					fieldErrors: {
						assigneeIds: "Assignee is no longer available",
						projectId: "Project is no longer available",
					},
				}),
		});
		const { api } = await import("./api");

		await expect(
			api.createCard(7, { columnId: 1, title: "Plan release" }),
		).rejects.toMatchObject({
			message: "Some task fields are invalid",
			status: 400,
			fieldErrors: {
				assigneeIds: "Assignee is no longer available",
				projectId: "Project is no longer available",
			},
		});
	});

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

	it("surfaces the server's 409 conflict message for create and accept failures", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValue({
			ok: false,
			status: 409,
			json: () =>
				Promise.resolve({
					error: "User is already a member of this workspace",
				}),
		});
		const { api } = await import("./api");

		await expect(api.createWorkspace({ name: "Extra" })).rejects.toMatchObject({
			status: 409,
			message: "User is already a member of this workspace",
		});
		await expect(api.acceptInvite(7, 12)).rejects.toMatchObject({
			status: 409,
			message: "User is already a member of this workspace",
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
		await api.updateWorkspace(7, { name: "Renamed" });
		await api.getWorkspaceMembers(7);
		await api.addWorkspaceMember(7, { username: "iris" });
		await api.removeWorkspaceMember(7, 3);
		await api.updateWorkspaceMemberRole(7, 3, { role: "admin" });
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
			"/api/workspaces/7",
			expect.objectContaining({ method: "PATCH" }),
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
			"/api/workspaces/7/members/3",
			expect.objectContaining({ method: "DELETE" }),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/members/3",
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({ role: "admin" }),
			}),
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

describe("template batch API", () => {
	it("applyTemplate POSTs to /columns/batch with {templateName, columns}", async () => {
		mockFetch.mockClear();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 201,
			json: () => Promise.resolve([]),
		});
		const { api } = await import("./api");

		const columns = [
			{
				title: "Backlog",
				color: "powder-blue" as const,
				wipLimit: null,
				policy: "Ideas.",
				isDone: false,
			},
		];
		await api.applyTemplate(7, { templateName: "Software Dev", columns });

		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/columns/batch",
			expect.objectContaining({ method: "POST" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ templateName: "Software Dev", columns });
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

describe("user-initiated auto-error bus", () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockPublishAutoError.mockReset();
	});

	function mockError(status: number, message: string) {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status,
			json: () => Promise.resolve({ error: message }),
		});
	}

	it("publishes auto-error on tagged updateCard 500+", async () => {
		mockError(500, "Internal Server Error");
		const { api } = await import("./api");

		await expect(
			api.updateCard(7, 42, { title: "New", version: 1 }),
		).rejects.toMatchObject({ status: 500 });

		expect(mockPublishAutoError).toHaveBeenCalledTimes(1);
		expect(mockPublishAutoError).toHaveBeenCalledWith(
			expect.objectContaining({
				endpoint: "/api/workspaces/7/cards/42",
				status: 500,
				message: "Internal Server Error",
				userAction: "Save",
				timestamp: expect.any(String),
			}),
		);
	});

	it("publishes auto-error on tagged createCard 500+", async () => {
		mockError(503, "Service Unavailable");
		const { api } = await import("./api");

		await expect(
			api.createCard(7, { columnId: 1, title: "New" }),
		).rejects.toMatchObject({ status: 503 });

		expect(mockPublishAutoError).toHaveBeenCalledWith(
			expect.objectContaining({
				endpoint: "/api/workspaces/7/cards",
				status: 503,
				userAction: "submit",
			}),
		);
	});

	it("publishes auto-error on tagged moveCard 500+", async () => {
		mockError(500, "Server error");
		const { api } = await import("./api");

		await expect(
			api.moveCard(7, 42, { toColumnId: 2, index: 0, version: 1 }),
		).rejects.toMatchObject({ status: 500 });

		expect(mockPublishAutoError).toHaveBeenCalledWith(
			expect.objectContaining({
				endpoint: "/api/workspaces/7/cards/42/move",
				status: 500,
				userAction: "drag-drop",
			}),
		);
	});

	it("does not publish auto-error on tagged 400-class errors", async () => {
		mockError(409, "Conflict");
		const { api } = await import("./api");

		await expect(
			api.updateCard(7, 42, { title: "New", version: 1 }),
		).rejects.toMatchObject({ status: 409 });

		expect(mockPublishAutoError).not.toHaveBeenCalled();
	});

	it("does not publish auto-error on untagged 500+ background calls", async () => {
		mockFetch
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				json: () => Promise.resolve({ error: "fail" }),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				json: () => Promise.resolve({ error: "fail" }),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				json: () => Promise.resolve({ error: "fail" }),
			});
		const { api } = await import("./api");

		await expect(api.heartbeat(7)).rejects.toMatchObject({ status: 500 });
		await expect(api.getPresence(7)).rejects.toMatchObject({ status: 500 });
		await expect(api.getNotifications(7)).rejects.toMatchObject({
			status: 500,
		});

		expect(mockPublishAutoError).not.toHaveBeenCalled();
	});
});

describe("chat API methods", () => {
	beforeEach(() => mockFetch.mockReset());

	it("api.chat.listThreads GETs /api/chat/threads", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve([{ id: 1, title: "Untitled" }]),
		});
		const { api } = await import("./api");
		const threads = await api.chat.listThreads();
		expect(threads).toEqual([{ id: 1, title: "Untitled" }]);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/chat/threads",
			expect.objectContaining({ credentials: "include" }),
		);
	});

	it("api.chat.createThread POSTs /api/chat/threads", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ id: 2, title: "Untitled" }),
		});
		const { api } = await import("./api");
		await api.chat.createThread();
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/chat/threads",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("api.chat.renameThread PATCHes thread title", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ id: 1, title: "Renamed" }),
		});
		const { api } = await import("./api");
		await api.chat.renameThread(1, "Renamed");
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/chat/threads/1",
			expect.objectContaining({ method: "PATCH" }),
		);
	});

	it("api.chat.getMessages returns thinking and toolTrace fields", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve([
					{
						id: 10,
						role: "assistant",
						content: "Hi",
						thinking: "thought",
						toolTrace: [{ toolName: "web_search" }],
					},
				]),
		});
		const { api } = await import("./api");
		const msgs = await api.chat.getMessages(1);
		expect(msgs[0].thinking).toBe("thought");
		expect(msgs[0].toolTrace).toHaveLength(1);
	});

	it("api.chat.sendMessage returns ReadableStream body", async () => {
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"type":"done"}\n'));
				controller.close();
			},
		});
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			body: stream,
		});
		const { api } = await import("./api");
		const body = await api.chat.sendMessage(1, "hello", { workspaceId: 7 });
		expect(body).toBeInstanceOf(ReadableStream);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/chat/threads/1/messages",
			expect.objectContaining({
				body: JSON.stringify({ message: "hello", workspaceId: 7 }),
			}),
		);
	});

	it("api.chat.downloadAttachment GETs attachment by id", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			blob: () => Promise.resolve(new Blob(["# Report"])),
		});
		const { api } = await import("./api");
		await api.chat.downloadAttachment(5);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/chat/attachments/5",
			expect.objectContaining({ credentials: "include" }),
		);
	});

	it("api.chat.retryMessage POSTs retry action", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			body: new ReadableStream(),
		});
		const { api } = await import("./api");
		await api.chat.retryMessage(1, 42);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/chat/threads/1/messages",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ action: "retry", messageId: 42 }),
			}),
		);
	});
});

describe("ticketIntake API methods", () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	it("sendMessage POSTs to ticket-intake/chat", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ ready: false, question: "Bug?" }),
		});
		const { api } = await import("./api");

		const result = await api.ticketIntake.sendMessage(7, {
			message: "kanban broken",
			isFirstTurn: true,
		});

		expect(result).toEqual({ ready: false, question: "Bug?" });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/ticket-intake/chat",
			expect.objectContaining({ method: "POST" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ message: "kanban broken", isFirstTurn: true });
	});

	it("submit POSTs to ticket-intake/submit", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 202,
			json: () => Promise.resolve({ status: "submitting" }),
		});
		const { api } = await import("./api");

		const result = await api.ticketIntake.submit(7, {
			title: "Bug",
			description: "desc",
			type: "Bug",
			cardId: 42,
		});

		expect(result).toEqual({ status: "submitting" });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/ticket-intake/submit",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("resubmit POSTs to ticket-intake/resubmit", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 202,
			json: () => Promise.resolve({ status: "submitting" }),
		});
		const { api } = await import("./api");

		await api.ticketIntake.resubmit(7, {
			title: "Bug",
			description: "desc",
			type: "Bug",
		});

		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/ticket-intake/resubmit",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("getHistory GETs ticket-intake/history with cardId", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ tickets: [] }),
		});
		const { api } = await import("./api");

		const result = await api.ticketIntake.getHistory(7, 42);

		expect(result).toEqual({ tickets: [] });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/ticket-intake/history?cardId=42",
			expect.any(Object),
		);
	});
});
