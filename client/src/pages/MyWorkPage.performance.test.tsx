// @vitest-environment jsdom
// Controlled performance environment: Vitest + jsdom on the Node runner with
// only the HTTP fetch boundary replaced. The page, hooks, and presentation
// helpers remain real.
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	configureRequestBoundaryForTests,
	resetRequestBoundaryForTests,
} from "../api";
import type { MyWorkItem } from "../types/myWork";
import MyWorkPage from "./MyWorkPage";

function makeReadyItem(): MyWorkItem {
	return {
		id: 1,
		key: "MW-1",
		title: "Performance check",
		description: "",
		source: "tracker",
		status: {
			id: 1,
			kind: "status",
			name: "In progress",
			position: 1,
			colour: "blue",
			category: "started",
			slot: "in_progress",
		},
		priority: null,
		labels: [],
		assignees: [],
		version: 1,
		createdAt: "2026-09-11T00:00:00.000Z",
		updatedAt: "2026-09-11T00:00:00.000Z",
		workspace: {
			id: 1,
			name: "My Work",
			timezone: "UTC",
		},
		workspaceId: 1,
		workspaceName: "My Work",
		identity: { workspaceId: 1, source: "tracker", key: "MW-1" },
		statusCategory: "started",
		canMarkDone: true,
		markDoneReason: null,
	};
}

afterEach(() => {
	cleanup();
	resetRequestBoundaryForTests();
	vi.restoreAllMocks();
});

describe("MyWorkPage initial readiness", () => {
	it("renders the usable toolbar and list state within one second", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ items: [makeReadyItem()], nextCursor: null }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			);
		configureRequestBoundaryForTests({ fetchImpl });

		render(
			<MemoryRouter initialEntries={["/my-work"]}>
				<MyWorkPage />
			</MemoryRouter>,
		);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		const row = await screen.findByTestId("my-work-row-1-tracker-MW-1");
		const toolbar = screen.getByRole("group", { name: "My Work scope" });

		expect(row).toBeTruthy();
		expect(toolbar).toBeTruthy();
		expect(screen.getByLabelText("Search My Work")).toBeTruthy();
		expect(process.version).toMatch(/^v\d+/);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
			"/api/my-work?scope=active&limit=50",
		);
	});
});
