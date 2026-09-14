// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	createNetwork,
	jsonResponse,
	makeItem,
	openDetailFor,
	renderSurface,
	response,
} from "./myWorkPage.integration.harness";

async function runErrorRecovery() {
	const item = makeItem({
		id: 21,
		key: "AT-21",
		title: "Recovered Atlas work",
		source: "board",
		workspaceId: 7,
	});
	let listCalls = 0;
	createNetwork((url) => {
		if (url.pathname === "/api/my-work") {
			listCalls += 1;
			return listCalls === 1
				? jsonResponse({ error: "Request timed out" }, 503)
				: jsonResponse(response([item]));
		}
		return jsonResponse(item);
	});
	renderSurface("/my-work");
	await waitFor(() => expect(screen.getByTestId("my-work-error")).toBeTruthy());
	expect(screen.getByRole("alert").textContent).toMatch(/timed out/i);
	expect(screen.queryByText(item.title)).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: /try again/i }));
	await waitFor(() => expect(screen.getByText(item.title)).toBeTruthy());
	expect(listCalls).toBe(2);
}

async function runActiveEmptyNavigation() {
	const historical = makeItem({
		id: 22,
		key: "OR-22",
		title: "Completed Orbit handoff",
		source: "tracker",
		workspaceId: 7,
		statusCategory: "completed",
	});
	let activeCalls = 0;
	let allCalls = 0;
	createNetwork((url) => {
		if (url.pathname === "/api/my-work") {
			if (url.searchParams.get("scope") === "all") {
				allCalls += 1;
				return jsonResponse(response([historical]));
			}
			activeCalls += 1;
			return jsonResponse(response([]));
		}
		return jsonResponse(historical);
	});
	renderSurface("/my-work");
	await waitFor(() =>
		expect(screen.getByTestId("my-work-empty-active")).toBeTruthy(),
	);
	fireEvent.click(screen.getByRole("button", { name: /view all work/i }));
	await waitFor(() => expect(screen.getByText(historical.title)).toBeTruthy());
	expect(screen.getByTestId("location").textContent).toBe("/my-work?scope=all");
	expect(activeCalls).toBe(1);
	expect(allCalls).toBe(1);
}

function setupAllCursorNetwork(
	firstPage: ReturnType<typeof makeItem>,
	secondPage: ReturnType<typeof makeItem>,
	queryPage: ReturnType<typeof makeItem>,
) {
	const allRequests: URL[] = [];
	createNetwork((url) => {
		if (url.pathname === "/api/my-work") {
			allRequests.push(url);
			return allRequests.length === 1
				? jsonResponse(response([firstPage], "history-1"))
				: allRequests.length === 2
					? jsonResponse(response([secondPage]))
					: jsonResponse(response([queryPage]));
		}
		return jsonResponse(queryPage);
	});
	return allRequests;
}

async function runAllCursorScenario() {
	const firstPage = makeItem({
		id: 23,
		key: "AT-23",
		title: "First history page",
		statusCategory: "completed",
	});
	const secondPage = makeItem({
		id: 24,
		key: "AT-24",
		title: "Second history page",
		statusCategory: "completed",
	});
	const queryPage = makeItem({
		id: 25,
		key: "AT-25",
		title: "Search result page",
		statusCategory: "completed",
	});
	const allRequests = setupAllCursorNetwork(firstPage, secondPage, queryPage);
	renderSurface("/my-work?scope=all");
	await waitFor(() => expect(screen.getByText(firstPage.title)).toBeTruthy());
	fireEvent.click(screen.getByRole("button", { name: /next page/i }));
	await waitFor(() => expect(screen.getByText(secondPage.title)).toBeTruthy());
	expect(allRequests[1]?.searchParams.get("cursor")).toBe("history-1");
	fireEvent.change(screen.getByLabelText("Search My Work"), {
		target: { value: "needle" },
	});
	await waitFor(() => expect(screen.getByText(queryPage.title)).toBeTruthy());
	expect(allRequests).toHaveLength(3);
	expect(
		allRequests.every(
			(url) =>
				url.searchParams.get("scope") === "all" &&
				url.searchParams.get("limit") === "50",
		),
	).toBe(true);
	expect(allRequests[2]?.searchParams.get("q")).toBe("needle");
	expect(allRequests[2]?.searchParams.get("cursor")).toBeNull();
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function raceItems() {
	const item = makeItem({
		id: 26,
		key: "AT-26",
		title: "Race-protected Atlas work",
		source: "board",
		workspaceId: 7,
	});
	return {
		item,
		retained: makeItem({
			id: 26,
			key: "AT-26",
			title: "Fresh conflict snapshot",
			source: "board",
			workspaceId: 7,
			version: 2,
		}),
		stale: makeItem({
			id: 26,
			key: "AT-26",
			title: "Stale older snapshot",
			source: "board",
			workspaceId: 7,
		}),
	};
}

function setupRaceNetwork(item: ReturnType<typeof raceItems>["item"]) {
	const mutation = deferred<Response>();
	const older = deferred<Response>();
	const newer = deferred<Response>();
	let activeListCalls = 0;
	let mutationCalls = 0;
	let mutationMethod: string | undefined;
	createNetwork((url, init) => {
		if (url.pathname === "/api/my-work") {
			activeListCalls += 1;
			if (activeListCalls === 1) return jsonResponse(response([item]));
			if (activeListCalls === 2) return older.promise;
			return newer.promise;
		}
		if (url.pathname.endsWith("/done")) {
			mutationCalls += 1;
			mutationMethod = init?.method;
			return mutation.promise;
		}
		return jsonResponse(item);
	});
	return {
		activeListCalls: () => activeListCalls,
		mutationCalls: () => mutationCalls,
		mutationMethod: () => mutationMethod,
		releaseMutation: mutation.resolve,
		releaseOlder: older.resolve,
		releaseNewer: newer.resolve,
	};
}

async function runRollbackRace() {
	const { item, retained, stale } = raceItems();
	const race = setupRaceNetwork(item);
	renderSurface("/my-work?scope=active&workspaceId=7");
	await waitFor(() => expect(screen.getByText(item.title)).toBeTruthy());
	const detail = await openDetailFor(item);
	const rowId = "my-work-row-7-board-AT-26";
	expect(screen.getByTestId(rowId)).toBeTruthy();
	fireEvent.click(within(detail).getByRole("button", { name: "Mark done" }));
	await waitFor(() => expect(screen.queryByTestId(rowId)).toBeNull());
	await waitFor(() => expect(race.mutationCalls()).toBe(1));
	expect(race.mutationMethod()).toBe("POST");
	fireEvent.click(screen.getByRole("button", { name: "Refresh My Work" }));
	await waitFor(() => expect(race.activeListCalls()).toBe(2));
	race.releaseMutation(
		jsonResponse({ error: "stale", code: "version_conflict" }, 409),
	);
	await waitFor(() => expect(race.activeListCalls()).toBe(3));
	await waitFor(() =>
		expect(within(detail).getByRole("alert").textContent).toMatch(
			/someone else updated this item first/i,
		),
	);
	race.releaseNewer(jsonResponse(response([retained])));
	const retainedRow = await screen.findByTestId(rowId);
	expect(within(retainedRow).getByText(retained.title)).toBeTruthy();
	expect(within(retainedRow).getByRole("alert").textContent).toMatch(
		/someone else updated this item first/i,
	);
	race.releaseOlder(jsonResponse(response([stale])));
	await waitFor(() => {
		expect(screen.getByTestId(rowId)).toBe(retainedRow);
		expect(screen.getByTestId(rowId).textContent).toContain(retained.title);
		expect(screen.queryByText(stale.title)).toBeNull();
	});
	expect(race.activeListCalls()).toBe(3);
}

describe("My Work state integration", () => {
	// Cycle 4 — transient whole-page error/retry.
	it(
		"shows a whole-page error and retries the complete request",
		runErrorRecovery,
	);

	// Cycle 5 — Active empty state.
	it(
		"offers All navigation from an empty Active scope with history available",
		runActiveEmptyNavigation,
	);

	// Cycle 6 — server-backed All query/cursor.
	it(
		"uses server cursors for All pages and starts a bounded query request",
		runAllCursorScenario,
	);

	// Cycle 7 — Mark done conflict rollback/refresh race.
	it(
		"observes optimistic removal, conflict rollback, and stale refresh protection",
		runRollbackRace,
	);

	it("filters Active search locally without refetching or dropping the truncated banner", async () => {
		const alpha = makeItem({
			id: 27,
			key: "AT-27",
			title: "Alpha task",
			source: "board",
			workspaceId: 7,
		});
		const beta = makeItem({
			id: 28,
			key: "AT-28",
			title: "Beta task",
			source: "board",
			workspaceId: 7,
		});
		let activeListCalls = 0;
		createNetwork((url) => {
			if (url.pathname === "/api/my-work") {
				activeListCalls += 1;
				const drainPage = Number(url.searchParams.get("cursor")?.slice(7) ?? 0);
				return jsonResponse(
					response(
						drainPage === 0 ? [alpha, beta] : [],
						`cursor-${drainPage + 1}`,
					),
				);
			}
			return jsonResponse(alpha);
		});
		renderSurface("/my-work");

		const alphaRowId = "my-work-row-7-board-AT-27";
		await waitFor(() => expect(screen.getByTestId(alphaRowId)).toBeTruthy());
		expect(screen.getByTestId("my-work-row-7-board-AT-28")).toBeTruthy();
		expect(
			screen.getByText(/Showing the first 2 active matches/i),
		).toBeTruthy();
		const callsAfterLoad = activeListCalls;
		expect(callsAfterLoad).toBeGreaterThan(1);
		const alphaRow = screen.getByTestId(alphaRowId);

		fireEvent.change(screen.getByLabelText("Search My Work"), {
			target: { value: "alpha" },
		});
		await waitFor(() =>
			expect(screen.queryByTestId("my-work-row-7-board-AT-28")).toBeNull(),
		);
		expect(screen.getByTestId(alphaRowId)).toBe(alphaRow);
		expect(
			screen.getByText(/Showing the first 1 active matches/i),
		).toBeTruthy();
		expect(screen.queryByTestId("my-work-loading")).toBeNull();
		expect(activeListCalls).toBe(callsAfterLoad);

		fireEvent.change(screen.getByLabelText("Search My Work"), {
			target: { value: "zzz-no-match" },
		});
		await waitFor(() => expect(screen.queryByTestId(alphaRowId)).toBeNull());
		expect(screen.queryByTestId("my-work-row-7-board-AT-28")).toBeNull();
		expect(screen.queryByTestId("my-work-loading")).toBeNull();
		expect(activeListCalls).toBe(callsAfterLoad);

		fireEvent.change(screen.getByLabelText("Search My Work"), {
			target: { value: "" },
		});
		await waitFor(() =>
			expect(screen.getByTestId("my-work-row-7-board-AT-28")).toBeTruthy(),
		);
		expect(screen.getByTestId(alphaRowId)).toBeTruthy();
		expect(
			screen.getByText(/Showing the first 2 active matches/i),
		).toBeTruthy();
		expect(activeListCalls).toBe(callsAfterLoad);
	});

	it("re-paginates Active search from the filtered candidate set", async () => {
		const items = [
			...Array.from({ length: 50 }, (_, index) =>
				makeItem({
					id: 200 + index,
					key: `AT-${200 + index}`,
					title: `Alpha task ${index + 1}`,
					source: "board",
					workspaceId: 7,
				}),
			),
			makeItem({
				id: 250,
				key: "AT-250",
				title: "Zebra unique",
				source: "board",
				workspaceId: 7,
			}),
		];
		let activeListCalls = 0;
		createNetwork((url) => {
			if (url.pathname === "/api/my-work") {
				activeListCalls += 1;
				return jsonResponse(response(items));
			}
			return jsonResponse(items[0]!);
		});
		renderSurface("/my-work");
		await waitFor(() => expect(screen.getByText("Alpha task 1")).toBeTruthy());
		fireEvent.click(screen.getByRole("button", { name: /next page/i }));
		await waitFor(() => expect(screen.getByText("Zebra unique")).toBeTruthy());

		fireEvent.change(screen.getByLabelText("Search My Work"), {
			target: { value: "zebra unique" },
		});
		await waitFor(() => expect(screen.getByText("Zebra unique")).toBeTruthy());
		expect(screen.queryByText("Alpha task 1")).toBeNull();
		expect(activeListCalls).toBe(1);

		fireEvent.change(screen.getByLabelText("Search My Work"), {
			target: { value: "alpha task 1" },
		});
		await waitFor(() => expect(screen.getByText("Alpha task 1")).toBeTruthy());
		expect(screen.queryByText("Zebra unique")).toBeNull();
		expect(activeListCalls).toBe(1);
	});

	it("does not keep the previous workspace list while a new Active request is in flight", async () => {
		const atlas = makeItem({
			id: 28,
			key: "AT-28",
			title: "Atlas only",
			source: "board",
			workspaceId: 7,
			workspaceName: "Atlas",
		});
		const orbit = makeItem({
			id: 29,
			key: "OR-29",
			title: "Orbit only",
			source: "board",
			workspaceId: 12,
			workspaceName: "Orbit",
		});
		const second = deferred<Response>();
		let activeListCalls = 0;
		createNetwork((url) => {
			if (url.pathname === "/api/my-work") {
				activeListCalls += 1;
				if (activeListCalls === 1)
					return jsonResponse(response([atlas, orbit]));
				return second.promise;
			}
			return jsonResponse(orbit);
		});
		renderSurface("/my-work");
		await waitFor(() => expect(screen.getByText("Atlas only")).toBeTruthy());
		fireEvent.change(screen.getByLabelText("Filter by workspace"), {
			target: { value: "12" },
		});
		await waitFor(() =>
			expect(screen.getByTestId("location").textContent).toContain(
				"workspaceId=12",
			),
		);
		expect(screen.queryByText("Atlas only")).toBeNull();
		expect(screen.queryByText("Orbit only")).toBeNull();
		second.resolve(jsonResponse(response([orbit])));
		await waitFor(() => expect(screen.getByText("Orbit only")).toBeTruthy());
		expect(activeListCalls).toBe(2);
	});

	it("does not keep the previous All page while a new search request is in flight", async () => {
		const first = makeItem({
			id: 23,
			key: "AT-23",
			title: "First history page",
			statusCategory: "completed",
		});
		const queryPage = makeItem({
			id: 25,
			key: "AT-25",
			title: "Search result page",
			statusCategory: "completed",
		});
		const pending = deferred<Response>();
		let allCalls = 0;
		createNetwork((url) => {
			if (url.pathname === "/api/my-work") {
				allCalls += 1;
				if (allCalls === 1) return jsonResponse(response([first]));
				return pending.promise;
			}
			return jsonResponse(queryPage);
		});
		renderSurface("/my-work?scope=all");
		await waitFor(() => expect(screen.getByText(first.title)).toBeTruthy());
		fireEvent.change(screen.getByLabelText("Search My Work"), {
			target: { value: "needle" },
		});
		await waitFor(() =>
			expect(screen.getByTestId("location").textContent).toContain("q=needle"),
		);
		expect(screen.queryByText(first.title)).toBeNull();
		pending.resolve(jsonResponse(response([queryPage])));
		await waitFor(() => expect(screen.getByText(queryPage.title)).toBeTruthy());
		expect(allCalls).toBe(2);
	});
});
