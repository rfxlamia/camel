// @vitest-environment jsdom
// client/src/pages/AgentPage.test.tsx — NEW FILE (jsdom).
// AgentPage is coupled to useBoard(), react-router, and the api module; mock
// all three (matching AgentCardDetail.test.tsx) so the test exercises ONLY the
// done-state artifact fetch + conditional ArtifactCard render.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentBoard } from "../types";

const { mockUseBoard, mockGetBoard, getAgentArtifact } = vi.hoisted(() => ({
	mockUseBoard: vi.fn(),
	mockGetBoard: vi.fn(),
	getAgentArtifact: vi.fn(),
}));

vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

// AgentPage reads searchParams.get("boardId") — the param name MUST be
// "boardId" (not "board"), or the load effect early-returns and no board
// ever loads (all three tests would fail).
vi.mock("react-router", () => ({
	useSearchParams: () => [new URLSearchParams("boardId=2"), vi.fn()],
}));

vi.mock("../api", () => ({
	ApiError: class ApiError extends Error {
		status: number;
		constructor(status: number) {
			super("api error");
			this.status = status;
		}
	},
	api: {
		getAgentBoard: (...a: unknown[]) => mockGetBoard(...a),
		getAgentArtifact: (...a: unknown[]) => getAgentArtifact(...a),
		agentArtifactDownloadUrl: () =>
			"/workspaces/1/agent/boards/2/artifact/download",
	},
}));

vi.mock("../components/LoadingCamel", () => ({
	default: () => <div data-testid="loading-camel" />,
}));
vi.mock("../components/SuccessAnimation", () => ({
	default: () => <div data-testid="success-animation" />,
}));

// ArtifactCard is verified in isolation in T6; stub it to a sentinel so this
// test asserts only that AgentPage renders it (or not) on the right transition.
vi.mock("../components/ArtifactCard", () => ({
	default: ({ artifact }: { artifact: { filename: string } }) => (
		<div data-testid="artifact-card">{artifact.filename}</div>
	),
}));

import AgentPage from "./AgentPage";

function makeBoard(executionStatus: AgentBoard["executionStatus"]): AgentBoard {
	return {
		id: 2,
		workspaceId: 1,
		originalIntent: "riset thailand",
		templateId: "research-report",
		status: "approved",
		executionStatus,
		createdAt: "2026-06-16T10:00:00Z",
		columns: [],
	};
}

async function waitForAgentPanel() {
	await waitFor(() => {
		expect(screen.getByText("Agent")).toBeTruthy();
	});
}

beforeEach(() => {
	getAgentArtifact.mockReset();
	mockGetBoard.mockReset();
	// AgentPage destructures showToast + clearAgentEvents from useBoard() and
	// calls clearAgentEvents() in the load effect — both MUST be stubbed or the
	// page crashes (undefined is not a function) once the board loads.
	mockUseBoard.mockReturnValue({
		activeWorkspaceId: 1,
		agentEvents: [],
		showToast: vi.fn(),
		clearAgentEvents: vi.fn(),
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("AgentPage artifact panel", () => {
	it("renders ArtifactCard when done and an artifact resolves", async () => {
		mockGetBoard.mockResolvedValue(makeBoard("done"));
		getAgentArtifact.mockResolvedValue({
			filename: "x.md",
			format: "md",
			content: "# Hi",
		});
		render(<AgentPage />);
		await waitForAgentPanel();
		expect(await screen.findByTestId("artifact-card")).toBeTruthy();
	});

	it("renders no ArtifactCard when done but the artifact 404s", async () => {
		mockGetBoard.mockResolvedValue(makeBoard("done"));
		getAgentArtifact.mockRejectedValue({ status: 404 });
		render(<AgentPage />);
		await waitForAgentPanel();
		await waitFor(() => expect(getAgentArtifact).toHaveBeenCalled());
		expect(screen.queryByTestId("artifact-card")).toBeNull();
	});

	it("renders no ArtifactCard and never fetches the artifact on a failed run", async () => {
		mockGetBoard.mockResolvedValue(makeBoard("failed"));
		render(<AgentPage />);
		await waitForAgentPanel();
		expect(screen.queryByTestId("artifact-card")).toBeNull();
		expect(getAgentArtifact).not.toHaveBeenCalled();
	});
});
