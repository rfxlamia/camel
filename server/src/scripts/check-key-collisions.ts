import "dotenv/config";
import { findKeyCollisions } from "../core/work-item-debt.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";

async function main() {
	const collisions = await findKeyCollisions(db);
	if (collisions.length > 0) {
		console.error(
			JSON.stringify({
				event: "work_item_key_collision",
				count: collisions.length,
				collisions,
			}),
		);
		process.exitCode = 1;
		return;
	}
	console.log(
		JSON.stringify({
			event: "work_item_key_collision_check",
			status: "ok",
			count: 0,
		}),
	);
}

main()
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	})
	.finally(async () => {
		await pool.end();
	});
