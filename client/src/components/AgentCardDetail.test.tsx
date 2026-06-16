// client/src/components/AgentCardDetail.test.tsx — NEW FILE (jsdom).
// The component depends on useBoard() (context) and api (network); mock both
// so the test exercises ONLY this component's live-vs-DB selection + states.
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentColumn } from "../types";

const mockUseBoard = vi.fn();
vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

const getAgentCardOutput = vi.fn();
vi.mock("../api", () => ({
	api: { getAgentCardOutput: (...a: unknown[]) => getAgentCardOutput(...a) },
}));

import AgentCardDetail from "./AgentCardDetail";

const COLUMN: AgentColumn = {
	id: 1,
	slug: "analysis-specialist",
	name: "Analysis",
	position: 1,
	reasoning: true,
	systemPrompt: "You analyze.",
	cards: [],
};

function setBoard(agentEvents: unknown[]) {
	mockUseBoard.mockReturnValue({ activeWorkspaceId: 1, agentEvents });
}

beforeEach(() => {
	getAgentCardOutput.mockReset();
	mockUseBoard.mockReset();
	getAgentCardOutput.mockResolvedValue({
		columnSlug: "analysis-specialist",
		output: "DB FINAL OUTPUT",
		thinking: "DB FINAL THINKING",
	});
});
afterEach(() => vi.clearAllMocks());

describe("AgentCardDetail live-vs-DB selection", () => {
	it("renders LIVE thinking when live events exist for board+slug (not DB)", async () => {
		setBoard([
			{
				type: "agent.card.thinking",
				boardId: 5,
				columnSlug: "analysis-specialist",
				token: "LIVE THINKING STREAM",
			},
		]);
		render(<AgentCardDetail column={COLUMN} boardId={5} onClose={() => {}} />);
		expect(await screen.findByText(/LIVE THINKING STREAM/)).toBeTruthy();
		expect(screen.queryByText(/DB FINAL THINKING/)).toBeNull();
	});

	it("renders LIVE output when live token events exist", async () => {
		setBoard([
			{
				type: "agent.card.token",
				boardId: 5,
				columnSlug: "analysis-specialist",
				token: "LIVE OUTPUT STREAM",
			},
		]);
		render(<AgentCardDetail column={COLUMN} boardId={5} onClose={() => {}} />);
		expect(await screen.findByText(/LIVE OUTPUT STREAM/)).toBeTruthy();
	});

	it("falls back to DB output/thinking when no live events exist", async () => {
		setBoard([]);
		render(<AgentCardDetail column={COLUMN} boardId={5} onClose={() => {}} />);
		await waitFor(() =>
			expect(screen.getByText(/DB FINAL OUTPUT/)).toBeTruthy(),
		);
	});

	it("shows a distinct failed state when the column failed (not generic empty)", async () => {
		getAgentCardOutput.mockResolvedValue(null);
		setBoard([
			{
				type: "agent.card.failed",
				boardId: 5,
				columnSlug: "analysis-specialist",
				error: "LLM timeout",
			},
		]);
		const { container } = render(
			<AgentCardDetail column={COLUMN} boardId={5} onClose={() => {}} />,
		);
		await waitFor(() =>
			expect(container.textContent?.toLowerCase()).toMatch(/fail|gagal/),
		);
	});

	it("badge does not show a misleading OFF (thinking enabled for all columns)", async () => {
		setBoard([]);
		const offColumn = { ...COLUMN, reasoning: false };
		const { container } = render(
			<AgentCardDetail column={offColumn} boardId={5} onClose={() => {}} />,
		);
		await waitFor(() => expect(getAgentCardOutput).toHaveBeenCalled());
		// The stale "OFF" badge must be gone — extended thinking is on for all.
		expect(container.textContent).not.toContain("OFF");
	});
});
