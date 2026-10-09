# EXECUTION PLAN — Workspace Template (Column Seeding)

**Date:** 2026-06-29
**Spec:** docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md
**Status:** draft
**Total tasks:** 5

---

## Execution Overview

### Recommended Order
```
T1, T2, T3 (parallel) → T4 → T5
```

> Dependency order is **recommended** — pocket-development enforces actual
> parallelism and sequencing.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T1, T2, T3 | start (all prereq) |
| Group B | T4 | T2, T3 complete |
| Group C | T5 | T1, T4 complete |

### Constraints Reminder
**Architecture:**
- Server NodeNext — `.js` import extensions even for `.ts`.
- Reuse `validateColumnName` (`server/src/validators/input-length.ts`).
- Batch empty-guard MUST serialize via `SELECT ... FOR UPDATE` on the workspace
  row inside the transaction (READ COMMITTED `SELECT count` does NOT serialize).
- `recordActivity` runs inside the transaction (on the tx client); `publishEvent`
  after COMMIT, best-effort.
- Must NOT touch `columns` schema, the realtime event union (reuse
  `column.created`), or the PATCH single-done invariant.
- Positions computed inside the transaction (`i * POSITION_GAP` from zero base).

**Out-of-scope (no task may add):** non-empty apply, user/DB-stored templates,
`is_signable`/`signable_assignee_id` persistence by batch, custom colors, schema
migration, template undo/bulk-delete.

**Assumptions at risk:** batch request shape `{templateName, columns:[...]}`;
templateName is a free-text log label (no registry). If wrong → NEEDS_CONTEXT.

**Sequencing:** `[depends: TN]` is recommended only; pocket-development enforces
real blocking.

### File Structure Map

```
Rule: Empty-only apply / Atomicity / One-event+activity / No-duplicate / Validation / Signable-not-persisted
  Create: server/src/validators/column.ts                         (created by: T1)
  Create: server/src/validators/column.test.ts                    (created by: T1)
  Modify: server/src/routes/columns.ts                            (T1)
  Test:   server/src/routes/columns.batch.integration.test.ts     (created by: T1)

Rule: Forward-compatible template config (preset data)
  Create: client/src/lib/templates.ts                             (created by: T2)
  Create: client/src/lib/templates.test.ts                        (created by: T2)

Rule: Preview a11y (shared color map reuse)
  Create: client/src/lib/columnColors.ts                          (created by: T3)
  Modify: client/src/components/ColumnView.tsx                    (T3)

Rule: Preview a11y / Picker never a gate
  Create: client/src/components/TemplatePicker.tsx                (created by: T4)
  Create: client/src/components/TemplatePicker.test.tsx           (created by: T4)

Rule: Apply flow / 409 silent transition / loading+success
  Modify: client/src/api.ts                                       (T5)
  Modify: client/src/pages/BoardPage.tsx                          (T5)
  Test:   client/src/api.test.ts (or extend)                      (T5)
  Test:   client/src/pages/BoardPage.test.tsx                     (created by: T5)
```

---

## Pocket Packets

---

### Task 1: Batch column endpoint + validator [prereq]

## OBJECTIVE
Add an atomic `POST /workspaces/:id/columns/batch` endpoint that seeds an empty
workspace with multiple columns in a single transaction, plus a pure validation
helper. Extract the column-color palette into the new validator module so both
the validator and the existing handlers share one source.

Files:
- Create: `server/src/validators/column.ts`
- Create: `server/src/validators/column.test.ts`
- Modify: `server/src/routes/columns.ts`
- Test: `server/src/routes/columns.batch.integration.test.ts`

Steps:
1. Write failing unit test for: validation rules (R: Validation)
   File: `server/src/validators/column.test.ts`
   Test verifies:
   - Given an empty columns array, When validateColumnBatch runs, Then invalid + error.
   - Given a column with a color not in the 5-palette, Then invalid + error.
   - Given >1 column with isDone=true, Then invalid + error.
   - Given a column whose title fails validateColumnName, Then invalid + error.
   - Given a wipLimit that is 0 or non-integer, Then invalid + error.
   - Given a valid 5-column template payload, Then valid.

   ```ts
   // server/src/validators/column.test.ts — pure vitest, no DB.
   import { describe, expect, it } from "vitest";
   import { validateColumnBatch } from "./column.js";

   function col(overrides: Record<string, unknown> = {}) {
   	return {
   		title: "Backlog",
   		color: "powder-blue",
   		wipLimit: null,
   		policy: "Ideas not yet scheduled.",
   		isDone: false,
   		...overrides,
   	};
   }

   const validFive = [
   	col({ title: "Backlog", color: "powder-blue" }),
   	col({ title: "To Do", color: "pale-sky" }),
   	col({ title: "In Progress", color: "light-cyan", wipLimit: 3 }),
   	col({ title: "In Review", color: "frozen-water", wipLimit: 2 }),
   	col({ title: "Done", color: "turquoise", isDone: true }),
   ];

   describe("validateColumnBatch", () => {
   	it("rejects a non-array or empty columns array", () => {
   		expect(validateColumnBatch(undefined).valid).toBe(false);
   		expect(validateColumnBatch(null).valid).toBe(false);
   		expect(validateColumnBatch({}).valid).toBe(false);
   		const empty = validateColumnBatch([]);
   		expect(empty.valid).toBe(false);
   		expect(empty.error).toBeTruthy();
   	});

   	it("rejects a color outside the 5-name palette", () => {
   		const result = validateColumnBatch([col({ color: "hot-pink" })]);
   		expect(result.valid).toBe(false);
   		expect(result.error).toBeTruthy();
   	});

   	it("rejects more than one done-column", () => {
   		const result = validateColumnBatch([
   			col({ title: "A", isDone: true }),
   			col({ title: "B", isDone: true }),
   		]);
   		expect(result.valid).toBe(false);
   	});

   	it("rejects a title that fails validateColumnName (blank)", () => {
   		expect(validateColumnBatch([col({ title: "   " })]).valid).toBe(false);
   	});

   	it("rejects a wipLimit that is 0 or non-integer", () => {
   		expect(validateColumnBatch([col({ wipLimit: 0 })]).valid).toBe(false);
   		expect(validateColumnBatch([col({ wipLimit: 1.5 })]).valid).toBe(false);
   	});

   	it("accepts a valid 5-column template payload", () => {
   		const result = validateColumnBatch(validFive);
   		expect(result.valid).toBe(true);
   		expect(result.normalized).toHaveLength(5);
   		expect(result.normalized?.filter((c) => c.isDone)).toHaveLength(1);
   	});
   });
   ```

2. Run test — verify FAIL:
   `npx vitest run server/src/validators/column.test.ts`
   Expected failure: module `./column.js` / `validateColumnBatch` not found.

3. Implement `server/src/validators/column.ts`:
   - Export `COLUMN_COLORS` (the 5 names) and `isValidColumnColor` (move from
     `columns.ts`; accepts a palette name or null).
   - Export `validateColumnBatch(columns: unknown): { valid: boolean; error?: string; normalized?: NormalizedColumn[] }`:
     - reject non-array / empty array,
     - per column: `validateColumnName(title)`, `isValidColumnColor(color)`,
       `wipLimit` null-or-positive-integer, `policy` string (default ""),
       `isDone` boolean,
     - reject if >1 `isDone === true`,
     - strip/ignore `isSignable` and `signableAssigneeId` (never read them),
     - return `normalized` rows with safe defaults.

4. Run test — verify PASS:
   `npx vitest run server/src/validators/column.test.ts`
   Expected: PASS

5. Commit:
   `git add server/src/validators/column.ts server/src/validators/column.test.ts`
   `git commit -m "feat(columns): add batch column validator"`

6. Write failing integration test for: empty-only apply, atomicity, one
   event/activity, no-duplicate, 409 guard (R: Empty-only / Atomicity / One-event+activity / No-duplicate)
   File: `server/src/routes/columns.batch.integration.test.ts`
   Pattern after `server/src/routes.integration.test.ts` (mock `realtime.js` →
   `mockPublishEvent`, mock `auth.js` pass-through user, `supertest` against an
   express app mounting `api`, real `pool`, fixtures: user + workspace +
   membership). Gate header comment: `RUN_INTEGRATION=1`.
   Test verifies:
   - Given an empty workspace, When POST .../columns/batch with a 5-column
     payload, Then 201, 5 columns persisted in order, each field set, exactly
     one is_done=true, mockPublishEvent called once with type "column.created",
     and exactly one card_events row with event_type='create' and payload
     {templateName, columnCount:5}.
   - Given a workspace that already has >=1 column, When POST .../columns/batch,
     Then 409, column count unchanged, mockPublishEvent NOT called, no new
     card_events row.
   - Given a payload with an invalid color, When POST, Then 400, no columns.
   - Given a payload including isSignable/signableAssigneeId, When POST, Then
     created columns have is_signable=false and signable_assignee_id=null.
   - Atomicity (spec Example C): Given an empty workspace, When an insert fails
     mid-apply (simulate by spying on the tx client / pool so the Nth INSERT
     rejects), Then 0 columns persist, no card_events row is written, and
     mockPublishEvent is NOT called (the response is a 5xx/error).

   ```ts
   // server/src/routes/columns.batch.integration.test.ts
   // Replicates server/src/routes.integration.test.ts: mock realtime/auth,
   // real pool, fixtures. NOTE the file lives in server/src/routes/, so all
   // app-module imports are "../" (not "./"). NodeNext → .js extensions.
   // Gated: RUN_INTEGRATION=1 npx vitest run server/src/routes/columns.batch.integration.test.ts
   import "dotenv/config";
   import {
   	afterAll,
   	afterEach,
   	beforeEach,
   	describe,
   	expect,
   	it,
   	vi,
   } from "vitest";

   const { mockPublishEvent, mockTestUser } = vi.hoisted(() => ({
   	mockPublishEvent: vi.fn(),
   	mockTestUser: { id: 1, username: "testuser", displayName: "Test User" },
   }));

   vi.mock("../db/redis.js", () => ({
   	getRedisClient: vi.fn(),
   	connectRedis: vi.fn(),
   }));

   vi.mock("../realtime.js", () => ({
   	publishEvent: mockPublishEvent,
   	clearPresence: vi.fn(),
   	heartbeat: vi.fn(),
   	onlineUsers: vi.fn().mockResolvedValue([]),
   	sseHandler: vi.fn(),
   	createRealtimeHub: vi.fn(),
   	initRealtime: vi.fn(),
   	workspaceEventChannel: vi.fn(),
   	workspacePresenceKey: vi.fn(),
   	workspacePresencePattern: vi.fn(),
   }));

   vi.mock("../auth.js", async (importOriginal) => {
   	const actual = await importOriginal<typeof import("../auth.js")>();
   	return {
   		...actual,
   		requireAuth: (req: any, _res: any, next: any) => {
   			req.user = mockTestUser;
   			next();
   		},
   	};
   });

   import cookieParser from "cookie-parser";
   import express from "express";
   import request from "supertest";
   import { pool } from "../db/pool.js";
   import { api } from "../routes.js";

   function createTestApp() {
   	const app = express();
   	app.use(express.json());
   	app.use(cookieParser());
   	app.use("/api", api);
   	return app;
   }

   const app = createTestApp();

   const PAYLOAD = {
   	templateName: "Software Dev",
   	columns: [
   		{ title: "Backlog", color: "powder-blue", wipLimit: null, policy: "Ideas.", isDone: false },
   		{ title: "To Do", color: "pale-sky", wipLimit: null, policy: "Next.", isDone: false },
   		{ title: "In Progress", color: "light-cyan", wipLimit: 3, policy: "WIP.", isDone: false },
   		{ title: "In Review", color: "frozen-water", wipLimit: 2, policy: "QA.", isDone: false },
   		{ title: "Done", color: "turquoise", wipLimit: null, policy: "Shipped.", isDone: true },
   	],
   };

   async function setupFixtures() {
   	await pool.query(
   		`INSERT INTO users (id, username, display_name, password_hash)
   		 VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
   		[mockTestUser.id, mockTestUser.username, mockTestUser.displayName, "hashed"],
   	);
   	await pool.query(
   		`INSERT INTO workspaces (id, name, owner_user_id, is_personal)
   		 VALUES (1, 'Test WS', $1, false) ON CONFLICT (id) DO NOTHING`,
   		[mockTestUser.id],
   	);
   	await pool.query(
   		`INSERT INTO workspace_members (workspace_id, user_id, role)
   		 VALUES (1, $1, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
   		[mockTestUser.id],
   	);
   }

   beforeEach(async () => {
   	await setupFixtures();
   	// Start every test from an empty board.
   	await pool.query("DELETE FROM card_events");
   	await pool.query("DELETE FROM columns WHERE workspace_id = 1");
   	vi.clearAllMocks();
   });

   afterAll(async () => {
   	await pool.query("TRUNCATE users, workspaces, columns, cards, card_events CASCADE");
   	await pool.end();
   });

   describe.skipIf(!process.env.RUN_INTEGRATION)(
   	"POST /api/workspaces/:wid/columns/batch",
   	() => {
   		it("seeds an empty workspace atomically with one event + one activity", async () => {
   			const res = await request(app)
   				.post("/api/workspaces/1/columns/batch")
   				.send(PAYLOAD);

   			expect(res.status).toBe(201);

   			const cols = await pool.query(
   				"SELECT title, color, wip_limit, policy, is_done, is_signable, signable_assignee_id FROM columns WHERE workspace_id = 1 ORDER BY position",
   			);
   			expect(cols.rows).toHaveLength(5);
   			expect(cols.rows.map((c) => c.title)).toEqual([
   				"Backlog", "To Do", "In Progress", "In Review", "Done",
   			]);
   			expect(cols.rows.filter((c) => c.is_done)).toHaveLength(1);
   			expect(cols.rows[2].wip_limit).toBe(3);
   			expect(cols.rows[2].color).toBe("light-cyan");

   			// Exactly one realtime event, of type column.created.
   			expect(mockPublishEvent).toHaveBeenCalledTimes(1);
   			expect(mockPublishEvent.mock.calls[0][1]).toMatchObject({
   				type: "column.created",
   			});

   			// Exactly one create activity {templateName, columnCount:5}.
   			const events = await pool.query(
   				"SELECT event_type, payload FROM card_events WHERE workspace_id = 1",
   			);
   			expect(events.rows).toHaveLength(1);
   			expect(events.rows[0].event_type).toBe("create");
   			expect(events.rows[0].payload).toMatchObject({
   				templateName: "Software Dev",
   				columnCount: 5,
   			});
   		});

   		it("rejects a non-empty workspace with 409 and writes nothing", async () => {
   			await pool.query(
   				"INSERT INTO columns (title, position, workspace_id) VALUES ('Existing', 1024, 1)",
   			);

   			const res = await request(app)
   				.post("/api/workspaces/1/columns/batch")
   				.send(PAYLOAD);

   			expect(res.status).toBe(409);
   			const cols = await pool.query(
   				"SELECT count(*)::int AS n FROM columns WHERE workspace_id = 1",
   			);
   			expect(cols.rows[0].n).toBe(1);
   			expect(mockPublishEvent).not.toHaveBeenCalled();
   			const events = await pool.query(
   				"SELECT count(*)::int AS n FROM card_events WHERE workspace_id = 1",
   			);
   			expect(events.rows[0].n).toBe(0);
   		});

   		it("rejects an invalid color with 400 and creates no columns", async () => {
   			const bad = {
   				templateName: "Bad",
   				columns: [
   					{ title: "X", color: "hot-pink", wipLimit: null, policy: "", isDone: false },
   				],
   			};
   			const res = await request(app)
   				.post("/api/workspaces/1/columns/batch")
   				.send(bad);

   			expect(res.status).toBe(400);
   			const cols = await pool.query(
   				"SELECT count(*)::int AS n FROM columns WHERE workspace_id = 1",
   			);
   			expect(cols.rows[0].n).toBe(0);
   		});

   		it("ignores signable fields — created columns are is_signable=false, assignee=null", async () => {
   			const withSignable = {
   				templateName: "Signable Probe",
   				columns: PAYLOAD.columns.map((c) => ({
   					...c,
   					isSignable: true,
   					signableAssigneeId: 1,
   				})),
   			};
   			const res = await request(app)
   				.post("/api/workspaces/1/columns/batch")
   				.send(withSignable);

   			expect(res.status).toBe(201);
   			const cols = await pool.query(
   				"SELECT is_signable, signable_assignee_id FROM columns WHERE workspace_id = 1",
   			);
   			expect(cols.rows.every((c) => c.is_signable === false)).toBe(true);
   			expect(cols.rows.every((c) => c.signable_assignee_id === null)).toBe(true);
   		});

   		it("rolls back fully when an insert fails mid-apply (atomicity)", async () => {
   			// Spy on pool.connect → wrap the tx client so the 3rd INSERT INTO
   			// columns rejects. ROLLBACK/SELECT/recordActivity queries are untouched.
   			const realConnect = pool.connect.bind(pool);
   			const connectSpy = vi
   				.spyOn(pool, "connect")
   				// biome-ignore lint/suspicious/noExplicitAny: test double
   				.mockImplementation(async () => {
   					const client: any = await realConnect();
   					const realQuery = client.query.bind(client);
   					let inserts = 0;
   					client.query = (...args: any[]) => {
   						const sql = typeof args[0] === "string" ? args[0] : args[0]?.text ?? "";
   						if (/INSERT INTO columns/i.test(sql)) {
   							inserts++;
   							if (inserts === 3) {
   								return Promise.reject(new Error("simulated insert failure"));
   							}
   						}
   						return realQuery(...args);
   					};
   					return client;
   				});

   			try {
   				const res = await request(app)
   					.post("/api/workspaces/1/columns/batch")
   					.send(PAYLOAD);
   				expect(res.status).toBeGreaterThanOrEqual(500);
   			} finally {
   				connectSpy.mockRestore();
   			}

   			const cols = await pool.query(
   				"SELECT count(*)::int AS n FROM columns WHERE workspace_id = 1",
   			);
   			expect(cols.rows[0].n).toBe(0);
   			const events = await pool.query(
   				"SELECT count(*)::int AS n FROM card_events WHERE workspace_id = 1",
   			);
   			expect(events.rows[0].n).toBe(0);
   			expect(mockPublishEvent).not.toHaveBeenCalled();
   		});
   	},
   );
   ```

7. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npx vitest run server/src/routes/columns.batch.integration.test.ts`
   Expected failure: 404 (route not registered).

8. Implement the handler in `server/src/routes/columns.ts`:
   - Import `COLUMN_COLORS`, `isValidColumnColor`, `validateColumnBatch` from
     `../validators/column.js`; replace the local palette copy with the import
     (PATCH/POST behavior unchanged).
   - Add `columnsRouter.post("/columns/batch", requireWorkspaceMember, ...)`:
     - `validateColumnBatch(req.body?.columns)` → 400 on invalid.
     - `const client = await pool.connect(); BEGIN;`
     - `SELECT id FROM workspaces WHERE id = $1 FOR UPDATE` (workspaceId).
     - `SELECT count(*) FROM columns WHERE workspace_id = $1`; if > 0 → ROLLBACK,
       return 409 `{ error: "workspace already has columns" }`.
     - Insert each normalized column with `position = i * POSITION_GAP` (i from 0),
       setting title, color, wip_limit, policy, is_done; is_signable=false,
       signable_assignee_id=null.
     - `recordActivity(client, req.user!, workspaceId, "create", { payload: { templateName, columnCount } })` (on the tx client).
     - `COMMIT`. After commit: `publishEvent(workspaceId, { type: "column.created", actor: req.user! })` (best-effort; do not fail the response if publish throws — mirror existing graceful degradation).
     - Respond 201 with the created columns array.
     - On error inside the tx: ROLLBACK, rethrow; `finally client.release()`.

9. Run test — verify PASS:
   `RUN_INTEGRATION=1 npx vitest run server/src/routes/columns.batch.integration.test.ts`
   Expected: PASS

10. Commit:
   `git add server/src/routes/columns.ts server/src/routes/columns.batch.integration.test.ts`
   `git commit -m "feat(columns): add atomic batch seed endpoint"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md — rules: Empty-only apply, Atomicity, One event+activity, No-duplicate, Validation, Forward-compatible
server/src/routes/columns.ts — existing POST/PATCH patterns, COLUMN_COLORS, transaction style (PATCH isDone block), publishEvent + recordActivity usage
server/src/routes/helpers.ts — recordActivity(db: Queryable, actor, workspaceId, eventType, opts) signature; eventType includes "create"
server/src/routes.integration.test.ts — supertest + mock realtime/auth + pool fixtures pattern
server/src/db/schema.sql:62,64 — card_id and to_column_id are nullable (activity-in-tx valid)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: 2 source + 2 test files, transaction + concurrency control +
branching validation. The FOR UPDATE serialization is non-obvious judgment.

## SANDWICH CONTEXT
[CRITICAL: The empty-guard MUST use `SELECT ... FOR UPDATE` on the workspace row inside the transaction — a plain count under READ COMMITTED does not serialize and breaks the no-duplicate invariant.]
You are implementing the batch column endpoint for Workspace Template.
Spec: docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md
Design decision: Option A — batch route in columns.ts + transaction.
Files in scope: server/src/validators/column.ts (+test), server/src/routes/columns.ts, server/src/routes/columns.batch.integration.test.ts — no other files.
Available after: none (prereq)
Architecture rule: NodeNext `.js` import extensions; reuse validateColumnName; recordActivity on the tx client; publishEvent post-commit best-effort; do NOT touch columns schema or PATCH single-done logic; batch must NOT persist is_signable/signable_assignee_id.
[RESTATE: FOR UPDATE row lock on the workspace before the count — no serialization, no guarantee.]

## DELIVERABLE
Given an empty workspace, When POST /columns/batch with a valid 5-column payload, Then 201, 5 columns in order with all fields set, exactly one is_done=true.
Given a successful apply, When committed, Then exactly one column.created event and one "create" activity {templateName, columnCount}.
Given a workspace with >=1 column, When POST /columns/batch, Then 409, no columns/event/activity.
Given two concurrent applies on an empty workspace, When both run, Then FOR UPDATE serializes — first wins, second returns 409, no duplicate columns.
[must-not] Given an invalid color OR >1 done-column OR empty array, When POST, Then 400 and no columns created.
[must-not] Given a payload with is_signable/signable_assignee_id, When POST, Then created columns have is_signable=false and signable_assignee_id=null.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - FOR UPDATE serialization for the empty-guard
  - recordActivity on the tx client (atomic with inserts); publishEvent post-commit
  - Tests written BEFORE implementation (TDD)
  - Conventional commit messages
Must-not-have:
  - Appending to a non-empty workspace
  - Persisting is_signable / signable_assignee_id
  - Touching columns schema or PATCH single-done logic
  - Integer positions (use i * POSITION_GAP)
Open question risks:
  - Request shape {templateName, columns:[...]} — if the client sends a
    different shape → report NEEDS_CONTEXT.
Rollback note:
  - Endpoint is additive; no migration. Disable by not calling it.
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Plain count without FOR UPDATE → STOP

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, both test files green, two commits created.
Uncertain when: request shape assumption proves wrong.
Escalate when: a constraint above is violated or out-of-scope files are touched.

---

### Task 2: Client template preset module [prereq]

## OBJECTIVE
Define the 5 curated templates as typed, hardcoded client data plus a type that
is forward-compatible (optional signable fields, never required).

Files:
- Create: `client/src/lib/templates.ts`
- Create: `client/src/lib/templates.test.ts`

Steps:
1. Write failing test for: template data integrity (R: Forward-compatible config)
   File: `client/src/lib/templates.test.ts`
   Test verifies:
   - Given WORKSPACE_TEMPLATES, Then there are exactly 5 templates with unique ids/names.
   - Given each template, Then every column color is one of the 5 palette names.
   - Given each template, Then exactly one column has isDone === true.
   - Given each template, Then every column has a non-empty title and a policy string.

   ```ts
   // client/src/lib/templates.test.ts — pure data assertions (no DOM).
   import { describe, expect, it } from "vitest";
   import { WORKSPACE_TEMPLATES } from "./templates";

   const PALETTE = [
   	"powder-blue",
   	"pale-sky",
   	"light-cyan",
   	"frozen-water",
   	"turquoise",
   ];

   describe("WORKSPACE_TEMPLATES", () => {
   	it("has exactly 5 templates with unique ids and names", () => {
   		expect(WORKSPACE_TEMPLATES).toHaveLength(5);
   		expect(new Set(WORKSPACE_TEMPLATES.map((t) => t.id)).size).toBe(5);
   		expect(new Set(WORKSPACE_TEMPLATES.map((t) => t.name)).size).toBe(5);
   	});

   	it("uses only the 5 palette colors", () => {
   		for (const t of WORKSPACE_TEMPLATES) {
   			for (const c of t.columns) {
   				expect(PALETTE).toContain(c.color);
   			}
   		}
   	});

   	it("has exactly one done-column per template", () => {
   		for (const t of WORKSPACE_TEMPLATES) {
   			expect(t.columns.filter((c) => c.isDone)).toHaveLength(1);
   		}
   	});

   	it("gives every column a non-empty title and a policy string", () => {
   		for (const t of WORKSPACE_TEMPLATES) {
   			for (const c of t.columns) {
   				expect(c.title.trim().length).toBeGreaterThan(0);
   				expect(typeof c.policy).toBe("string");
   				expect(c.policy.length).toBeGreaterThan(0);
   			}
   		}
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/lib/templates.test.ts`
   Expected failure: cannot import `../lib/templates`.

3. Implement `client/src/lib/templates.ts`:
   - Export `type TemplateColumn = { title: string; color: ColumnColor; wipLimit: number | null; policy: string; isDone: boolean }` (reuse the `ColumnColor` union; isSignable intentionally omitted = forward-compatible).
   - Export `type WorkspaceTemplate = { id: string; name: string; tagline: string; columns: TemplateColumn[] }`.
   - Export `WORKSPACE_TEMPLATES: WorkspaceTemplate[]` with the 5 templates from
     the spec Appendix (Software Dev, Firmware/Hardware, Management/Ops,
     Purchasing, Bug Tracker) — exact titles, colors, wip limits, policy text,
     done-flags.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/lib/templates.test.ts`
   Expected: PASS

5. Commit:
   `git add client/src/lib/templates.ts client/src/lib/templates.test.ts`
   `git commit -m "feat(templates): add workspace template presets"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md — Appendix: Template Definitions; rule: Forward-compatible config
client/src/components/ColumnView.tsx — ColumnColor union (5 palette names)
client/src/types.ts — Column shape (policy: string)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: lightweight
Justification: one pure data module + test, no runtime logic beyond shape.

## SANDWICH CONTEXT
[CRITICAL: Colors are locked to the 5-palette names; signable fields are forward-compatible only — do NOT add them to the template type as required.]
You are implementing the template preset data for Workspace Template.
Spec: docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md
Design decision: Option A — templates hardcoded client-side.
Files in scope: client/src/lib/templates.ts (+test) — no other files.
Available after: none (prereq)
Architecture rule: client bundler resolution (no import extensions); each template has exactly one done-column; colors ∈ 5 palette names.
[RESTATE: 5 palette colors only; no required signable fields.]

## DELIVERABLE
Given WORKSPACE_TEMPLATES, When inspected, Then 5 templates, each with exactly one done-column and palette-only colors.
Given each template column, Then it has a non-empty title and a policy description matching the spec Appendix.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Exact template content from the spec Appendix
  - Forward-compatible type (signable optional/omitted)
  - TDD order
Must-not-have:
  - Colors outside the 5 palette names
  - More than one done-column per template
  - Server/DB template storage
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: test green, commit created.
Escalate when: spec Appendix is ambiguous for a specific column.

---

### Task 3: Extract shared column-color map [prereq]

## OBJECTIVE
Extract the column color name→CSS mapping (swatch var, label, container classes)
out of `ColumnView.tsx` into a shared module so the picker (T4) and ColumnView
share one source. Pure refactor — no behavior change.

Files:
- Create: `client/src/lib/columnColors.ts`
- Modify: `client/src/components/ColumnView.tsx`

Steps:
1. Create `client/src/lib/columnColors.ts`:
   - Move from `ColumnView.tsx`: the `ColumnColor` union, the swatch map
     (`color → var(--color-*-200)`), the label map (`color → "Powder Blue"` …),
     and the container class map (`color → border/bg-50` classes).
   - Export each as named exports; keep names stable.
2. Update `client/src/components/ColumnView.tsx`:
   - Import the moved symbols from `../lib/columnColors`; delete the local copies.
3. Verify no behavior change:
   `npm run test --workspace=client` (existing ColumnView/board tests still pass)
   and `npm run -w client typecheck` (no unused imports — noUnusedLocals).
4. Commit:
   `git add client/src/lib/columnColors.ts client/src/components/ColumnView.tsx`
   `git commit -m "refactor(columns): extract shared column-color map"`

Mark in QUALITY BAR: `[no-tdd — structural refactor; covered by existing tests + typecheck]`

## REFERENCES LOADED
client/src/components/ColumnView.tsx:16-40,394-403 — color union, swatch/label/class maps to extract
client/src/index.css — `--color-*-50/200` CSS vars referenced by the maps
docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md — Implementation Notes: extract color map to shared module (DRY)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: lightweight
Justification: mechanical move + import rewire across 2 files; no logic change.

## SANDWICH CONTEXT
[CRITICAL: Pure refactor — the rendered output of ColumnView must be byte-identical; do not change class strings or var names.]
You are extracting the shared column-color map for Workspace Template.
Spec: docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md
Design decision: Option A — picker reuses ColumnView's color map.
Files in scope: client/src/lib/columnColors.ts, client/src/components/ColumnView.tsx — no other files.
Available after: none (prereq)
Architecture rule: client bundler resolution (no import extensions); noUnusedLocals/noUnusedParameters enabled — remove the now-unused local copies.
[RESTATE: byte-identical ColumnView output; names stable.]

## DELIVERABLE
[derived] Given the extracted module, When ColumnView imports from it, Then existing client tests and typecheck pass with no behavior change.
[derived] Given the maps, When imported by another component, Then color→swatch/label/class lookups resolve identically.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Stable export names; no behavior change
  - Existing tests + typecheck green
  - [no-tdd — structural refactor]
Must-not-have:
  - Changing class strings, var names, or palette membership
  - Touching files beyond the two listed
Red flags:
  - Any visual/class change → STOP

## STOP CONDITIONS
Done when: existing client tests + typecheck pass, commit created.
Escalate when: extraction forces a behavior change.

---

### Task 4: TemplatePicker component [depends: T2, T3]

## OBJECTIVE
Build the inline picker: a gallery of template cards (color chips + titles +
always-visible policy descriptions), each with a "Use this template" button, plus
a persistent "Start blank instead" action. Presentational — receives data and
callbacks via props; no API calls.

Files:
- Create: `client/src/components/TemplatePicker.tsx`
- Create: `client/src/components/TemplatePicker.test.tsx`

Steps:
1. Write failing test for: preview a11y + picker actions (R: Preview a11y, Picker never a gate)
   File: `client/src/components/TemplatePicker.test.tsx`
   Test verifies:
   - Given the picker rendered with WORKSPACE_TEMPLATES, Then all 5 template
     names render AND each column title AND its policy description text are
     present in the DOM (descriptions are NOT behind hover — assert visible text).
   - Given a click on a template's "Use this template" button, Then onApply is
     called once with that template.
   - Given a click on "Start blank instead", Then onStartBlank is called once.
   - Given state="loading", Then a loading indicator renders and the "Use"
     buttons are disabled.
   - Given state="success", Then the success message "edit any column anytime"
     copy renders.

   ```tsx
   // client/src/components/TemplatePicker.test.tsx — jsdom.
   // No jest-dom in this repo (no setupFiles): use .disabled / toBeTruthy /
   // queryBy, not toBeInTheDocument/toBeDisabled. Lottie children are stubbed.
   import { cleanup, fireEvent, render, screen } from "@testing-library/react";
   import { afterEach, describe, expect, it, vi } from "vitest";

   vi.mock("./LoadingCamel", () => ({
   	default: () => <div data-testid="loading-camel" />,
   }));
   vi.mock("./SuccessAnimation", () => ({
   	default: () => <div data-testid="success-animation" />,
   }));

   import { WORKSPACE_TEMPLATES } from "../lib/templates";
   import TemplatePicker from "./TemplatePicker";

   afterEach(cleanup);

   function renderPicker(
   	overrides: Partial<Parameters<typeof TemplatePicker>[0]> = {},
   ) {
   	const onApply = vi.fn();
   	const onStartBlank = vi.fn();
   	render(
   		<TemplatePicker
   			templates={WORKSPACE_TEMPLATES}
   			state="idle"
   			onApply={onApply}
   			onStartBlank={onStartBlank}
   			{...overrides}
   		/>,
   	);
   	return { onApply, onStartBlank };
   }

   describe("TemplatePicker", () => {
   	it("renders all 5 template names", () => {
   		renderPicker();
   		for (const t of WORKSPACE_TEMPLATES) {
   			expect(screen.getByText(t.name)).toBeTruthy();
   		}
   	});

   	it("renders column titles and policy descriptions as visible text (not hover/title-attr)", () => {
   		renderPicker();
   		const first = WORKSPACE_TEMPLATES[0];
   		for (const c of first.columns) {
   			// getByText matches rendered text content, NOT title/aria attributes.
   			expect(screen.getAllByText(c.title).length).toBeGreaterThan(0);
   			expect(screen.getAllByText(c.policy).length).toBeGreaterThan(0);
   		}
   	});

   	it("calls onApply once with the clicked template", () => {
   		const { onApply } = renderPicker();
   		const buttons = screen.getAllByRole("button", {
   			name: /use this template/i,
   		});
   		fireEvent.click(buttons[0]);
   		expect(onApply).toHaveBeenCalledTimes(1);
   		expect(onApply).toHaveBeenCalledWith(WORKSPACE_TEMPLATES[0]);
   	});

   	it("calls onStartBlank once when 'Start blank instead' is clicked", () => {
   		const { onStartBlank } = renderPicker();
   		fireEvent.click(
   			screen.getByRole("button", { name: /start blank instead/i }),
   		);
   		expect(onStartBlank).toHaveBeenCalledTimes(1);
   	});

   	it("shows a loading indicator and disables apply when state='loading'", () => {
   		renderPicker({ state: "loading" });
   		expect(screen.getByTestId("loading-camel")).toBeTruthy();
   		// Any rendered apply button must be disabled (no enabled apply path).
   		for (const b of screen.queryAllByRole("button", {
   			name: /use this template/i,
   		})) {
   			expect((b as HTMLButtonElement).disabled).toBe(true);
   		}
   	});

   	it("shows the success copy when state='success'", () => {
   		renderPicker({ state: "success" });
   		expect(screen.getByTestId("success-animation")).toBeTruthy();
   		expect(screen.getByText(/edit any column anytime/i)).toBeTruthy();
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/components/TemplatePicker.test.tsx`
   Expected failure: cannot import `./TemplatePicker`.

3. Implement `client/src/components/TemplatePicker.tsx`:
   - Props: `{ templates: WorkspaceTemplate[]; state: "idle" | "loading" | "success"; onApply: (t: WorkspaceTemplate) => void; onStartBlank: () => void }`.
   - idle: render the gallery (horizontally scrollable). Per card: name, tagline,
     a column row using the shared `columnColors` swatch/label, each column's
     title + wip badge + done badge + policy as muted micro-text (always visible).
     Per-card primary button "Use this template" → onApply(t). Persistent ghost/
     secondary "Start blank instead" → onStartBlank.
   - loading: render `<LoadingCamel size={88} />` + "Building your board…"; disable apply.
   - success: render `<SuccessAnimation size={88} />` + "Your board is ready — edit any column anytime to fit your workflow."
   - Follow creative-brief: Work Sans, radius 6px, primary-600 buttons,
     neutral-600 micro-text, neutral-900 headings. Accessible (buttons, not divs).

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/components/TemplatePicker.test.tsx`
   Expected: PASS

5. Commit:
   `git add client/src/components/TemplatePicker.tsx client/src/components/TemplatePicker.test.tsx`
   `git commit -m "feat(templates): add inline TemplatePicker component"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md — rules: Preview a11y, Picker never a gate; the approved ASCII layout
client/src/lib/templates.ts — WorkspaceTemplate type + data (from T2)
client/src/lib/columnColors.ts — shared swatch/label maps (from T3)
client/src/components/SuccessAnimation.tsx — `<SuccessAnimation size>` one-shot lottie
client/src/components/LoadingCamel.tsx — `<LoadingCamel size>`
client/src/components/agent/AgentBoardVisual.tsx:132,140 — loading→success pairing precedent
docs/pocket/rule/creative-brief.md — tokens (Work Sans, OKLCH primary/neutral, radius 6px, button atoms)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: one component but real UI judgment (layout, states, a11y, brand
tokens) and a multi-state contract.

## SANDWICH CONTEXT
[CRITICAL: Policy descriptions must be ALWAYS visible (not hover/title-attr gated) — touch and screen-reader accessibility is an acceptance criterion.]
You are implementing the TemplatePicker for Workspace Template.
Spec: docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md
Design decision: Option A — inline picker replacing the empty-state content.
Files in scope: client/src/components/TemplatePicker.tsx (+test) — no other files.
Available after: T2 (templates), T3 (columnColors)
Architecture rule: client bundler resolution; React hooks rules enforced; reuse SuccessAnimation/LoadingCamel and the shared columnColors map; follow creative-brief tokens; presentational only (no fetch/api here).
[RESTATE: descriptions always visible, not hover-gated.]

## DELIVERABLE
Given the picker rendered, When inspected, Then 5 templates with color chips, titles, wip/done badges, and always-visible policy descriptions.
Given "Use this template" clicked, When fired, Then onApply(template) called once.
Given "Start blank instead" clicked, When fired, Then onStartBlank() called once.
Given state="loading", Then LoadingCamel renders and apply is disabled.
Given state="success", Then SuccessAnimation + "edit any column anytime" copy render.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Always-visible descriptions (a11y); semantic buttons
  - "Start blank instead" always present in idle state
  - creative-brief tokens (no ad-hoc colors)
  - TDD order
Must-not-have:
  - Hover-only/title-attr descriptions
  - API calls or board refetch inside this component
  - Colors outside the shared columnColors map
Open question risks:
  - Success auto-dismiss timing is owned by the caller (T5), not this component.
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: test green, commit created, brief tokens honored.
Escalate when: a required state cannot be expressed via the props contract.

---

### Task 5: api method + BoardPage wiring [depends: T1, T4]

## OBJECTIVE
Add the batch API method and wire the TemplatePicker into the empty-board state:
render the picker when `columns.length === 0`, drive the apply flow
(idle→loading→success→board), and handle the 409 losing-client path by silently
refetching and rendering the now-populated board.

Files:
- Modify: `client/src/api.ts`
- Modify: `client/src/pages/BoardPage.tsx`
- Test: `client/src/api.test.ts` (create or extend)
- Test: `client/src/pages/BoardPage.test.tsx` (create)

Steps:
1. Write failing test for: api batch method contract (R: Apply flow)
   File: `client/src/api.test.ts`
   Test verifies: Given applyTemplate(workspaceId, {templateName, columns}),
   When called, Then it issues POST to `/workspaces/:id/columns/batch` with a
   JSON body `{templateName, columns}` (mock `request`/fetch and assert URL +
   method + body).

   ```ts
   // Append to client/src/api.test.ts (existing file mocks fetch globally via
   // vi.stubGlobal at the top — reuse the existing mockFetch; do NOT redeclare it).
   describe("template batch API", () => {
   	it("applyTemplate POSTs to /columns/batch with {templateName, columns}", async () => {
   		mockFetch.mockClear();
   		mockFetch.mockResolvedValueOnce({
   			ok: true,
   			status: 201,
   			json: () => Promise.resolve([]),
   		});
   		const { api } = await import("./api");

   		const columns = [
   			{ title: "Backlog", color: "powder-blue", wipLimit: null, policy: "Ideas.", isDone: false },
   		];
   		await api.applyTemplate(7, { templateName: "Software Dev", columns });

   		expect(mockFetch).toHaveBeenCalledWith(
   			"/api/workspaces/7/columns/batch",
   			expect.objectContaining({ method: "POST" }),
   		);
   		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
   		expect(body).toEqual({ templateName: "Software Dev", columns });
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/api.test.ts`
   Expected failure: `api.applyTemplate` is undefined.

3. Implement in `client/src/api.ts`:
   - Add `applyTemplate: (workspaceId, body: { templateName: string; columns: TemplateColumn[] }) => request<Column[]>(\`/workspaces/${workspaceId}/columns/batch\`, { method: "POST", body: JSON.stringify(body) })`.
   - Ensure the request layer surfaces HTTP 409 distinguishably (status on the
     thrown error) so the caller can branch.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/api.test.ts`
   Expected: PASS

5. Write failing tests for the wiring (R: 409 silent transition, Picker never a gate)
   File: `client/src/pages/BoardPage.test.tsx`
   Render BoardPage with `useBoard()`, `react-router`, and `../api` mocked (follow
   the jsdom mock pattern in `AgentPage.test.tsx` / `AgentCardDetail.test.tsx`).
   Test verifies:
   - Given an empty board (columns=[]), When rendered, Then the TemplatePicker
     renders (template names present) — not the bare AddColumn empty state.
   - Given api.applyTemplate rejects with a 409 error, When "Use this template"
     is clicked, Then refresh() is invoked AND no error toast is shown.
   - Given api.applyTemplate rejects with a non-409 error, When clicked, Then an
     error toast is shown and the picker remains.
   - Given "Start blank instead" is clicked, Then the manual AddColumn state
     renders and api.applyTemplate is NOT called.

   ```tsx
   // client/src/pages/BoardPage.test.tsx — jsdom.
   // BoardPage is coupled to useBoard(), react-router (useNavigate/Outlet), and
   // the api module; mock all three. No jest-dom: use .disabled / queryBy /
   // toBeTruthy. 409 rejection MUST be a real (mocked) ApiError instance because
   // BoardPage branches on `err instanceof ApiError && err.status === 409`.
   import {
   	cleanup,
   	fireEvent,
   	render,
   	screen,
   	waitFor,
   } from "@testing-library/react";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

   const { mockUseBoard, applyTemplate, refresh, showToast, navigate } =
   	vi.hoisted(() => ({
   		mockUseBoard: vi.fn(),
   		applyTemplate: vi.fn(),
   		refresh: vi.fn(),
   		showToast: vi.fn(),
   		navigate: vi.fn(),
   	}));

   vi.mock("../context/BoardContext", () => ({
   	useBoard: () => mockUseBoard(),
   }));

   vi.mock("react-router", () => ({
   	useNavigate: () => navigate,
   	Outlet: () => null,
   }));

   vi.mock("../api", () => ({
   	ApiError: class ApiError extends Error {
   		status: number;
   		code?: string;
   		constructor(message: string, status: number, code?: string) {
   			super(message);
   			this.status = status;
   			this.code = code;
   		}
   	},
   	api: {
   		applyTemplate: (...a: unknown[]) => applyTemplate(...a),
   		createColumn: vi.fn(),
   		createCard: vi.fn(),
   		moveCard: vi.fn(),
   		updateColumn: vi.fn(),
   	},
   }));

   // Lottie children (via TemplatePicker) are jsdom-unfriendly — stub them.
   vi.mock("../components/LoadingCamel", () => ({
   	default: () => <div data-testid="loading-camel" />,
   }));
   vi.mock("../components/SuccessAnimation", () => ({
   	default: () => <div data-testid="success-animation" />,
   }));

   import { ApiError } from "../api";
   import BoardPage from "./BoardPage";

   beforeEach(() => {
   	applyTemplate.mockReset();
   	refresh.mockReset().mockResolvedValue(undefined);
   	showToast.mockReset();
   	mockUseBoard.mockReturnValue({
   		columns: [],
   		setColumns: vi.fn(),
   		loadError: false,
   		refresh,
   		cancelScheduledRefresh: vi.fn(),
   		showToast,
   		deleteCard: vi.fn(),
   		activeWorkspaceId: 7,
   	});
   });
   afterEach(() => {
   	cleanup();
   	vi.clearAllMocks();
   });

   describe("BoardPage empty-board template picker", () => {
   	it("renders the TemplatePicker on an empty board (not the bare AddColumn empty state)", () => {
   		render(<BoardPage />);
   		expect(screen.getByText("Software Dev")).toBeTruthy();
   		expect(
   			screen.queryByRole("button", { name: /^add column$/i }),
   		).toBeNull();
   	});

   	it("on a 409 apply, silently refetches and shows no error toast", async () => {
   		applyTemplate.mockRejectedValueOnce(new ApiError("conflict", 409));
   		render(<BoardPage />);
   		fireEvent.click(
   			screen.getAllByRole("button", { name: /use this template/i })[0],
   		);
   		await waitFor(() => expect(refresh).toHaveBeenCalled());
   		expect(showToast.mock.calls.every((c) => c[1] !== "error")).toBe(true);
   	});

   	it("on a non-409 apply error, shows an error toast and keeps the picker", async () => {
   		applyTemplate.mockRejectedValueOnce(new ApiError("server boom", 500));
   		render(<BoardPage />);
   		fireEvent.click(
   			screen.getAllByRole("button", { name: /use this template/i })[0],
   		);
   		await waitFor(() =>
   			expect(showToast.mock.calls.some((c) => c[1] === "error")).toBe(true),
   		);
   		expect(screen.getByText("Software Dev")).toBeTruthy();
   	});

   	it("on 'Start blank instead', shows the manual AddColumn state and never applies", () => {
   		render(<BoardPage />);
   		fireEvent.click(
   			screen.getByRole("button", { name: /start blank instead/i }),
   		);
   		expect(
   			screen.getByRole("button", { name: /^add column$/i }),
   		).toBeTruthy();
   		expect(applyTemplate).not.toHaveBeenCalled();
   	});
   });
   ```

6. Run tests — verify FAIL:
   `npm run test --workspace=client -- src/pages/BoardPage.test.tsx`
   Expected failure: TemplatePicker not rendered / `onApplyTemplate`+`onStartBlank`
   handlers absent (BoardPage still renders the bare AddColumn empty state).

7. Wire `client/src/pages/BoardPage.tsx` (the `columns.length === 0` branch at ~L470):
   - Replace the single `<EmptyState ... action={<AddColumn/>} />` with
     `<TemplatePicker templates={WORKSPACE_TEMPLATES} state={pickerState} onApply={onApplyTemplate} onStartBlank={onStartBlank} />`.
   - `onApplyTemplate(t)`: set state "loading"; call `api.applyTemplate(activeWorkspaceId, { templateName: t.name, columns: t.columns })`; on success set "success", then after ~2s `await refresh()` (board renders); on error:
     - if status === 409 → silently `await refresh()` and render the board; show a light **info** toast only if the board was not applied by this client (best-effort: always safe to show "This board was just set up." as info, or suppress on own double-click — info, never error);
     - else → show the existing error toast and reset state to "idle" (picker stays).
   - `onStartBlank()`: keep the manual AddColumn empty state (render the prior
     EmptyState + AddColumn, or a blank state with AddColumn) — no columns created.

8. Run all tests + typecheck:
   `npm run test --workspace=client` and `npm run -w client typecheck`
   Expected: PASS (no unused imports).

9. Commit:
   `git add client/src/api.ts client/src/pages/BoardPage.tsx client/src/api.test.ts client/src/pages/BoardPage.test.tsx`
   `git commit -m "feat(templates): wire template picker into empty board"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md — rules: Apply flow, 409 silent transition, loading+success
client/src/pages/BoardPage.tsx:424-497 — onAddColumn pattern (mutate then await refresh()), empty-state branch
client/src/api.ts:131-149 — createColumn/updateColumn request pattern
client/src/components/TemplatePicker.tsx — props contract (from T4)
client/src/lib/templates.ts — WORKSPACE_TEMPLATES (from T2)
client/src/context/BoardContext.tsx:447 — SSE consumer ignores payload → refresh() is the render path
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: 2 modified files + test; branching apply flow with the 409
silent-transition judgment and the mutate-then-refresh convention.

## SANDWICH CONTEXT
[CRITICAL: On HTTP 409 the client must NOT show an error — it refetches and renders the populated board (silent transition); error toast is only for non-409 failures.]
You are wiring the template picker for Workspace Template.
Spec: docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md
Design decision: Option A — inline picker; client mirrors onAddColumn (call API then await refresh()).
Files in scope: client/src/api.ts, client/src/pages/BoardPage.tsx, client/src/api.test.ts — no other files.
Available after: T1 (endpoint), T4 (picker)
Architecture rule: client bundler resolution; React hooks rules + useExhaustiveDependencies enforced; reuse refresh() as the render path; do not add a new realtime event type.
[RESTATE: 409 → silent refetch + render, never an error toast.]

## DELIVERABLE
Given an empty board, When it renders, Then the TemplatePicker shows (not the bare AddColumn empty state).
Given "Use this template", When apply succeeds (201), Then loading → success → board renders the new columns.
Given apply returns 409, When handled, Then the client refetches and renders the populated board with no error toast (info toast at most).
Given apply returns a non-409 error, When handled, Then an error toast shows and the picker remains.
Given "Start blank instead", When clicked, Then the manual AddColumn state shows and no columns are created.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - 409 → silent transition (refetch + render), no error toast
  - mutate-then-refresh (mirror onAddColumn)
  - "Start blank instead" preserves manual add
  - TDD order for the api method
Must-not-have:
  - New realtime event type
  - Error toast on 409
  - Touching files beyond the three listed
Open question risks:
  - Success auto-dismiss ~2s — if product wants a click-to-continue instead,
    report NEEDS_CONTEXT (trivially adjustable).
Rollback note:
  - To disable: restore the EmptyState+AddColumn branch; batch endpoint becomes
    dead code, no data impact.
Red flags:
  - Error toast shown on 409 → STOP
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, api test green, typecheck clean, commit created.
Uncertain when: success-dismiss UX assumption is contested.
Escalate when: 409 handling cannot be made silent within the existing refresh() flow.

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Batch endpoint + validator | prereq | standard | Empty workspace → 201 atomic 5-col seed; non-empty → 409; FOR UPDATE serializes |
| T2 | Template preset module | prereq | lightweight | 5 templates, palette colors, one done-column each |
| T3 | Extract shared color map | prereq | lightweight | ColumnView unchanged; tests + typecheck green |
| T4 | TemplatePicker component | T2, T3 | standard | Always-visible descriptions; onApply/onStartBlank; loading/success states |
| T5 | api method + BoardPage wiring | T1, T4 | standard | Empty board shows picker; 201→loading→success→board; 409→silent refetch |
