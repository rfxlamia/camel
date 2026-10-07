import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));

type SchemaClient = {
	query: (sql: string) => Promise<unknown>;
};

/**
 * Applies every schema file inside one transaction on the given client.
 * Any failure rolls the whole run back and is rethrown.
 */
export async function applySchema(
	client: SchemaClient,
	opts: { workItemMerge?: boolean } = {},
): Promise<void> {
	// The tracker->cards copy is a no-op unless explicitly enabled (option or
	// WORK_ITEM_MERGE=on). Only the cutover enables it; expand statements in
	// work-item-merge.sql always run.
	const mergeEnabled =
		opts.workItemMerge === true || process.env.WORK_ITEM_MERGE === "on";
	const sql = readFileSync(join(here, "schema.sql"), "utf8");
	const mergeSql = readFileSync(join(here, "work-item-merge.sql"), "utf8");
	const agentSql = readFileSync(join(here, "agent-schema.sql"), "utf8");
	const chatSql = readFileSync(join(here, "chat-schema.sql"), "utf8");
	try {
		await client.query("BEGIN");
		await client.query(sql);
		if (mergeEnabled) {
			await client.query("SET LOCAL work_item_merge.enabled = 'on'");
		}
		await client.query(mergeSql);
		await client.query(agentSql);
		await client.query(chatSql);
		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	}
}

export async function migrate() {
	const client = await pool.connect();
	// pg surfaces RAISE NOTICE only as a client 'notice' event; print each one
	// verbatim so cutover runbooks can grep stdout for work-item-merge lines.
	const onNotice = (n: { message?: string }) => console.log(n.message);
	client.on("notice", onNotice);
	try {
		await applySchema(client);
		console.log("Schema applied.");
	} finally {
		client.off("notice", onNotice);
		client.release();
		await pool.end();
	}
}

const isMigrateEntry =
	process.argv[1]?.endsWith("migrate.js") ||
	process.argv[1]?.endsWith("migrate.ts");

if (isMigrateEntry) {
	migrate().catch((err) => {
		console.error("Migration failed:", err);
		process.exit(1);
	});
}
