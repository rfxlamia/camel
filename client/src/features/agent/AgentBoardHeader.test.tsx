import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentBoard } from "../../types";
import AgentBoardHeader from "./AgentBoardHeader";

afterEach(cleanup);
describe("previous attempt", () => {
	it("links a fresh retry to its preserved source", () => {
		const board = {
			id: 2,
			retryOfBoardId: 1,
			originalIntent: "Plan",
			templateId: "dev-team",
			createdAt: new Date().toISOString(),
			status: "approved",
			executionStatus: "running",
		} as unknown as AgentBoard;
		render(
			<MemoryRouter initialEntries={["/agent?boardId=2"]}>
				<AgentBoardHeader board={board} onNewBoard={vi.fn()} />
			</MemoryRouter>,
		);
		expect(
			screen
				.getByRole("link", { name: "Previous attempt" })
				.getAttribute("href"),
		).toBe("/agent?boardId=1");
	});
	it("has no previous-attempt link on an original board", () => {
		const board = {
			id: 1,
			originalIntent: "Plan",
			templateId: "dev-team",
			createdAt: new Date().toISOString(),
			status: "approved",
			executionStatus: "failed",
		} as unknown as AgentBoard;
		render(
			<MemoryRouter>
				<AgentBoardHeader board={board} onNewBoard={vi.fn()} />
			</MemoryRouter>,
		);
		expect(screen.queryByRole("link", { name: "Previous attempt" })).toBeNull();
	});
});
