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
export async function applySchema(client: SchemaClient): Promise<void> {
	const sql = readFileSync(join(here, "schema.sql"), "utf8");
	const mergeSql = readFileSync(join(here, "work-item-merge.sql"), "utf8");
	const agentSql = readFileSync(join(here, "agent-schema.sql"), "utf8");
	const chatSql = readFileSync(join(here, "chat-schema.sql"), "utf8");
	try {
		await client.query("BEGIN");
		await client.query(sql);
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
	try {
		await applySchema(client);
		console.log("Schema applied.");
	} finally {
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
