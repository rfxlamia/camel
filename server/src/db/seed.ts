import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { sql } from "kysely";
import { allocateCardIdentity } from "../core/allocate-card-identity.js";
import { POSITION_GAP } from "../core/position.js";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db, type DBExecutor } from "./kysely.js";

type DemoCard = {
	columnIndex: number;
	title: string;
	description: string;
};

const DEMO_CARDS: readonly DemoCard[] = [
	{
		columnIndex: 0,
		title: "Set up CI pipeline",
		description: "GitHub Actions: lint, test, build.",
	},
	{
		columnIndex: 0,
		title: "Dark mode support",
		description: "Respect prefers-color-scheme.",
	},
	{
		columnIndex: 1,
		title: "Connect GitHub issues",
		description: "Sync open issues into the board.",
	},
	{
		columnIndex: 1,
		title: "Card labels",
		description: "Color-coded labels per card.",
	},
	{
		columnIndex: 2,
		title: "Board drag & drop",
		description: "Move cards between columns.",
	},
	{
		columnIndex: 3,
		title: "Project scaffolding",
		description: "Vite + React + Tailwind v4 + Express + Postgres.",
	},
];

async function insertDemoCard(
	trx: DBExecutor,
	workspaceId: number,
	columnId: number,
	card: DemoCard,
	column: { isDone: boolean },
	position: number,
) {
	const identity = await allocateCardIdentity(trx, { workspaceId, columnId });
	const inserted = await trx
		.insertInto("cards")
		.values({
			column_id: columnId,
			title: card.title,
			description: card.description,
			position: position * POSITION_GAP,
			created_at: sql`now() - interval '5 days'`,
			started_at: card.columnIndex >= 2 ? sql`now() - interval '3 days'` : null,
			done_at: column.isDone ? sql`now() - interval '1 day'` : null,
			workspace_id: workspaceId,
			key_number: identity.keyNumber,
			status_id: identity.statusId,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	await trx
		.insertInto("card_events")
		.values({
			card_id: inserted.id,
			from_column_id: null,
			to_column_id: columnId,
			workspace_id: workspaceId,
		})
		.execute();
}

export async function seedDemoCards(
	workspaceId: number,
	columnIds: readonly number[],
	columns: readonly { isDone: boolean }[],
) {
	await db.transaction().execute(async (trx) => {
		for (let i = 0; i < DEMO_CARDS.length; i++) {
			const card = DEMO_CARDS[i];
			const columnId = columnIds[card.columnIndex];
			await insertDemoCard(
				trx,
				workspaceId,
				columnId,
				card,
				columns[card.columnIndex],
				i + 1,
			);
		}
	});
}

async function seed() {
	const countRow = await db
		.selectFrom("columns")
		.select(sql<number>`count(*)::int`.as("n"))
		.executeTakeFirstOrThrow();
	if (countRow.n > 0) {
		console.log("Database already seeded — skipping.");
		await db.destroy();
		return;
	}

	// Create demo user so workspace (required by NOT NULL) can be assigned.
	const hash = await bcrypt.hash("password", 10);
	const user = await db
		.insertInto("users")
		.values({
			username: "demo",
			display_name: "Demo User",
			password_hash: hash,
		})
		.onConflict((oc) =>
			oc.column("username").doUpdateSet((eb) => ({
				username: eb.ref("excluded.username"),
			})),
		)
		.returning("id")
		.executeTakeFirstOrThrow();
	const userId = user.id;

	const workspace = await db
		.insertInto("workspaces")
		.values({
			name: "Default Workspace",
			owner_user_id: userId,
			is_personal: false,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	const workspaceId = workspace.id;

	await db
		.insertInto("workspace_members")
		.values({ workspace_id: workspaceId, user_id: userId, role: "owner" })
		.execute();
	await seedTrackerVocabulary(db, workspaceId);

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
		const inserted = await db
			.insertInto("columns")
			.values({
				title: c.title,
				position: (i + 1) * POSITION_GAP,
				wip_limit: c.wip,
				policy: c.policy,
				is_done: c.isDone,
				workspace_id: workspaceId,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		columnIds.push(inserted.id);
	}

	await seedDemoCards(workspaceId, columnIds, columns);

	console.log(
		"Seeded demo user (username: demo, password: password), 4 columns and 6 cards.",
	);
	await db.destroy();
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	seed().catch((err) => {
		console.error("Seed failed:", err);
		process.exit(1);
	});
}
