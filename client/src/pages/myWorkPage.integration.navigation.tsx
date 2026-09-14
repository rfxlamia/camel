// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	makeItem,
	networkFor,
	openDetailFor,
	renderSurface,
	setViewportWidth,
} from "./myWorkPage.integration.harness";

function urlItems() {
	return Array.from({ length: 51 }, (_, index) =>
		makeItem({
			id: 100 + index,
			key: `AT-${100 + index}`,
			title: `Atlas work ${index + 1}`,
			source: "board",
			workspaceId: 7,
		}),
	);
}

async function applyUrlFilters() {
	fireEvent.change(screen.getByLabelText("Filter by workspace"), {
		target: { value: "7" },
	});
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toContain(
			"workspaceId=7",
		),
	);
	fireEvent.change(screen.getByLabelText("Filter by source"), {
		target: { value: "board" },
	});
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toContain(
			"source=board",
		),
	);
}

async function closeDetailAndAssert(
	item: ReturnType<typeof makeItem>,
	detail: HTMLElement,
) {
	fireEvent.click(
		within(detail).getByRole("button", { name: "Close details" }),
	);
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe(
			"/my-work?workspaceId=7&source=board&page=2",
		),
	);
	expect(
		screen.queryByRole("dialog", { name: new RegExp(item.key) }),
	).toBeNull();
	expect(screen.getByTestId("active-workspace").textContent).toBe("999");
}

async function runUrlDetailScenario() {
	const items = urlItems();
	const item = items[50]!;
	networkFor(item, { items, nextCursor: null });
	renderSurface("/my-work");
	await waitFor(() => expect(screen.getByText(items[0]!.key)).toBeTruthy());
	await waitFor(() =>
		expect(screen.getByTestId("active-workspace").textContent).toBe("999"),
	);
	await applyUrlFilters();
	await waitFor(() =>
		expect(screen.queryByTestId("my-work-loading")).toBeNull(),
	);
	fireEvent.click(screen.getByRole("button", { name: /next page/i }));
	await waitFor(() => expect(screen.getByText(item.key)).toBeTruthy());
	await waitFor(() =>
		expect(screen.queryByTestId("my-work-loading")).toBeNull(),
	);
	const detail = await openDetailFor(item);
	expect(screen.getByTestId("location").textContent).toBe(
		`/my-work?workspaceId=7&source=board&page=2&detailWorkspaceId=7&detailSource=board&detailKey=${item.key}`,
	);
	expect(screen.getByTestId("active-workspace").textContent).toBe("999");
	await closeDetailAndAssert(item, detail);
}

const sourceGuardScenarios = [
	["Board allowed", "board", 17, "AT-17", "allowed"],
	["Tracker allowed", "tracker", 27, "OR-27", "allowed"],
	["Board focus-blocked", "board", 18, "AT-18", "blocked"],
	["Tracker focus-blocked", "tracker", 28, "OR-28", "blocked"],
	["Board confirmation-canceled", "board", 19, "AT-19", "canceled"],
	["Tracker confirmation-canceled", "tracker", 29, "OR-29", "canceled"],
] as const;

type GuardOutcome = (typeof sourceGuardScenarios)[number][4];

async function allowSource(
	item: ReturnType<typeof makeItem>,
	detail: HTMLElement,
) {
	const label = item.source === "board" ? "Board" : "Tracker";
	fireEvent.click(screen.getByRole("button", { name: "Allow transition" }));
	fireEvent.click(
		within(detail).getByRole("button", { name: `Open in ${label}` }),
	);
	await waitFor(() =>
		expect(screen.getByTestId(`${item.source}-route`)).toBeTruthy(),
	);
	expect(screen.getByTestId("active-workspace").textContent).toBe("7");
	expect(screen.getByTestId("location").textContent).toBe(
		item.source === "board" ? `/board/card/${item.id}` : `/tracker/${item.key}`,
	);
}

async function blockSource(
	item: ReturnType<typeof makeItem>,
	detail: HTMLElement,
) {
	const label = item.source === "board" ? "Board" : "Tracker";
	fireEvent.click(screen.getByRole("button", { name: "Block focus" }));
	fireEvent.click(
		within(detail).getByRole("button", { name: `Open in ${label}` }),
	);
	await waitFor(() =>
		expect(screen.getByTestId("guard-toast").textContent).toMatch(
			/finish your focus session/i,
		),
	);
}

async function cancelSource(
	item: ReturnType<typeof makeItem>,
	detail: HTMLElement,
) {
	const label = item.source === "board" ? "Board" : "Tracker";
	fireEvent.click(screen.getByRole("button", { name: "Require confirmation" }));
	fireEvent.click(
		within(detail).getByRole("button", { name: `Open in ${label}` }),
	);
	const confirmation = await screen.findByRole("dialog", {
		name: "Confirm workspace switch",
	});
	fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
	await waitFor(() =>
		expect(
			screen.queryByRole("dialog", { name: "Confirm workspace switch" }),
		).toBeNull(),
	);
}

async function runSourceGuardScenario(
	item: ReturnType<typeof makeItem>,
	outcome: GuardOutcome,
) {
	const detail = await openDetailFor(item);
	if (outcome === "allowed") return allowSource(item, detail);
	if (outcome === "blocked") await blockSource(item, detail);
	else await cancelSource(item, detail);
	expect(screen.getByTestId("active-workspace").textContent).toBe("999");
	expect(screen.getByTestId("location").textContent).toContain("/my-work");
	expect(screen.queryByTestId(`${item.source}-route`)).toBeNull();
	expect(
		screen.getByRole("dialog", { name: new RegExp(item.key) }),
	).toBeTruthy();
}

describe("My Work navigation integration", () => {
	// Cycle 1 — route/detail/back state.
	it(
		"preserves URL state and active workspace through filters, detail, and back",
		runUrlDetailScenario,
	);

	// Cycle 2 — guarded source navigation.
	it.each(
		sourceGuardScenarios,
	)("handles %s through the real workspace guard", async (label, source, id, key, outcome) => {
		const item = makeItem({
			id,
			key,
			title: `${label} work`,
			source,
			workspaceId: 7,
		});
		networkFor(item);
		renderSurface("/my-work?scope=active&workspaceId=7&page=2");
		await waitFor(() => expect(screen.getByText(item.key)).toBeTruthy());
		await runSourceGuardScenario(item, outcome);
	});

	// Cycle 3 — mobile detail bottom sheet.
	it("renders and closes the real detail bottom sheet at a 390px viewport", async () => {
		setViewportWidth(390);
		const item = makeItem({
			id: 20,
			key: "OR-20",
			title: "Mobile Orbit work",
			source: "tracker",
			workspaceId: 7,
		});
		networkFor(item);
		renderSurface("/my-work?scope=active");
		await waitFor(() => expect(screen.getByText(item.key)).toBeTruthy());
		const detail = await openDetailFor(item);
		expect(window.innerWidth).toBe(390);
		expect(detail.parentElement?.className).toContain("items-end");
		expect(detail.className).toContain("w-full");
		expect(detail.className).toContain("rounded-t-lg");
		fireEvent.click(
			within(detail).getByRole("button", { name: "Close details" }),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.getByTestId("location").textContent).toBe(
			"/my-work?scope=active",
		);
	});
});
