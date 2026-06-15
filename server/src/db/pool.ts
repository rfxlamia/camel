import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
	connectionString:
		process.env.DATABASE_URL ??
		"postgres://camel:camel@localhost:5432/camel_kanban",
});
