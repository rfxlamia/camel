import { POSITION_GAP } from "../core/position.js";
import { pool } from "./pool.js";

async function getOrCreateDefaultWorkspaceId(): Promise<number | null> {
	const existing = await pool.query(
		`SELECT id FROM workspaces
     WHERE is_personal = false AND name = 'Default Workspace'
     LIMIT 1`,
	);
	if (existing.rows[0]) {
		return existing.rows[0].id as number;
	}

	const users = await pool.query(`SELECT id FROM users ORDER BY id LIMIT 1`);
	if (!users.rows[0]) {
		return null;
	}

	const created = await pool.query(
		`INSERT INTO workspaces (name, owner_user_id, is_personal)
     VALUES ('Default Workspace', $1, false)
     RETURNING id`,
		[users.rows[0].id],
	);
	return created.rows[0].id as number;
}

async function seed() {
	const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM columns");
	if (rows[0].n > 0) {
		console.log("Database already seeded — skipping.");
		await pool.end();
		return;
	}

	const workspaceId = await getOrCreateDefaultWorkspaceId();

	const columns = [
		{
			title: "Backlog",
			wip: null,
			policy: "Anything the team might do. No commitment yet.",
			isDone: false,
		},
		{
			title: "To Do",
			wip: 5,
			policy: "Refined and ready to start. Pull from the top.",
			isDone: false,
		},
		{
			title: "In Progress",
			wip: 3,
			policy: "Actively being worked on. One owner per card.",
			isDone: false,
		},
		{
			title: "Done",
			wip: null,
			policy: "Merged, deployed, or otherwise finished.",
			isDone: true,
		},
	];

	const columnIds: number[] = [];
	for (let i = 0; i < columns.length; i++) {
		const c = columns[i];
		const res = await pool.query(
			workspaceId == null
				? `INSERT INTO columns (title, position, wip_limit, policy, is_done)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`
				: `INSERT INTO columns (title, position, wip_limit, policy, is_done, workspace_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
			workspaceId == null
				? [c.title, (i + 1) * POSITION_GAP, c.wip, c.policy, c.isDone]
				: [
						c.title,
						(i + 1) * POSITION_GAP,
						c.wip,
						c.policy,
						c.isDone,
						workspaceId,
					],
		);
		columnIds.push(res.rows[0].id);
	}

	const cards = [
		{
			col: 0,
			title: "Set up CI pipeline",
			desc: "GitHub Actions: lint, test, build.",
		},
		{
			col: 0,
			title: "Dark mode support",
			desc: "Respect prefers-color-scheme.",
		},
		{
			col: 1,
			title: "Connect GitHub issues",
			desc: "Sync open issues into the board.",
		},
		{ col: 1, title: "Card labels", desc: "Color-coded labels per card." },
		{ col: 2, title: "Board drag & drop", desc: "Move cards between columns." },
		{
			col: 3,
			title: "Project scaffolding",
			desc: "Vite + React + Tailwind v4 + Express + Postgres.",
		},
	];

	for (let i = 0; i < cards.length; i++) {
		const card = cards[i];
		const columnId = columnIds[card.col];
		const isDone = columns[card.col].isDone;
		const isStarted = card.col >= 2;
		const res = await pool.query(
			workspaceId == null
				? `INSERT INTO cards (column_id, title, description, position, created_at, started_at, done_at)
           VALUES ($1, $2, $3, $4, now() - interval '5 days',
                   CASE WHEN $5 THEN now() - interval '3 days' END,
                   CASE WHEN $6 THEN now() - interval '1 day' END)
           RETURNING id`
				: `INSERT INTO cards (column_id, title, description, position, created_at, started_at, done_at, workspace_id)
           VALUES ($1, $2, $3, $4, now() - interval '5 days',
                   CASE WHEN $5 THEN now() - interval '3 days' END,
                   CASE WHEN $6 THEN now() - interval '1 day' END,
                   $7)
           RETURNING id`,
			workspaceId == null
				? [
						columnId,
						card.title,
						card.desc,
						(i + 1) * POSITION_GAP,
						isStarted,
						isDone,
					]
				: [
						columnId,
						card.title,
						card.desc,
						(i + 1) * POSITION_GAP,
						isStarted,
						isDone,
						workspaceId,
					],
		);
		await pool.query(
			workspaceId == null
				? `INSERT INTO card_events (card_id, from_column_id, to_column_id)
           VALUES ($1, NULL, $2)`
				: `INSERT INTO card_events (card_id, from_column_id, to_column_id, workspace_id)
           VALUES ($1, NULL, $2, $3)`,
			workspaceId == null
				? [res.rows[0].id, columnId]
				: [res.rows[0].id, columnId, workspaceId],
		);
	}

	console.log("Seeded 4 columns and 6 cards.");
	await pool.end();
}

seed().catch((err) => {
	console.error("Seed failed:", err);
	process.exit(1);
});
