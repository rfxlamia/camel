import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeClient = vi.hoisted(() => ({ current: null as any }));

vi.mock("./pool.js", () => ({
	pool: {
		connect: vi.fn(async () => fakeClient.current),
		end: vi.fn(async () => undefined),
	},
}));

import { migrate } from "./migrate.js";

function makeClient(notices: string[]) {
	const client: any = new EventEmitter();
	client.query = vi.fn(async (sql: string) => {
		// Emit notices while the merge SQL runs, as Postgres would.
		if (sql.includes("work-item-merge") || sql.length > 100) {
			for (const message of notices) client.emit("notice", { message });
		}
		return {};
	});
	client.release = vi.fn(() => {
		client.listenersAtRelease = client.listenerCount("notice");
	});
	return client;
}

describe("migrate notices", () => {
	let log: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		log = vi.spyOn(console, "log").mockImplementation(() => {});
	});
	afterEach(() => {
		log.mockRestore();
	});

	it("prints work-item-merge notices verbatim and removes the listener before release", async () => {
		const gated = "work-item-merge: copy skipped (WORK_ITEM_MERGE not enabled)";
		const summary =
			"work-item-merge: workspace=7 tracker_before=2 cards_added=2";
		const client = makeClient([gated, summary]);
		fakeClient.current = client;

		await migrate();

		const lines = log.mock.calls.map((c) => c[0]);
		expect(lines).toContain(gated);
		expect(lines).toContain(summary);
		expect(lines).toContain("Schema applied.");
		expect(client.listenersAtRelease).toBe(0);
		expect(client.listenerCount("notice")).toBe(0);
	});

	it("prints every notice, including non work-item-merge ones", async () => {
		const other = 'relation "cards" already exists, skipping';
		const client = makeClient([other]);
		fakeClient.current = client;

		await migrate();

		expect(log.mock.calls.map((c) => c[0])).toContain(other);
	});
});
