// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TicketIntakeDraft } from "../api";
import type { User } from "../types";

const mockGetWorkspaces = vi.fn();
const mockGetBoard = vi.fn();
const mockGetMetrics = vi.fn();
const mockGetActivity = vi.fn();
const mockGetSettings = vi.fn();
const mockHeartbeat = vi.fn();
const mockGetPresence = vi.fn();
const mockSendMessage = vi.fn();
const mockSubmit = vi.fn();

vi.mock("../api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api")>();
	return {
		...actual,
		api: {
			...actual.api,
			getWorkspaces: (...args: unknown[]) => mockGetWorkspaces(...args),
			getBoard: (...args: unknown[]) => mockGetBoard(...args),
			getMetrics: (...args: unknown[]) => mockGetMetrics(...args),
			getActivity: (...args: unknown[]) => mockGetActivity(...args),
			getSettings: (...args: unknown[]) => mockGetSettings(...args),
			heartbeat: (...args: unknown[]) => mockHeartbeat(...args),
			getPresence: (...args: unknown[]) => mockGetPresence(...args),
			ticketIntake: {
				...actual.api.ticketIntake,
				sendMessage: (...args: unknown[]) => mockSendMessage(...args),
				submit: (...args: unknown[]) => mockSubmit(...args),
			},
			focus: {
				getConfig: vi.fn().mockResolvedValue({ enabled: false }),
			},
		},
	};
});

class MockEventSource {
	static instances: MockEventSource[] = [];

	url: string;
	close = vi.fn();
	onopen: ((ev: Event) => void) | null = null;
	onmessage: ((ev: MessageEvent) => void) | null = null;

	constructor(url: string) {
		this.url = url;
		MockEventSource.instances.push(this);
	}

	emit(data: unknown) {
		const event = { data: JSON.stringify(data) } as MessageEvent;
		this.onmessage?.(event);
	}

	static reset() {
		MockEventSource.instances = [];
	}

	static boardStream() {
		return MockEventSource.instances.find((instance) =>
			instance.url.includes("/events/stream"),
		);
	}
}

vi.stubGlobal("EventSource", MockEventSource);

const testUser: User = {
	id: 1,
	username: "alice",
	displayName: "Alice",
	emailVerified: true,
	needsUsername: false,
};

const readyDraft: TicketIntakeDraft = {
	title: "Kanban drag broken",
	description: "Cards snap back after drop",
	expected: "Card stays in new column",
	actual: "Card returns to original column",
	repro: "Drag card between columns",
	type: "Bug",
};

function setupBoardApiMocks() {
	mockGetWorkspaces.mockResolvedValue({
		workspaces: [
			{
				id: 1,
				name: "Test",
				role: "owner",
				isPersonal: false,
				memberCount: 1,
			},
		],
		pendingInvites: [],
	});
	mockGetBoard.mockResolvedValue({ columns: [] });
	mockGetMetrics.mockResolvedValue({
		throughput: 0,
		avgLeadTimeMs: null,
		avgCycleTimeMs: null,
		wipCount: 0,
	});
	mockGetActivity.mockResolvedValue({ events: [] });
	mockGetSettings.mockResolvedValue({
		boardName: "Camel",
		logoPath: "/logo.png",
		version: 0,
	});
	mockHeartbeat.mockResolvedValue({ ok: true });
	mockGetPresence.mockResolvedValue({ users: [] });
}

describe("useTicketIntakeChat integration — SSE submit-result to PreviewScreen", () => {
	beforeEach(() => {
		MockEventSource.reset();
		localStorage.clear();
		setupBoardApiMocks();
		mockSendMessage.mockReset();
		mockSubmit.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	async function renderChatPanel() {
		const { BoardProvider } = await import("../context/BoardContext");
		const { ChatPanel } = await import(
			"../components/ticketIntake/ChatPanel"
		);
		render(
			<BoardProvider user={testUser} onSignedOut={vi.fn()}>
				<ChatPanel onClose={vi.fn()} />
			</BoardProvider>,
		);
		await waitFor(() => {
			expect(MockEventSource.boardStream()).toBeDefined();
		});
	}

	async function reachPreview() {
		mockSendMessage.mockResolvedValueOnce({ ready: true, draft: readyDraft });
		await renderChatPanel();
		const textarea = await screen.findByPlaceholderText(/describe the issue/i);
		fireEvent.change(textarea, { target: { value: "bug report" } });
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
		});
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^confirm$/i })).toBeTruthy();
		});
	}

	it("shows success in PreviewScreen after SSE submit_result success", async () => {
		mockSubmit.mockResolvedValueOnce({ status: "submitting" });
		await reachPreview();

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
		});

		await waitFor(() => {
			expect(screen.getByText(/submitting/i)).toBeTruthy();
		});
		expect(mockSubmit).toHaveBeenCalledWith(
			1,
			expect.objectContaining({
				title: readyDraft.title,
				type: "Bug",
				source: "global",
			}),
		);

		act(() => {
			MockEventSource.boardStream()!.emit({
				type: "ticket_intake.submit_result",
				success: true,
				issueUrl: "https://linear.app/cam/issue/CAM-1",
				issueIdentifier: "CAM-1",
			});
		});

		await waitFor(() => {
			expect(screen.getByText(/CAM-1/)).toBeTruthy();
		});
		expect(screen.getByText(/issue created/i)).toBeTruthy();
	});

	it("shows graceful failure in PreviewScreen after SSE submit_result failure", async () => {
		mockSubmit.mockResolvedValueOnce({ status: "submitting" });
		await reachPreview();

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
		});

		await waitFor(() => {
			expect(screen.getByText(/submitting/i)).toBeTruthy();
		});

		act(() => {
			MockEventSource.boardStream()!.emit({
				type: "ticket_intake.submit_result",
				success: false,
				retryable: true,
				errorMessage: "Linear unavailable",
			});
		});

		await waitFor(() => {
			expect(
				screen.getByText(/We could not create the issue/i),
			).toBeTruthy();
		});
		expect(screen.getByRole("button", { name: /^resubmit$/i })).toBeTruthy();
	});
});
