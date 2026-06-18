// @vitest-environment jsdom
// client/src/pages/AgentPage.test.tsx — NEW FILE (jsdom).
// AgentPage is coupled to useBoard(), react-router, and the api module; mock
// all three (matching AgentCardDetail.test.tsx) so the test exercises ONLY the
// done-state artifact fetch + conditional ArtifactCard render.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentBoard, AgentEvent } from "../types";

const {
  mockUseBoard,
  mockGetBoard,
  getAgentArtifact,
  mockSendAgentBoardMessage,
  stableSearchParams,
  stableSetSearchParams,
  stableShowToast,
  stableClearAgentEvents,
  stableClearFollowUpAgentEvents,
} = vi.hoisted(() => ({
  mockUseBoard: vi.fn(),
  mockGetBoard: vi.fn(),
  getAgentArtifact: vi.fn(),
  mockSendAgentBoardMessage: vi.fn(),
  stableSearchParams: new URLSearchParams("boardId=2"),
  stableSetSearchParams: vi.fn(),
  stableShowToast: vi.fn(),
  stableClearAgentEvents: vi.fn(),
  stableClearFollowUpAgentEvents: vi.fn(),
}));

vi.mock("../context/BoardContext", () => ({
  useBoard: () => mockUseBoard(),
}));

// AgentPage reads searchParams.get("boardId") — the param name MUST be
// "boardId" (not "board"), or the load effect early-returns and no board
// ever loads (all three tests would fail).
vi.mock("react-router", () => ({
  useSearchParams: () => [stableSearchParams, stableSetSearchParams],
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
    sendAgentBoardMessage: (...a: unknown[]) => mockSendAgentBoardMessage(...a),
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
    expect(screen.getAllByText("Agent").length).toBeGreaterThan(0);
  });
}

beforeEach(() => {
  getAgentArtifact.mockReset();
  mockGetBoard.mockReset();
  mockSendAgentBoardMessage.mockReset();
  mockSendAgentBoardMessage.mockResolvedValue({
    explanation: "Here is the answer.",
    boardUpdated: false,
  });
  // AgentPage destructures showToast + clearAgentEvents from useBoard() and
  // calls clearAgentEvents() in the load effect — both MUST be stubbed or the
  // page crashes (undefined is not a function) once the board loads.
  mockUseBoard.mockReturnValue({
    activeWorkspaceId: 1,
    agentEvents: [],
    showToast: stableShowToast,
    clearAgentEvents: stableClearAgentEvents,
    clearFollowUpAgentEvents: stableClearFollowUpAgentEvents,
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

describe("AgentPage follow-up input", () => {
  it("enables input when board.executionStatus is 'done'", async () => {
    mockGetBoard.mockResolvedValue(makeBoard("done"));
    getAgentArtifact.mockResolvedValue(null);
    render(<AgentPage />);
    await waitForAgentPanel();
    const input = screen.getByPlaceholderText(/Follow up|Refine/i);
    expect((input as HTMLInputElement).disabled).toBe(false);
  });

  it("disables input when board.executionStatus is 'running'", async () => {
    mockGetBoard.mockResolvedValue(makeBoard("running"));
    render(<AgentPage />);
    await waitForAgentPanel();
    const input = screen.getByPlaceholderText(/Execution in progress/i);
    expect((input as HTMLInputElement).disabled).toBe(true);
  });

  it("calls api.sendAgentBoardMessage when follow-up is sent on done board", async () => {
    mockGetBoard.mockResolvedValue(makeBoard("done"));
    getAgentArtifact.mockResolvedValue(null);

    render(<AgentPage />);
    await waitForAgentPanel();

    const input = screen.getByPlaceholderText(/Follow up|Refine/i);
    fireEvent.change(input, {
      target: { value: "What were the key findings?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => {
      expect(mockSendAgentBoardMessage).toHaveBeenCalledWith(
        1,
        2,
        "What were the key findings?",
      );
    });
  });
});

describe("AgentPage follow-up chat bubbles", () => {
  it("renders __notfirst__ tokens as chat bubble, not in column tiles", async () => {
    const followUpEvents: AgentEvent[] = [
      {
        type: "agent.card.token",
        columnSlug: "__notfirst__",
        boardId: 2,
        token: "The research found ",
      },
      {
        type: "agent.card.token",
        columnSlug: "__notfirst__",
        boardId: 2,
        token: "three key findings.",
      },
    ];
    mockGetBoard.mockResolvedValue(makeBoard("done"));
    getAgentArtifact.mockResolvedValue(null);
    mockUseBoard.mockReturnValue({
      activeWorkspaceId: 1,
      agentEvents: followUpEvents,
      showToast: stableShowToast,
      clearAgentEvents: stableClearAgentEvents,
    });

    render(<AgentPage />);
    await waitForAgentPanel();

    await waitFor(() => {
      expect(screen.getByText(/The research found/)).toBeTruthy();
    });
  });
});

describe("AgentPage NEW_DIRECTION buttons", () => {
  it("renders confirm and cancel buttons for NEW_DIRECTION response", async () => {
    mockGetBoard.mockResolvedValue(makeBoard("done"));
    getAgentArtifact.mockResolvedValue(null);
    mockSendAgentBoardMessage.mockResolvedValue({
      explanation: "This is a different topic. I will regenerate the board.",
      boardUpdated: false,
      pendingRegenerate: true,
    });

    render(<AgentPage />);
    await waitForAgentPanel();

    const input = screen.getByPlaceholderText(/Follow up|Refine/i);
    fireEvent.change(input, { target: { value: "Now research scooters" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Ya.*Regenerate/i }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: /Batal/i })).toBeTruthy();
    });
  });

  it("calls sendAgentBoardMessage with { action: 'confirm_regenerate' } on confirm click", async () => {
    mockGetBoard.mockResolvedValue(makeBoard("done"));
    getAgentArtifact.mockResolvedValue(null);
    mockSendAgentBoardMessage
      .mockResolvedValueOnce({
        explanation: "This is a different topic. I will regenerate the board.",
        boardUpdated: false,
        pendingRegenerate: true,
      })
      .mockResolvedValueOnce({
        explanation: "Regenerating...",
        boardUpdated: true,
      });

    render(<AgentPage />);
    await waitForAgentPanel();

    const input = screen.getByPlaceholderText(/Follow up|Refine/i);
    fireEvent.change(input, { target: { value: "Now research scooters" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Ya.*Regenerate/i }),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Ya.*Regenerate/i }));

    await waitFor(() => {
      expect(mockSendAgentBoardMessage).toHaveBeenCalledWith(1, 2, {
        action: "confirm_regenerate",
      });
    });
  });

  it("calls sendAgentBoardMessage with { action: 'cancel_regenerate' } on cancel click", async () => {
    mockGetBoard.mockResolvedValue(makeBoard("done"));
    getAgentArtifact.mockResolvedValue(null);
    mockSendAgentBoardMessage
      .mockResolvedValueOnce({
        explanation: "This is a different topic. I will regenerate the board.",
        boardUpdated: false,
        pendingRegenerate: true,
      })
      .mockResolvedValueOnce({
        explanation: "Cancelled.",
        boardUpdated: false,
      });

    render(<AgentPage />);
    await waitForAgentPanel();

    const input = screen.getByPlaceholderText(/Follow up|Refine/i);
    fireEvent.change(input, { target: { value: "Now research scooters" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Batal/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Batal/i }));

    await waitFor(() => {
      expect(mockSendAgentBoardMessage).toHaveBeenCalledWith(1, 2, {
        action: "cancel_regenerate",
      });
    });
  });

  it("disables input during pending regeneration", async () => {
    mockGetBoard.mockResolvedValue(makeBoard("done"));
    getAgentArtifact.mockResolvedValue(null);
    mockSendAgentBoardMessage.mockResolvedValue({
      explanation: "This is a different topic. I will regenerate the board.",
      boardUpdated: false,
      pendingRegenerate: true,
    });

    render(<AgentPage />);
    await waitForAgentPanel();

    const input = screen.getByPlaceholderText(/Follow up|Refine/i);
    fireEvent.change(input, { target: { value: "Now research scooters" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Ya.*Regenerate/i }),
      ).toBeTruthy();
    });

    const inputAfter = screen.getByPlaceholderText(/Waiting for confirmation/i);
    expect((inputAfter as HTMLInputElement).disabled).toBe(true);
  });
});

describe("bug-hunting: multi-turn conversation", () => {
  it("disables follow-up input on failed boards", async () => {
    mockGetBoard.mockResolvedValue(makeBoard("failed"));
    render(<AgentPage />);
    await waitForAgentPanel();
    const input = screen.getByPlaceholderText(/Refine the board/i);
    expect((input as HTMLInputElement).disabled).toBe(true);
  });

  it("clears follow-up SSE events before each follow-up send", async () => {
    mockGetBoard.mockResolvedValue(makeBoard("done"));
    getAgentArtifact.mockResolvedValue(null);
    mockUseBoard.mockReturnValue({
      activeWorkspaceId: 1,
      agentEvents: [
        {
          type: "agent.card.token",
          columnSlug: "__notfirst__",
          boardId: 2,
          token: "Previous answer.",
        },
      ],
      showToast: stableShowToast,
      clearAgentEvents: stableClearAgentEvents,
      clearFollowUpAgentEvents: stableClearFollowUpAgentEvents,
    });

    render(<AgentPage />);
    await waitForAgentPanel();

    const input = screen.getByPlaceholderText(/Follow up/i);
    fireEvent.change(input, { target: { value: "Another question?" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => {
      expect(mockSendAgentBoardMessage).toHaveBeenCalled();
    });

    expect(stableClearFollowUpAgentEvents).toHaveBeenCalled();
  });

  it("hydrates follow-up chat from server conversations (skipping create pair)", async () => {
    mockGetBoard.mockResolvedValue({
      ...makeBoard("done"),
      conversations: [
        { role: "user", content: "riset thailand" },
        { role: "assistant", content: "Board created." },
        { role: "user", content: "What were the findings?" },
        { role: "assistant", content: "Stored assistant reply from DB" },
      ],
    });
    getAgentArtifact.mockResolvedValue(null);
    render(<AgentPage />);
    await waitForAgentPanel();

    expect(screen.getByText("What were the findings?")).toBeTruthy();
    expect(screen.getByText("Stored assistant reply from DB")).toBeTruthy();
  });

  it("shows streamed ASK response once via SSE when streamed flag is set", async () => {
    const answer = "The research found three key findings.";
    mockGetBoard.mockResolvedValue(makeBoard("done"));
    getAgentArtifact.mockResolvedValue(null);
    mockSendAgentBoardMessage.mockResolvedValue({
      explanation: answer,
      streamed: true,
      boardUpdated: false,
    });
    mockUseBoard.mockReturnValue({
      activeWorkspaceId: 1,
      agentEvents: [
        {
          type: "agent.card.token",
          columnSlug: "__notfirst__",
          boardId: 2,
          token: answer,
        },
      ],
      showToast: stableShowToast,
      clearAgentEvents: stableClearAgentEvents,
      clearFollowUpAgentEvents: stableClearFollowUpAgentEvents,
    });

    render(<AgentPage />);
    await waitForAgentPanel();

    const input = screen.getByPlaceholderText(/Follow up/i);
    fireEvent.change(input, { target: { value: "What were the findings?" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => {
      expect(mockSendAgentBoardMessage).toHaveBeenCalled();
    });

    expect(screen.getAllByText(answer)).toHaveLength(1);
  });
});

describe("AgentPage __notfirst__ column state", () => {
  it("does not affect column tiles when __notfirst__ events exist", async () => {
    const boardWithColumn: AgentBoard = {
      ...makeBoard("done"),
      columns: [
        {
          id: 10,
          name: "Research",
          slug: "research",
          position: 1,
          reasoning: false,
          systemPrompt: "",
          cards: [
            {
              id: 100,
              columnId: 10,
              title: "EV market overview",
              position: 1,
            },
          ],
        },
      ],
    };
    const followUpEvents: AgentEvent[] = [
      {
        type: "agent.card.token",
        columnSlug: "__notfirst__",
        boardId: 2,
        token: "Follow-up answer text",
      },
    ];
    mockGetBoard.mockResolvedValue(boardWithColumn);
    getAgentArtifact.mockResolvedValue(null);
    mockUseBoard.mockReturnValue({
      activeWorkspaceId: 1,
      agentEvents: followUpEvents,
      showToast: stableShowToast,
      clearAgentEvents: stableClearAgentEvents,
    });

    render(<AgentPage />);
    await waitForAgentPanel();

    expect(screen.getByTestId("success-animation")).toBeTruthy();
    expect(screen.queryByTestId("loading-camel")).toBeNull();
  });
});
