import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrateSource = readFileSync(
	new URL("./migrate.ts", import.meta.url),
	"utf8",
);
const dockerfile = readFileSync(
	new URL("../../../Dockerfile", import.meta.url),
	"utf8",
);

describe("work-item-merge.sql wiring", () => {
	it("runs after schema.sql and before agent-schema.sql inside BEGIN/COMMIT", () => {
		const begin = migrateSource.indexOf('"BEGIN"');
		const schema = migrateSource.indexOf("client.query(sql)");
		const merge = migrateSource.indexOf("work-item-merge.sql");
		const mergeRun = migrateSource.indexOf("client.query(mergeSql)");
		const agent = migrateSource.indexOf("client.query(agentSql)");
		const commit = migrateSource.indexOf('"COMMIT"');
		expect(merge).toBeGreaterThan(-1);
		expect(begin).toBeLessThan(schema);
		expect(schema).toBeLessThan(mergeRun);
		expect(mergeRun).toBeLessThan(agent);
		expect(agent).toBeLessThan(commit);
	});

	it("copies the SQL file into the image", () => {
		expect(dockerfile).toContain(
			"COPY server/src/db/work-item-merge.sql ./server/dist/db/work-item-merge.sql",
		);
	});

	it("runs the guard file right after the merge file and ships it in the image", () => {
		const mergeRun = migrateSource.indexOf("client.query(mergeSql)");
		const guardRun = migrateSource.indexOf("client.query(guardSql)");
		const agent = migrateSource.indexOf("client.query(agentSql)");
		expect(mergeRun).toBeLessThan(guardRun);
		expect(guardRun).toBeLessThan(agent);
		expect(dockerfile).toContain(
			"COPY server/src/db/work-item-merge-guard.sql ./server/dist/db/work-item-merge-guard.sql",
		);
	});
});
