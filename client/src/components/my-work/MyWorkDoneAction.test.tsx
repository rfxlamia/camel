// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceItem } from "../../lib/myWorkTestSupport";
import { resetMyWorkMutationsForTests } from "../../lib/workItemMutations";
import type { MyWorkItem } from "../../types/myWork";
import MyWorkDoneAction from "./MyWorkDoneAction";
import MyWorkRow from "./MyWorkRow";

function makeItem(overrides: Partial<MyWorkItem> = {}): MyWorkItem {
	const key = overrides.key ?? "AT-17";
	return sourceItem(17, "board", key, {
		workspaceId: 7,
		title: "Fix Atlas sync",
		canMarkDone: true,
		markDoneReason: null,
		...overrides,
	});
}

afterEach(() => {
	cleanup();
	resetMyWorkMutationsForTests();
});

describe("MyWorkDoneAction", () => {
	it("disables the action and explains a missing mapping reason", () => {
		const mutation = vi.fn();
		render(
			<MyWorkDoneAction
				item={makeItem({
					canMarkDone: false,
					markDoneReason: "missing_done_mapping",
				})}
				mutation={mutation}
			/>,
		);

		const button = screen.getByRole("button", { name: /mark done/i });
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByRole("note").textContent).toMatch(
			/no done mapping|done status.*configured/i,
		);
		fireEvent.click(button);
		expect(mutation).not.toHaveBeenCalled();
	});

	it("hides Mark done when the item is already terminal", () => {
		const mutation = vi.fn();
		render(
			<MyWorkDoneAction
				item={makeItem({
					canMarkDone: false,
					markDoneReason: "terminal",
				})}
				mutation={mutation}
			/>,
		);

		expect(screen.queryByRole("button", { name: /mark done/i })).toBeNull();
		expect(screen.queryByRole("note")).toBeNull();
	});

	it("disables the action with a pending reason while a mutation is in flight", () => {
		const mutation = vi.fn();
		render(<MyWorkDoneAction item={makeItem()} pending mutation={mutation} />);

		const button = screen.getByRole("button", { name: /mark done/i });
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByRole("note").textContent).toMatch(/in progress/i);
		fireEvent.click(button);
		expect(mutation).not.toHaveBeenCalled();
	});

	it("reconciles a successful mutation for the Active and All projections", async () => {
		const item = makeItem();
		const completed = makeItem({
			statusCategory: "completed",
			status: {
				...item.status,
				category: "completed",
				slot: "done",
				name: "Done",
			},
			canMarkDone: false,
			markDoneReason: "terminal",
			version: 2,
		});
		const mutation = vi.fn().mockResolvedValue(completed);
		const onOptimisticRemove = vi.fn();
		const onSuccess = vi.fn();
		render(
			<MyWorkDoneAction
				item={item}
				mutation={mutation}
				onOptimisticRemove={onOptimisticRemove}
				onSuccess={onSuccess}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /mark done/i }));
		expect(onOptimisticRemove).toHaveBeenCalledWith(item);
		await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(completed));
		expect(screen.getByRole("status").textContent).toMatch(/marked done/i);
		expect(screen.queryByRole("button", { name: /done/i })).toBeNull();
		expect(screen.queryByRole("note")).toBeNull();
	});

	it.each([
		{
			label: "a version conflict",
			error: { status: 409, code: "version_conflict", message: "stale" },
			copy: /someone else updated this item first/i,
		},
		{
			label: "a transient failure",
			error: { status: 503, message: "Service unavailable" },
			copy: /service unavailable/i,
		},
		{
			label: "a WIP limit rejection without a code",
			error: { status: 409, message: "WIP limit reached for this column" },
			copy: /WIP limit reached for this column/i,
		},
		{
			label: "an explicitly coded WIP limit rejection",
			error: {
				status: 409,
				code: "wip_limit_reached",
				message: "WIP limit reached for this column",
			},
			copy: /WIP limit reached for this column/i,
		},
	])("rolls back and refreshes after $label", async ({ error, copy }) => {
		const item = makeItem({ key: "AT-18" });
		const mutation = vi.fn().mockRejectedValue(error);
		const onRollback = vi.fn();
		const onRefresh = vi.fn().mockResolvedValue(undefined);
		render(
			<MyWorkDoneAction
				item={item}
				mutation={mutation}
				onRollback={onRollback}
				onRefresh={onRefresh}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /mark done/i }));
		await waitFor(() => expect(onRollback).toHaveBeenCalledWith(item, error));
		await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
		expect(screen.getByRole("alert").textContent).toMatch(copy);
		expect(
			(screen.getByRole("button", { name: /mark done/i }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
	});

	it("keeps the rollback warning visible when an Active row remounts", async () => {
		const item = makeItem({ key: "AT-18B" });
		const error = { status: 409, code: "version_conflict" };
		const mutation = vi.fn().mockRejectedValue(error);
		render(<MyWorkRow item={item} scope="active" mutation={mutation} />);

		fireEvent.click(screen.getByRole("button", { name: /mark done/i }));
		await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
		expect(screen.getByRole("alert").textContent).toMatch(
			/someone else updated this item first/i,
		);
	});

	it("removes revoked work and refreshes after a membership or assignment 404", async () => {
		const item = makeItem({ key: "AT-19" });
		const error = { status: 404, code: "not_found", message: "Not found" };
		const mutation = vi.fn().mockRejectedValue(error);
		const onUnavailable = vi.fn();
		const onRefresh = vi.fn().mockResolvedValue(undefined);
		render(
			<MyWorkDoneAction
				item={item}
				mutation={mutation}
				onUnavailable={onUnavailable}
				onRefresh={onRefresh}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /mark done/i }));
		await waitFor(() =>
			expect(onUnavailable).toHaveBeenCalledWith(item, error),
		);
		await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
		expect(screen.getByRole("alert").textContent).toMatch(
			/no longer assigned/i,
		);
		expect(
			(screen.getByRole("button", { name: /mark done/i }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("does not reinsert an Active item when an older refresh snapshot arrives after success", async () => {
		const item = makeItem({ key: "AT-20" });
		const completed = makeItem({
			key: "AT-20",
			statusCategory: "completed",
			status: {
				...item.status,
				category: "completed",
				slot: "done",
				name: "Done",
			},
			canMarkDone: false,
			markDoneReason: "terminal",
			version: 2,
		});
		let resolveMutation: (value: MyWorkItem) => void = () => {};
		const mutation = vi.fn(
			() =>
				new Promise<MyWorkItem>((resolve) => {
					resolveMutation = resolve;
				}),
		);
		const view = render(
			<MyWorkRow item={item} scope="active" mutation={mutation} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /mark done/i }));
		await waitFor(() =>
			expect(screen.queryByTestId("my-work-row-7-board-AT-20")).toBeNull(),
		);
		resolveMutation(completed);
		await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));

		// A late response may cause the parent to render the old item again.
		view.rerender(<MyWorkRow item={item} scope="active" mutation={mutation} />);
		expect(screen.queryByTestId("my-work-row-7-board-AT-20")).toBeNull();
	});

	it("retains the completed result in the All projection", async () => {
		const item = makeItem({ key: "AT-21" });
		const completed = makeItem({
			key: "AT-21",
			statusCategory: "completed",
			status: {
				...item.status,
				category: "completed",
				slot: "done",
				name: "Done",
			},
			canMarkDone: false,
			markDoneReason: "terminal",
			version: 2,
		});
		const mutation = vi.fn().mockResolvedValue(completed);
		render(<MyWorkRow item={item} scope="all" mutation={mutation} />);

		fireEvent.click(screen.getByRole("button", { name: /mark done/i }));
		await waitFor(() =>
			expect(screen.queryByTestId("my-work-status-7-board-AT-21")).toBeNull(),
		);
		const row = screen.getByTestId("my-work-row-7-board-AT-21");
		expect(row).toBeTruthy();
		expect(
			within(row).queryByRole("button", { name: /mark done/i }),
		).toBeNull();
		expect(within(row).queryByRole("note")).toBeNull();
		expect(within(row).getByRole("status").textContent).toMatch(/marked done/i);
	});
});
