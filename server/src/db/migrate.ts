import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  const sql = readFileSync(join(here, "schema.sql"), "utf8");
  const agentSql = readFileSync(join(here, "agent-schema.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(agentSql);
    await client.query("COMMIT");
    console.log("Schema applied.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
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
