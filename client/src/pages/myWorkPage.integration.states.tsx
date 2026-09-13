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
});
