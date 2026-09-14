import { describe, expect, it, afterEach } from "vitest";
import { sourceItem } from "./myWorkTestSupport";
import {
	projectMyWorkListItems,
	reconcileMyWorkMutations,
} from "./myWorkMutationReconciliation";
import {
	beginMyWorkMutation,
	resetMyWorkMutationsForTests,
	settleMyWorkMutation,
} from "./workItemMutations";

afterEach(() => resetMyWorkMutationsForTests());

describe("reconcileMyWorkMutations", () => {
	it("drops a success overlay when the server row has a newer version", () => {
		const item = sourceItem(17, "board", "AT-17", { version: 3 });
		const sequence = beginMyWorkMutation(item);
		settleMyWorkMutation(
			item,
			sequence,
			"success",
			sourceItem(17, "board", "AT-17", { version: 2 }),
		);

		reconcileMyWorkMutations([item]);

		expect(projectMyWorkListItems([item], "active")).toEqual([item]);
	});

	it("drops an unavailable tombstone after an authorized read", () => {
		const item = sourceItem(17, "board", "AT-17");
		const sequence = beginMyWorkMutation(item);
		settleMyWorkMutation(item, sequence, "unavailable", item);

		reconcileMyWorkMutations([item]);

		expect(projectMyWorkListItems([item], "active")).toEqual([item]);
	});
});

describe("projectMyWorkListItems", () => {
	it("moves a completed item into the Done group projection for All", () => {
		const item = sourceItem(17, "board", "AT-17");
		const completed = sourceItem(17, "board", "AT-17", {
			statusCategory: "completed",
			status: {
				...item.status,
				category: "completed",
				slot: "done",
				name: "Done",
			},
			version: 2,
		});
		const sequence = beginMyWorkMutation(item);
		settleMyWorkMutation(item, sequence, "success", completed);

		const projected = projectMyWorkListItems([item], "all");
		expect(projected).toHaveLength(1);
		expect(projected[0]?.statusCategory).toBe("completed");
	});
});
