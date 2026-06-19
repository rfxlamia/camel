import bcrypt from "bcryptjs";
import { POSITION_GAP } from "../core/position.js";
import { pool } from "./pool.js";

async function seed() {
	const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM columns");
	if (rows[0].n > 0) {
		console.log("Database already seeded — skipping.");
		await pool.end();
		return;
	}

	// Create demo user so workspace (required by NOT NULL) can be assigned.
	const hash = await bcrypt.hash("password", 10);
	const userRes = await pool.query(
		`INSERT INTO users (username, display_name, password_hash)
     VALUES ('demo', 'Demo User', $1)
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
		[hash],
	);
	const userId = userRes.rows[0].id as number;

	const wsRes = await pool.query(
		`INSERT INTO workspaces (name, owner_user_id, is_personal)
     VALUES ('Default Workspace', $1, false)
     RETURNING id`,
		[userId],
	);
	const workspaceId = wsRes.rows[0].id as number;

	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
		[workspaceId, userId],
	);

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
			`INSERT INTO columns (title, position, wip_limit, policy, is_done, workspace_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
			[c.title, (i + 1) * POSITION_GAP, c.wip, c.policy, c.isDone, workspaceId],
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
			`INSERT INTO cards (column_id, title, description, position, created_at, started_at, done_at, workspace_id)
       VALUES ($1, $2, $3, $4, now() - interval '5 days',
               CASE WHEN $5 THEN now() - interval '3 days' END,
               CASE WHEN $6 THEN now() - interval '1 day' END,
               $7)
       RETURNING id`,
			[
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
			`INSERT INTO card_events (card_id, from_column_id, to_column_id, workspace_id)
       VALUES ($1, NULL, $2, $3)`,
			[res.rows[0].id, columnId, workspaceId],
		);
	}

	console.log(
		"Seeded demo user (username: demo, password: password), 4 columns and 6 cards.",
	);
	await pool.end();
}

seed().catch((err) => {
	console.error("Seed failed:", err);
	process.exit(1);
});
