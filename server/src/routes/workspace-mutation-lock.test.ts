import { describe, expect, it } from "vitest";
import { lockTaskCreateReferences } from "./workspace-mutation-lock.js";

function recordingExecutor() {
	const calls: string[] = [];
	const executor: any = {
		selectFrom(table: string) {
			calls.push(`select:${table}`);
			const query: any = {
				select: () => query,
				innerJoin: () => query,
				where: (column: string, operator: string, value: unknown) => {
					if (operator === "in") {
						calls.push(`ids:${table}:${column}:${JSON.stringify(value)}`);
					}
					return query;
				},
				orderBy: (column: string) => {
					calls.push(`order:${table}:${column}`);
					return query;
				},
				forUpdate: () => {
					calls.push(`lock:${table}`);
					return query;
				},
				execute: async () => [],
				executeTakeFirst: async () => ({ id: 7 }),
			};
			return query;
		},
	};
	return { executor, calls };
}

describe("lockTaskCreateReferences", () => {
	it("orders deterministic workspace and reference locks", async () => {
		const { executor, calls } = recordingExecutor();

		await lockTaskCreateReferences(executor, 7, {
			assigneeIds: [9, 2],
			statusId: 14,
			priorityId: 11,
			labelIds: [13, 3],
			projectId: 21,
			phaseId: 8,
			destinationColumnId: 55,
		});

		expect(calls).toEqual([
			"select:workspaces",
			"lock:workspaces",
			"select:workspace_members",
			"ids:workspace_members:user_id:[2,9]",
			"order:workspace_members:user_id",
			"lock:workspace_members",
			"select:tracker_vocabularies",
			"ids:tracker_vocabularies:id:[3,11,13,14]",
			"order:tracker_vocabularies:id",
			"lock:tracker_vocabularies",
			"select:tracker_projects",
			"ids:tracker_projects:id:[21]",
			"order:tracker_projects:id",
			"lock:tracker_projects",
			"select:tracker_phases as tp",
			"ids:tracker_phases as tp:tp.id:[8]",
			"order:tracker_phases as tp:tp.id",
			"lock:tracker_phases as tp",
			"select:columns",
			"lock:columns",
		]);
	});
});
