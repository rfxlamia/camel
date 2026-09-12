import { expect } from "vitest";
import {
	decodeMyWorkCursor,
	isMyWorkItemOverdue,
	type MyWorkCursor,
	type MyWorkListResponse,
	type MyWorkSerializedItem,
	type MyWorkTrackerRow,
} from "./my-work-response.js";
import { type CapturedQuery, NOW, ORBIT } from "./my-work-test-support.js";
import type { RawTimestampTrackerRow } from "./my-work-pagination-test-support.js";

export function expectOverduePageShape(pages: MyWorkListResponse[]): void {
	expect(pages).toHaveLength(2);
	expect(pages[0]?.items).toHaveLength(50);
	expect(pages[1]?.items).toHaveLength(23);
	expect(pages[0]?.nextCursor).not.toBeNull();
	expect(pages[1]?.nextCursor).toBeNull();
}

export function expectOverdueItems(
	pages: MyWorkListResponse[],
	rows: MyWorkTrackerRow[],
): void {
	const items = pages.flatMap((page) => page.items);
	const expectedIdentities = rows.map((row) => ({
		workspaceId: ORBIT.id,
		source: "tracker" as const,
		key: `OR-${row.key_number}`,
	}));
	expect(items.map((item) => item.identity)).toEqual(expectedIdentities);
	const identityStrings = items.map((item) => JSON.stringify(item.identity));
	expect(new Set(identityStrings).size).toBe(73);
	expect(items).toHaveLength(73);

	const numericKeys = items
		.filter((item) => item.key === "OR-2" || item.key === "OR-10")
		.map((item) => item.key);
	expect(numericKeys).toEqual(["OR-2", "OR-10"]);
	expectOverdueControls(items);
}

function expectOverdueControls(items: MyWorkSerializedItem[]): void {
	const unknownDone = items.find((item) => item.key === "OR-2");
	expect(unknownDone).toMatchObject({
		statusCategory: null,
		status: { category: "mystery", slot: "done" },
	});
	expect(isMyWorkItemOverdue(unknownDone!, NOW)).toBe(true);
	const dueToday = items.find((item) => item.key === "OR-56");
	expect(isMyWorkItemOverdue(dueToday!, NOW)).toBe(false);
	const undefinedControl = items.find((item) => item.key === "OR-71");
	expect(undefinedControl).toMatchObject({ statusCategory: "started" });
	expect(isMyWorkItemOverdue(undefinedControl!, NOW)).toBe(true);
	const nullControl = items.find((item) => item.key === "OR-72");
	expect(nullControl).toMatchObject({
		statusCategory: "completed",
		status: { category: null, slot: "done" },
	});
	expect(isMyWorkItemOverdue(nullControl!, NOW)).toBe(false);
	const canceledControl = items.find((item) => item.key === "OR-73");
	expect(isMyWorkItemOverdue(canceledControl!, NOW)).toBe(false);
}

export function expectOverdueQueries(
	queries: CapturedQuery[],
	firstCursor: MyWorkCursor | null,
): void {
	const trackerQueries = queries.filter((entry) =>
		entry.sql.includes('from "tracker_items"'),
	);
	expect(trackerQueries).toHaveLength(2);
	const firstQuery = trackerQueries[0]!;
	const secondQuery = trackerQueries[1]!;
	expect(firstQuery.sql).toContain("NOT IN (2, 3)");
	expect(firstQuery.sql).not.toContain(" < 2");
	expect(firstQuery.sql).toContain('"ti"."key_number" asc');
	expect(firstQuery.sql).toContain('"ti"."id" asc');
	expect(firstQuery.parameters).toContain("2026-09-11");
	expect(firstQuery.parameters).toContain(51);
	expect(secondQuery.sql).toContain('"ti"."key_number" =');
	expect(secondQuery.sql).toContain('"ti"."id" >');
	expect(secondQuery.parameters).toContain(firstCursor?.keyNumber);
	expect(secondQuery.parameters).toContain(firstCursor?.id);
	expect(secondQuery.parameters).toContain(51);
}

export function expectPrecisionPages(
	pages: MyWorkListResponse[],
	rows: RawTimestampTrackerRow[],
): void {
	expect(pages).toHaveLength(3);
	expect(pages.map((page) => page.items.map((item) => item.key))).toEqual([
		["OR-1"],
		["OR-2"],
		["OR-3"],
	]);
	expect(pages[0]?.nextCursor).not.toBeNull();
	expect(pages[1]?.nextCursor).not.toBeNull();
	expect(pages[2]?.nextCursor).toBeNull();

	const identities = pages.flatMap((page) =>
		page.items.map((item) => item.identity),
	);
	expect(identities).toEqual(
		rows.map(({ row }) => ({
			workspaceId: ORBIT.id,
			source: "tracker" as const,
			key: `OR-${row.key_number}`,
		})),
	);
	expect(
		new Set(identities.map((identity) => JSON.stringify(identity))).size,
	).toBe(rows.length);
}

export function expectPrecisionCursors(pages: MyWorkListResponse[]): void {
	const firstCursor = decodeMyWorkCursor(pages[0]?.nextCursor ?? "");
	const secondCursor = decodeMyWorkCursor(pages[1]?.nextCursor ?? "");
	expect(firstCursor).toMatchObject({ key: "OR-1", id: 5001 });
	expect(secondCursor).toMatchObject({ key: "OR-2", id: 5002 });
	expect(firstCursor?.updatedAt).toBe("2026-09-10T00:00:00.124Z");
	expect(secondCursor?.updatedAt).toBe("2026-09-10T00:00:00.124Z");
}

export function expectPrecisionQueries(queries: CapturedQuery[]): void {
	const trackerQueries = queries.filter((entry) =>
		entry.sql.includes('from "tracker_items"'),
	);
	expect(trackerQueries).toHaveLength(3);
	const updatedExpression = `date_trunc('milliseconds', "ti"."updated_at")`;
	expect(trackerQueries[0]?.sql).toContain(`${updatedExpression} desc`);
	for (const query of trackerQueries) {
		expect(query.sql).toContain(updatedExpression);
		expect(query.sql).not.toContain('"ti"."updated_at" desc');
	}
	for (const query of trackerQueries.slice(1)) {
		expect(query.sql).toContain(`${updatedExpression} <`);
		expect(query.sql).toContain(`${updatedExpression} =`);
		expect(query.sql).not.toContain('"ti"."updated_at" <');
		expect(query.sql).not.toContain('"ti"."updated_at" =');
	}
	expect(trackerQueries[1]?.parameters).toContain("2026-09-10T00:00:00.124Z");
	expect(trackerQueries[2]?.parameters).toContain("2026-09-10T00:00:00.124Z");
}
