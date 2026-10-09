# EXECUTION PLAN — Agent File Artifact (`create_file` Tool & Deliverable Card)

**Date:** 2026-06-16
**Spec:** docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md
**Status:** draft
**Total tasks:** 7

---

## Execution Overview

### Recommended Order
```
T1, T2 (parallel) → T3 → T4 → T5 → T6 → T7
```

> Dependency order is **recommended** — the pocket runner enforces actual parallelism and sequencing.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T1, T2 | start (both prereq) |

### Constraints Reminder
**Architecture:**
- Do NOT touch `classifyIntent` (JSON router, `llm.ts:78`).
- Do NOT change `Tool.execute` signature, `webSearch`, or the `llm.ts` tool-loop — `create_file` is built per-execution in `service.ts` (closure binding).
- Artifacts persist in `agent_artifacts` only — NEVER `card_events`/`agent_card_outputs`.
- Endpoints mirror the outputs endpoint auth (`requireAuth` + `requireWorkspaceMember`, 404 cross-workspace).
- ESM `.js` import extensions, tabs + double quotes (Biome), additive migration (`CREATE TABLE IF NOT EXISTS`).
- UI tokens from `docs/pocket/rule/creative-brief.md` (Work Sans, OKLCH primary/neutral, radius 6px, Button Secondary for Download).

**Out-of-scope (no task may implement):** PDF/DOCX/HTML rendering, Google Drive, artifact edit/versioning, rerun support, `create_file` in any column except QA, changes to `classifyIntent`.

**Assumptions at risk:**
- PASS detection = tool-call primary + `Status:` line parse for fallback gate (A-hardened). If a task cannot detect verdict from `qa_output`, report NEEDS_CONTEXT.
- One artifact per board (UNIQUE board_id, replace).

**Sequencing:** `[depends: TN]` is recommended only; the pocket runner enforces real blocking.

### File Structure Map
```
Rule 1 (create_file from QA on PASS):
  Create: server/src/agent/tools/createFile.ts          (created by: T3)
  Create: server/src/agent/tools/createFile.test.ts     (created by: T3)
  Modify: server/src/agent/service.ts                   (T4 — bind tool, SSE)
  Modify: server/src/agent/templates.ts                 (T4 — QA tools + prompt)
  Modify: server/src/agent/service.test.ts              (T4)
  Test:   server/src/agent/service.test.ts              (T4)

Rule 2 (backend-derived filename) + Rule 3 (A-hardened fallback):
  Create: server/src/agent/artifact.ts                  (created by: T2)
  Create: server/src/agent/artifact.test.ts             (created by: T2)
  Modify: server/src/agent/service.ts                   (T4 — fallback gate uses helpers)

Rule 4 (board-bound tool):
  Modify: server/src/agent/service.ts                   (T4 — closure over boardId/workspaceId + insertArtifact dep)

Rule (storage + auth):
  Modify: server/src/db/agent-schema.sql                (T1 — agent_artifacts table)
  Modify: server/src/agent/routes.ts                    (T5 — realDeps insertArtifact/getArtifact + 2 endpoints)
  Modify: server/src/agent/routes.test.ts               (T5)

Rule 5 (delivery surface):
  Modify: client/src/types.ts                           (T6 — AgentArtifact + AgentEvent type)
  Modify: client/src/api.ts                             (T6 — getAgentArtifact + download URL)
  Create: client/src/components/ArtifactCard.tsx        (created by: T6)
  Create: client/src/components/ArtifactCard.test.tsx   (created by: T6)
  Modify: client/src/pages/AgentPage.tsx                (T7 — render card on done)
```

---

## Pocket Packets

---

### Task 1: agent_artifacts schema [prereq]

## OBJECTIVE
Add the `agent_artifacts` table (one artifact per board) to the agent schema so artifacts persist isolated from `card_events`/`agent_card_outputs`.

Files:
- Modify: `server/src/db/agent-schema.sql`

Steps (structural — `[no-tdd — structural task]`):
1. Append to `server/src/db/agent-schema.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS agent_artifacts (
     id           SERIAL PRIMARY KEY,
     board_id     INTEGER NOT NULL REFERENCES agent_boards(id) ON DELETE CASCADE,
     workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     filename     TEXT NOT NULL,
     format       TEXT NOT NULL DEFAULT 'md' CHECK (format IN ('md')),
     content      TEXT NOT NULL,
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (board_id)
   );
   CREATE INDEX IF NOT EXISTS idx_agent_artifacts_board ON agent_artifacts(board_id);
   ```
2. Verify the migration applies cleanly:
   `make services-up && make db-migrate`
   Expected: no SQL error; re-running is idempotent (`IF NOT EXISTS`).
3. Commit:
   `git add server/src/db/agent-schema.sql`
   `git commit -m "feat(agent): add agent_artifacts table"`

## REFERENCES LOADED
- docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md — rule: Storage isolation & auth
- server/src/db/agent-schema.sql — existing additive-migration pattern (CREATE TABLE IF NOT EXISTS, ON DELETE CASCADE, board_id FK)

## WHY THIS APPROACH
Complexity: lightweight
Justification: Single additive DDL file, no behavioral logic; UNIQUE(board_id) enforces "one artifact per board, replace" at the DB level.

## SANDWICH CONTEXT
[CRITICAL: Additive only — do NOT alter existing tables or columns; CREATE TABLE IF NOT EXISTS.]
You are implementing the artifact storage table for the Agent File Artifact feature.
Spec: docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md
Design decision: Closure-based per-execution tool binding + A-hardened PASS gating; storage isolated in agent_artifacts.
Files in scope: server/src/db/agent-schema.sql only.
Available after: none (prereq)
Architecture rule: Artifacts must persist in agent_artifacts, never card_events/agent_card_outputs.
[RESTATE: Additive only — CREATE TABLE IF NOT EXISTS, no changes to existing tables.]

## DELIVERABLE
Given a fresh DB, When `make db-migrate` runs, Then `agent_artifacts` exists with a UNIQUE(board_id) constraint and a board_id FK that cascades on board delete.
Given the migration runs twice, When re-applied, Then no error (idempotent).

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - UNIQUE(board_id) (one artifact per board)
  - board_id + workspace_id FKs with ON DELETE CASCADE
  - format CHECK limited to 'md'
Must-not-have:
  - Any change to existing tables/columns
  - Storing artifacts in card_events / agent_card_outputs
  - `[no-tdd — structural task]`
Open question risks:
  - none
Rollback note:
  - Table is additive; dropping it is safe (no existing FK depends on it).

## STOP CONDITIONS
Done when: migration applies cleanly and idempotently; table shape matches.
Escalate when: any existing table would need modification to proceed.

---

### Task 2: pure artifact helpers [prereq]

## OBJECTIVE
Implement pure, dependency-free helpers used by the tool and the fallback: filename derivation from H1, Revised-Document extraction, and QA verdict parsing.

Files:
- Create: `server/src/agent/artifact.ts`
- Test: `server/src/agent/artifact.test.ts`

Steps:
1. Write failing tests for:
   File: `server/src/agent/artifact.test.ts`
   - `deriveFilename`: Given content with `# Mengapa Thailand Memiliki Komunitas Transgender`, When derived, Then `"mengapa-thailand-memiliki-komunitas-transgender.md"` (lowercase, non-alphanumeric→hyphen, collapsed, ≤80 chars before `.md`).
   - `deriveFilename`: Given content with no H1 but intent `"riset thailand"`, When derived, Then `"riset-thailand.md"`.
   - `deriveFilename`: Given no H1 and empty intent, When derived, Then `"deliverable.md"`.
   - `extractRevisedDocument`: Given `"## Editorial Notes\n- note\n\n---\n\n## Revised Document\n# Title\nBody"`, When extracted, Then returns `"# Title\nBody"` (text after the `## Revised Document` heading, trimmed).
   - `extractRevisedDocument`: Given text WITHOUT a `## Revised Document` heading but WITH a leading `## Editorial Notes … ---` block, When extracted, Then the leading notes block is stripped and the remainder returned.
   - `extractRevisedDocument`: Given text with neither marker, When extracted, Then the whole input is returned (never empty).
   - `parseQaVerdict`: Given `"**Status:** PASS"`, Then `"pass"`. Given `"**Status:** NEEDS REVISION"`, Then `"needs_revision"`. Given a line `"the document passes"` with no labelled Status, Then `"unknown"`. Matching is anchored to a `Status:`-labelled line, case-insensitive; `"PASS"` substring elsewhere must NOT trigger pass.

   ```ts
   import { describe, expect, it } from "vitest";
   import {
   	deriveFilename,
   	extractRevisedDocument,
   	MAX_ARTIFACT_BYTES,
   	parseQaVerdict,
   } from "./artifact.js";

   describe("deriveFilename", () => {
   	it("slugifies the first H1 heading", () => {
   		const content = "# Mengapa Thailand Memiliki Komunitas Transgender\nBody";
   		expect(deriveFilename(content, "riset thailand")).toBe(
   			"mengapa-thailand-memiliki-komunitas-transgender.md",
   		);
   	});

   	it("falls back to slug(intent) when no H1 is present", () => {
   		expect(deriveFilename("Body with no heading", "riset thailand")).toBe(
   			"riset-thailand.md",
   		);
   	});

   	it("falls back to deliverable.md when no H1 and empty intent", () => {
   		expect(deriveFilename("Body with no heading", "")).toBe("deliverable.md");
   	});

   	it("caps the slug at 80 chars before the .md suffix", () => {
   		const long = `# ${"a".repeat(200)}`;
   		const name = deriveFilename(long, "x");
   		expect(name.endsWith(".md")).toBe(true);
   		expect(name.length - ".md".length).toBeLessThanOrEqual(80);
   	});
   });

   describe("extractRevisedDocument", () => {
   	it("returns the trimmed body after the Revised Document heading", () => {
   		const input =
   			"## Editorial Notes\n- note\n\n---\n\n## Revised Document\n# Title\nBody";
   		expect(extractRevisedDocument(input)).toBe("# Title\nBody");
   	});

   	it("strips a leading Editorial Notes block when the heading is absent", () => {
   		const input = "## Editorial Notes\n- note\n\n---\n\n# Title\nBody";
   		expect(extractRevisedDocument(input)).toBe("# Title\nBody");
   	});

   	it("returns the whole input when neither marker is present", () => {
   		const input = "# Title\nJust a plain document";
   		expect(extractRevisedDocument(input)).toBe(input);
   	});

   	it("never returns empty for non-empty input", () => {
   		expect(extractRevisedDocument("plain body").length).toBeGreaterThan(0);
   	});
   });

   describe("parseQaVerdict", () => {
   	it("parses a labelled PASS status", () => {
   		expect(parseQaVerdict("**Status:** PASS\nLooks good.")).toBe("pass");
   	});

   	it("parses a labelled NEEDS REVISION status", () => {
   		expect(parseQaVerdict("**Status:** NEEDS REVISION\nFix intro.")).toBe(
   			"needs_revision",
   		);
   	});

   	it("returns unknown when no labelled Status line exists (substring trap)", () => {
   		expect(parseQaVerdict("the document passes every check")).toBe("unknown");
   	});

   	it("exports a positive byte cap", () => {
   		expect(MAX_ARTIFACT_BYTES).toBeGreaterThan(0);
   	});
   });
   ```
2. Run test — verify FAIL:
   `npx vitest run server/src/agent/artifact.test.ts`
   Expected failure: module `./artifact.js` not found / functions undefined.
3. Implement minimal code:
   File: `server/src/agent/artifact.ts`
   - `slugify(text: string): string` — lowercase, replace non-alphanumeric runs with `-`, trim leading/trailing `-`, cap 80 chars.
   - `deriveFilename(content: string, intent: string): string` — first `^# ` H1 → slugify; else slugify(intent); else `"deliverable"`; suffix `.md`.
   - `extractRevisedDocument(editorOutput: string): string` — if `## Revised Document` heading present, return trimmed text after it; else strip a leading `## Editorial Notes` … first `---` block; else return input. Never return empty when input is non-empty.
   - `parseQaVerdict(qaOutput: string): "pass" | "needs_revision" | "unknown"` — find a line matching `/^\s*\**status\**\s*:?\s*(pass|needs[ -]?revision)/im`; map; else `"unknown"`.
   - `MAX_ARTIFACT_BYTES = 1_000_000` exported const.
4. Run test — verify PASS:
   `npx vitest run server/src/agent/artifact.test.ts`
   Expected: PASS.
5. Commit:
   `git add server/src/agent/artifact.ts server/src/agent/artifact.test.ts`
   `git commit -m "feat(agent): pure artifact helpers (filename, extract, verdict)"`

## REFERENCES LOADED
- docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md — rules: backend-derived filename, A-hardened fallback
- server/src/agent/templates.ts — Editor output format (`## Editorial Notes` + `---` + `## Revised Document`) and QA format (`**Status:** PASS | NEEDS REVISION`)
- server/src/core/position.ts — existing pure-function module style (tabs, named exports, colocated `.test.ts`)

## WHY THIS APPROACH
Complexity: standard
Justification: Pure functions but with real branching (H1 present/absent, heading present/absent, verdict variants) and the substring-trap guard — needs careful tests. Mirrors `core/` pure-module convention.

## SANDWICH CONTEXT
[CRITICAL: These are PURE functions — no DB, no I/O, no imports from service/llm. Verdict matching must be anchored to a labelled `Status:` line, never a global substring.]
You are implementing artifact helper functions for the Agent File Artifact feature.
Spec: docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md
Design decision: A-hardened PASS gating — verdict text parsed only to gate the fallback.
Files in scope: server/src/agent/artifact.ts, server/src/agent/artifact.test.ts.
Available after: none (prereq)
Architecture rule: No side effects; pure functions only (like server/src/core/).
[RESTATE: Pure functions only; verdict parse anchored to a labelled Status line, not a substring.]

## DELIVERABLE
Given content with an H1, When deriveFilename runs, Then a slugified `<=80char>.md`.
Given no H1, When deriveFilename runs, Then slug(intent).md, or `deliverable.md` when intent empty.
Given editor output with `## Revised Document`, When extractRevisedDocument runs, Then only the document body after that heading.
Given editor output without the heading, When extracted, Then leading Editorial Notes block stripped, else whole input — never empty.
Given `**Status:** PASS`, When parseQaVerdict runs, Then `"pass"`.
[must-not] Given a sentence containing "passes" but no labelled Status line, When parsed, Then result is NOT `"pass"` (returns `"unknown"`).

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written BEFORE implementation (TDD)
  - Verdict parser anchored to labelled Status line; substring-trap test passes
  - extractRevisedDocument never returns empty for non-empty input
Must-not-have:
  - Any import from service.ts / llm.ts / DB
  - PDF/DOCX/HTML logic (format is md-only)
Open question risks:
  - Verdict token could appear localized (e.g., "LULUS") → out of scope; parser returns "unknown" (safe default = no fallback file). If this proves common, report NEEDS_CONTEXT.
Rollback note:
  - New module; deletion is safe.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created.
Uncertain when: verdict appears in a non-English token the parser can't classify.
Escalate when: a helper would need DB/I-O to satisfy a test (means scope is wrong).

---

### Task 3: create_file tool factory [depends: T2]

## OBJECTIVE
Implement a `makeCreateFile(ctx)` factory returning a `Tool` (`name: "create_file"`, `riskTier: "write"`) whose `execute({content, filename?})` derives the filename via `deriveFilename`, enforces the size cap, and persists via the injected `insertArtifact`.

Files:
- Create: `server/src/agent/tools/createFile.ts`
- Test: `server/src/agent/tools/createFile.test.ts`

Steps:
1. Write failing tests for:
   File: `server/src/agent/tools/createFile.test.ts`
   - Given a bound tool with a mock `insertArtifact` and ctx `{boardId:7, workspaceId:3, intent:"x"}`, When `execute({content:"# Title\nBody"})`, Then `insertArtifact` called once with `{boardId:7, workspaceId:3, filename:"title.md", format:"md", content:"# Title\nBody"}` and result `{ok:true}`.
   - Given content with no H1, When executed, Then filename falls back to slug(intent).md (delegates to deriveFilename).
   - Given empty/whitespace content, When executed, Then `insertArtifact` NOT called and result `{ok:false, errorCode:"EMPTY_CONTENT"}`.
   - Given content larger than MAX_ARTIFACT_BYTES, When executed, Then `{ok:false, errorCode:"TOO_LARGE"}` and not persisted.
   - Given LLM-supplied `filename:"hacker"`, When executed, Then backend-derived filename is used (LLM filename ignored).
   - Tool shape: `name === "create_file"`, `riskTier === "write"`, `inputSchema.type === "object"`.

   ```ts
   import { describe, expect, it, vi } from "vitest";
   import { MAX_ARTIFACT_BYTES } from "../artifact.js";
   import { makeCreateFile } from "./createFile.js";

   function buildCtx(overrides: Record<string, unknown> = {}) {
   	const insertArtifact = vi.fn(async () => {});
   	const ctx = {
   		boardId: 7,
   		workspaceId: 3,
   		intent: "riset thailand",
   		insertArtifact,
   		...overrides,
   	};
   	return { ctx, insertArtifact };
   }

   describe("create_file tool factory", () => {
   	it("has the expected tool shape", () => {
   		const { ctx } = buildCtx();
   		const tool = makeCreateFile(ctx as never);
   		expect(tool.name).toBe("create_file");
   		expect(tool.riskTier).toBe("write");
   		expect(tool.inputSchema.type).toBe("object");
   	});

   	it("persists with backend-derived filename and bound board/workspace ids", async () => {
   		const { ctx, insertArtifact } = buildCtx();
   		const tool = makeCreateFile(ctx as never);
   		const result = await tool.execute({ content: "# Title\nBody" });

   		expect(result.ok).toBe(true);
   		expect(insertArtifact).toHaveBeenCalledTimes(1);
   		expect(insertArtifact).toHaveBeenCalledWith({
   			boardId: 7,
   			workspaceId: 3,
   			filename: "title.md",
   			format: "md",
   			content: "# Title\nBody",
   		});
   	});

   	it("falls back to slug(intent) when content has no H1", async () => {
   		const { ctx, insertArtifact } = buildCtx();
   		const tool = makeCreateFile(ctx as never);
   		await tool.execute({ content: "Body without a heading" });

   		expect(insertArtifact).toHaveBeenCalledWith(
   			expect.objectContaining({ filename: "riset-thailand.md" }),
   		);
   	});

   	it("ignores an LLM-supplied filename (backend derives it)", async () => {
   		const { ctx, insertArtifact } = buildCtx();
   		const tool = makeCreateFile(ctx as never);
   		await tool.execute({ content: "# Title\nBody", filename: "hacker" });

   		expect(insertArtifact).toHaveBeenCalledWith(
   			expect.objectContaining({ filename: "title.md" }),
   		);
   	});

   	it("returns EMPTY_CONTENT and does not persist for blank content", async () => {
   		const { ctx, insertArtifact } = buildCtx();
   		const tool = makeCreateFile(ctx as never);
   		const result = await tool.execute({ content: "   " });

   		expect(result).toMatchObject({ ok: false, errorCode: "EMPTY_CONTENT" });
   		expect(insertArtifact).not.toHaveBeenCalled();
   	});

   	it("returns TOO_LARGE and does not persist when over the byte cap", async () => {
   		const { ctx, insertArtifact } = buildCtx();
   		const tool = makeCreateFile(ctx as never);
   		const result = await tool.execute({
   			content: `# T\n${"a".repeat(MAX_ARTIFACT_BYTES + 1)}`,
   		});

   		expect(result).toMatchObject({ ok: false, errorCode: "TOO_LARGE" });
   		expect(insertArtifact).not.toHaveBeenCalled();
   	});
   });
   ```
2. Run test — verify FAIL:
   `npx vitest run server/src/agent/tools/createFile.test.ts`
   Expected failure: `./createFile.js` not found.
3. Implement minimal code:
   File: `server/src/agent/tools/createFile.ts`
   - `interface CreateFileCtx { boardId: number; workspaceId: number; intent: string; insertArtifact: (a:{boardId:number;workspaceId:number;filename:string;format:"md";content:string}) => Promise<void>; }`
   - `makeCreateFile(ctx: CreateFileCtx): Tool` — `execute` trims content; empty → `EMPTY_CONTENT`; >cap → `TOO_LARGE`; else `deriveFilename(content, ctx.intent)`, `await ctx.insertArtifact(...)`, return `{ok:true, content:"saved <filename>"}`. Ignore `input.filename`.
   - Import `deriveFilename`, `MAX_ARTIFACT_BYTES` from `../artifact.js`; `Tool`, `ToolResult` from `./types.js`.
4. Run test — verify PASS:
   `npx vitest run server/src/agent/tools/createFile.test.ts`
5. Commit:
   `git add server/src/agent/tools/createFile.ts server/src/agent/tools/createFile.test.ts`
   `git commit -m "feat(agent): create_file tool factory with board-bound context"`

## REFERENCES LOADED
- docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md — rules: create_file from QA on PASS, backend-derived filename, board-bound tool
- server/src/agent/tools/webSearch.ts — Tool shape (name/description/inputSchema/riskTier/execute) and error-code return style
- server/src/agent/tools/types.ts — `Tool`, `ToolResult` interfaces
- server/src/agent/artifact.ts — `deriveFilename`, `MAX_ARTIFACT_BYTES` (from T2)

## WHY THIS APPROACH
Complexity: standard
Justification: Two files plus branching (empty/oversize/normal) and dependency injection for testability without a DB; mirrors webSearch tool + injected-dep test pattern.

## SANDWICH CONTEXT
[CRITICAL: Do NOT change the `Tool.execute(input)` signature or `webSearch`. Board context arrives via the factory closure (ctx), not via a new execute parameter. The backend derives the filename — ignore any LLM-supplied filename.]
You are implementing the create_file tool for the Agent File Artifact feature.
Spec: docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md
Design decision: Closure-based per-execution binding; persistence via injected insertArtifact.
Files in scope: server/src/agent/tools/createFile.ts, server/src/agent/tools/createFile.test.ts.
Available after: T2 (artifact helpers)
Architecture rule: riskTier "write"; no direct pg import in the tool — persistence is injected.
[RESTATE: Tool.execute signature unchanged; context via factory closure; filename derived by backend.]

## DELIVERABLE
Given a bound tool, When execute({content}) with valid content, Then insertArtifact called with derived filename + bound board/workspace ids, result ok:true.
Given empty content, When executed, Then ok:false EMPTY_CONTENT, nothing persisted.
Given oversize content, When executed, Then ok:false TOO_LARGE, nothing persisted.
[must-not] Given input.filename supplied by the model, When executed, Then the LLM filename must NOT be used.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests before implementation (TDD)
  - Filename derived by backend (deriveFilename), LLM filename ignored
  - Empty/oversize guarded before persistence
Must-not-have:
  - Direct DB/pg access in the tool (persistence injected)
  - Change to Tool.execute signature or webSearch
Open question risks:
  - Content empty/whitespace → returns ok:false; fallback may still recover later (handled in T4).
Rollback note:
  - New module; removing it + the QA tools entry disables the tool.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created.
Escalate when: a test forces changing Tool.execute signature or importing pg here.

---

### Task 4: service integration — bind tool, fallback gate, SSE, QA template [depends: T1, T3]

## OBJECTIVE
Wire artifacts into `runPipeline`: inject `insertArtifact`/`getArtifact` deps, build the board-bound `create_file` and add it to QA's resolved tools, run the A-hardened fallback gate after the loop, publish `agent.artifact.ready`, and update the QA Guardian template to call the tool on PASS only.

Files:
- Modify: `server/src/agent/service.ts`
- Modify: `server/src/agent/templates.ts`
- Test: `server/src/agent/service.test.ts`

Steps:
1. Write failing tests for (in `server/src/agent/service.test.ts`, runPipeline describe):
   - Primary path: Given a QA column whose injected `executeCard` invokes the bound create_file (simulate by having the test's `executeCard` call the passed-in tool), When runPipeline completes, Then `insertArtifact` called once and `agent.artifact.ready` published with `{boardId}`.
   - Tool binding: Given runPipeline resolves QA tools containing `"create_file"`, When executeCard is called for QA, Then the `tools` array passed to executeCard includes a tool named `create_file` (assert on the executeCard mock's args).
   - Fallback PASS: Given executeCard does NOT create an artifact, QA output `"**Status:** PASS"`, editor_output containing `## Revised Document\n# T\nBody`, and `getArtifact` returns null, When runPipeline finalizes, Then `insertArtifact` called with content `"# T\nBody"`.
   - Fallback gated off: Given no artifact and QA output `"**Status:** NEEDS REVISION"`, When finalized, Then `insertArtifact` NOT called and no `agent.artifact.ready`.
   - Isolation: Then artifact persistence never calls the card_events path (assert insertOutput still used for outputs; insertArtifact distinct).

   ```ts
   // Add to server/src/agent/service.test.ts.
   // Reuses the existing buildService harness (DEFAULT_BOARD, ColumnInfo) and
   // the vi.useFakeTimers() / vi.runAllTimersAsync() pattern from runPipeline.
   describe("runPipeline artifact persistence", () => {
   	beforeEach(() => {
   		vi.useFakeTimers();
   	});

   	afterEach(() => {
   		vi.useRealTimers();
   	});

   	// A QA column that resolves the create_file tool.
   	const QA_COLUMNS: ColumnInfo[] = [
   		{
   			columnId: 30,
   			columnSlug: "qa-guardian",
   			systemPrompt: "Review. Intent: {original_intent}",
   			reasoning: false,
   			tools: ["create_file"],
   			toolBudget: 3,
   		} as ColumnInfo,
   	];

   	it("primary path: bound create_file persists artifact and publishes agent.artifact.ready", async () => {
   		const events: Array<Record<string, unknown>> = [];
   		const insertArtifact = vi.fn(async () => {});
   		const { service } = buildService({
   			insertArtifact,
   			getArtifact: vi.fn(async () => null),
   			getOutput: vi.fn(async () => ({ output: "**Status:** PASS", thinking: null })),
   			getColumns: vi.fn().mockResolvedValue(QA_COLUMNS),
   			publishEvent: vi.fn().mockImplementation(async (_wid, event) => {
   				events.push(event);
   			}),
   			// The bound create_file tool is appended to the resolved tools array;
   			// simulate QA invoking it by calling the passed-in tool from executeCard.
   			executeCard: vi
   				.fn()
   				.mockImplementation(
   					async (
   						_sys: string,
   						_intent: string,
   						_prev: string[],
   						_reasoning: boolean,
   						_onToken: (t: string) => void,
   						tools: Array<{ name: string; execute: (i: unknown) => Promise<unknown> }>,
   					) => {
   						const tool = tools.find((t) => t.name === "create_file");
   						await tool!.execute({ content: "# T\nBody" });
   						return { output: "**Status:** PASS" };
   					},
   				),
   		});

   		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
   		await vi.runAllTimersAsync();
   		await promise;

   		expect(insertArtifact).toHaveBeenCalledTimes(1);
   		expect(events).toContainEqual(
   			expect.objectContaining({ type: "agent.artifact.ready", boardId: 1 }),
   		);
   	});

   	it("binds a create_file tool into the QA column's resolved tools", async () => {
   		const { service, deps } = buildService({
   			insertArtifact: vi.fn(async () => {}),
   			getArtifact: vi.fn(async () => ({ filename: "t.md" })),
   			getOutput: vi.fn(async () => ({ output: "**Status:** PASS", thinking: null })),
   			getColumns: vi.fn().mockResolvedValue(QA_COLUMNS),
   			executeCard: vi.fn().mockResolvedValue({ output: "**Status:** PASS" }),
   		});

   		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
   		await vi.runAllTimersAsync();
   		await promise;

   		const toolsArg = (deps.executeCard as ReturnType<typeof vi.fn>).mock
   			.calls[0][5] as Array<{ name: string }>;
   		expect(toolsArg.some((t) => t.name === "create_file")).toBe(true);
   	});

   	it("fallback: PASS with no artifact extracts the Revised Document body", async () => {
   		const insertArtifact = vi.fn(async () => {});
   		const getOutput = vi.fn(async ({ columnSlug }: { columnSlug: string }) => {
   			if (columnSlug === "qa-guardian")
   				return { output: "**Status:** PASS", thinking: null };
   			return {
   				output: "## Editorial Notes\n- n\n\n---\n\n## Revised Document\n# T\nBody",
   				thinking: null,
   			};
   		});
   		const { service } = buildService({
   			insertArtifact,
   			getArtifact: vi.fn(async () => null),
   			getOutput,
   			getColumns: vi.fn().mockResolvedValue(QA_COLUMNS),
   			// executeCard does NOT call create_file → fallback gate must recover.
   			executeCard: vi.fn().mockResolvedValue({ output: "**Status:** PASS" }),
   		});

   		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
   		await vi.runAllTimersAsync();
   		await promise;

   		expect(insertArtifact).toHaveBeenCalledWith(
   			expect.objectContaining({ content: "# T\nBody" }),
   		);
   	});

   	it("fallback gated off: NEEDS REVISION creates no artifact and no ready event", async () => {
   		const events: Array<Record<string, unknown>> = [];
   		const insertArtifact = vi.fn(async () => {});
   		const { service } = buildService({
   			insertArtifact,
   			getArtifact: vi.fn(async () => null),
   			getOutput: vi.fn(async () => ({
   				output: "**Status:** NEEDS REVISION",
   				thinking: null,
   			})),
   			getColumns: vi.fn().mockResolvedValue(QA_COLUMNS),
   			executeCard: vi
   				.fn()
   				.mockResolvedValue({ output: "**Status:** NEEDS REVISION" }),
   			publishEvent: vi.fn().mockImplementation(async (_wid, event) => {
   				events.push(event);
   			}),
   		});

   		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
   		await vi.runAllTimersAsync();
   		await promise;

   		expect(insertArtifact).not.toHaveBeenCalled();
   		expect(
   			events.some((e) => e.type === "agent.artifact.ready"),
   		).toBe(false);
   	});

   	it("isolation: final output still goes to insertOutput, never via insertArtifact", async () => {
   		const insertOutput = vi.fn(async () => {});
   		const insertArtifact = vi.fn(async () => {});
   		const { service } = buildService({
   			insertOutput,
   			insertArtifact,
   			getArtifact: vi.fn(async () => null),
   			getOutput: vi.fn(async () => ({
   				output: "**Status:** NEEDS REVISION",
   				thinking: null,
   			})),
   			getColumns: vi.fn().mockResolvedValue(QA_COLUMNS),
   			executeCard: vi
   				.fn()
   				.mockResolvedValue({ output: "**Status:** NEEDS REVISION" }),
   		});

   		const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
   		await vi.runAllTimersAsync();
   		await promise;

   		expect(insertOutput).toHaveBeenCalledWith(
   			expect.objectContaining({ columnSlug: "qa-guardian" }),
   		);
   		// The QA verdict text was persisted as a normal output, not as an artifact.
   		expect(insertArtifact).not.toHaveBeenCalled();
   	});
   });
   ```
2. Run test — verify FAIL:
   `npx vitest run server/src/agent/service.test.ts`
   Expected failure: insertArtifact/getArtifact deps undefined; no artifact.ready event.
3. Implement minimal code:
   - `service.ts`: extend `AgentBoardServiceDeps` with `insertArtifact?` and `getArtifact?(boardId)`. In `runPipeline`, after resolving `resolvedTools` for a column, if `(column.tools ?? []).includes("create_file")` append `makeCreateFile({ boardId, workspaceId, intent: board.originalIntent, insertArtifact: deps.insertArtifact! })`. After the for-loop (just before final `updateBoard done`), call a private finalize step: if `await deps.getArtifact!(boardId)` is null, read QA output via `deps.getOutput!({boardId, columnSlug:"qa-guardian"})`; if `parseQaVerdict(qaOutput) === "pass"`, read editor output (`columnSlug:"editor"`), `extractRevisedDocument`, and `insertArtifact` (filename via deriveFilename). If an artifact now exists (either path), `publishEvent(workspaceId, { type:"agent.artifact.ready", boardId })`.
   - Import `makeCreateFile` from `./tools/createFile.js`; `parseQaVerdict`, `extractRevisedDocument`, `deriveFilename` from `./artifact.js`.
   - `templates.ts`: add `tools: ["create_file"]` to the `qa-guardian` column; extend its `system_prompt` `<your_job>`/`<output_format>` so that on PASS it calls `create_file` with ONLY the Editor's Revised Document body (no Editorial Notes), and on NEEDS REVISION it does not call the tool.
4. Run test — verify PASS:
   `npx vitest run server/src/agent/service.test.ts`
5. Commit:
   `git add server/src/agent/service.ts server/src/agent/templates.ts server/src/agent/service.test.ts`
   `git commit -m "feat(agent): persist artifact on QA PASS with A-hardened fallback"`

## REFERENCES LOADED
- docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md — rules: create_file on PASS, A-hardened fallback, board-bound tool
- server/src/agent/service.ts — runPipeline loop, resolveTools call site, getOutput dep, empty-output guard, updateBoard done
- server/src/agent/service.test.ts — runPipeline test harness (injected deps via vi.fn)
- server/src/agent/templates.ts — qa-guardian column + placeholder rendering
- server/src/agent/tools/createFile.ts — makeCreateFile factory (from T3)
- server/src/agent/artifact.ts — parseQaVerdict / extractRevisedDocument / deriveFilename (from T2)

## WHY THIS APPROACH
Complexity: standard
Justification: Touches the core pipeline with branching (primary vs fallback vs gated-off) plus a template change; must preserve existing empty-output and isolation invariants.

## SANDWICH CONTEXT
[CRITICAL: Do NOT touch classifyIntent, the llm.ts tool-loop, or the Tool.execute signature. Artifacts go to agent_artifacts via insertArtifact ONLY — never card_events/agent_card_outputs. Fallback creates a file ONLY when parseQaVerdict === "pass".]
You are implementing the pipeline integration for the Agent File Artifact feature.
Spec: docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md
Design decision: Closure binding in service.ts; A-hardened gate (tool-call primary, Status parse only for fallback).
Files in scope: server/src/agent/service.ts, server/src/agent/templates.ts, server/src/agent/service.test.ts.
Available after: T1 (table), T3 (tool factory)
Architecture rule: create_file built per-execution in service; QA is the only column that gets it; fallback gated on parsed PASS.
[RESTATE: No classifyIntent/llm.ts changes; artifacts only via insertArtifact; fallback only on PASS.]

## DELIVERABLE
Given QA invokes the bound create_file, When runPipeline completes, Then one insertArtifact + agent.artifact.ready{boardId}.
Given no tool artifact and Status PASS + editor revised doc, When finalized, Then fallback inserts the extracted body.
Given no tool artifact and Status NEEDS REVISION, When finalized, Then no insertArtifact and no artifact.ready.
Given QA tools include create_file, When executeCard runs for QA, Then its tools arg contains a `create_file` tool.
[must-not] Given artifact persistence, When it runs, Then it must NOT write to card_events/agent_card_outputs.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests before implementation (TDD)
  - Fallback gated on parseQaVerdict === "pass"
  - QA template instructs clean-body create_file on PASS, no call on NEEDS REVISION
  - Existing empty-output guard + output isolation preserved
Must-not-have:
  - Changes to classifyIntent, llm.ts tool-loop, or Tool.execute
  - create_file added to any non-QA column
  - Artifact written to card_events/agent_card_outputs
Open question risks:
  - parseQaVerdict returns "unknown" on localized verdict → no fallback file (safe). Report NEEDS_CONTEXT if tests reveal frequent unknowns.
Rollback note:
  - Remove `tools:["create_file"]` from qa-guardian to disable; pipeline otherwise unchanged.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created.
Uncertain when: verdict parsing is ambiguous for realistic QA output.
Escalate when: a test forces editing llm.ts or classifyIntent.

---

### Task 5: artifact REST endpoints [depends: T4]

## OBJECTIVE
Expose the artifact: a `getArtifact` service method + `realDeps.insertArtifact`/`getArtifact` DB functions, and two authed endpoints — metadata+content and download — mirroring the outputs endpoint guard.

Files:
- Modify: `server/src/agent/routes.ts`
- Modify: `server/src/agent/service.ts` (add `getArtifact` service method exposing the stored row)
- Test: `server/src/agent/service.test.ts` (service method auth/404 contract)
- Test: `server/src/agent/routes.test.ts` (exported DB-helper upsert/select shape)

Steps:
1. Write failing tests for the service method (in `server/src/agent/service.test.ts`) and the exported DB helper (in `server/src/agent/routes.test.ts`). The codebase tests endpoint behaviour through the injected-dep service method + exported DB functions (no supertest), so the auth/404 contract is exercised at the service seam, mirroring the existing `getCardOutput` tests.
   File: `server/src/agent/service.test.ts`
   - Given a member and an existing artifact, When `service.getArtifact({boardId, workspaceId})`, Then `{filename, format, content}`.
   - Given no artifact, Then `{status:404}` and `getArtifact` dep not consulted for cross-board leakage.
   - Given the board lives in another workspace, Then `{status:404}` (not 403) and the `getArtifact` dep is NOT called.
   File: `server/src/agent/routes.test.ts`
   - Given the exported `realDeps.insertArtifact`, When called, Then it issues an upsert keyed on `board_id` (`ON CONFLICT (board_id) DO UPDATE`).
   - Given `realDeps.getArtifact`, When called with a board id, Then exactly one scoped `SELECT ... WHERE board_id=$1`.

   ```ts
   // Add to server/src/agent/service.test.ts (mirrors the getCardOutput tests).
   describe("getArtifact", () => {
   	it("returns the artifact for a member of the owning workspace", async () => {
   		const getArtifact = vi.fn(async () => ({
   			filename: "title.md",
   			format: "md" as const,
   			content: "# Title\nBody",
   		}));
   		const service = createAgentBoardService({
   			getBoard: vi.fn(async () => ({
   				id: 1,
   				status: "approved",
   				workspaceId: 1,
   				userId: 1,
   				originalIntent: "riset",
   			})),
   			getArtifact,
   		});
   		const result = await service.getArtifact({ boardId: 1, workspaceId: 1 });
   		expect(result).toMatchObject({
   			filename: "title.md",
   			format: "md",
   			content: "# Title\nBody",
   		});
   	});

   	it("returns 404 when no artifact exists", async () => {
   		const getArtifact = vi.fn(async () => null);
   		const service = createAgentBoardService({
   			getBoard: vi.fn(async () => ({
   				id: 1,
   				status: "approved",
   				workspaceId: 1,
   				userId: 1,
   				originalIntent: "riset",
   			})),
   			getArtifact,
   		});
   		const result = await service.getArtifact({ boardId: 1, workspaceId: 1 });
   		expect(result).toMatchObject({ status: 404 });
   	});

   	it("returns 404 (not 403, no leak) for a board in another workspace", async () => {
   		const getArtifact = vi.fn(async () => ({
   			filename: "secret.md",
   			format: "md" as const,
   			content: "cross-workspace",
   		}));
   		const service = createAgentBoardService({
   			getBoard: vi.fn(async () => ({
   				id: 1,
   				status: "approved",
   				workspaceId: 2, // board belongs to a DIFFERENT workspace
   				userId: 1,
   				originalIntent: "riset",
   			})),
   			getArtifact,
   		});
   		const result = await service.getArtifact({ boardId: 1, workspaceId: 1 });
   		expect(result).toMatchObject({ status: 404 });
   		expect(result).not.toHaveProperty("content");
   		expect(getArtifact).not.toHaveBeenCalled();
   	});
   });
   ```

   ```ts
   // Add to server/src/agent/routes.test.ts (mirrors getToolTrace DB-helper tests).
   import { realArtifactDeps } from "./routes.js";

   describe("artifact DB helpers", () => {
   	it("insertArtifact upserts keyed on board_id", async () => {
   		const fakeDb = { query: vi.fn(async () => ({ rows: [] })) };
   		await realArtifactDeps.insertArtifact(fakeDb as never, {
   			boardId: 7,
   			workspaceId: 3,
   			filename: "title.md",
   			format: "md",
   			content: "# Title\nBody",
   		});
   		const sql = (fakeDb.query.mock.calls[0][0] as string).toLowerCase();
   		expect(sql).toContain("insert into agent_artifacts");
   		expect(sql).toMatch(/on conflict\s*\(\s*board_id\s*\)\s*do update/i);
   	});

   	it("getArtifact issues a single board-scoped SELECT", async () => {
   		const row = { filename: "title.md", format: "md", content: "# Title" };
   		const fakeDb = { query: vi.fn(async () => ({ rows: [row] })) };
   		const result = await realArtifactDeps.getArtifact(fakeDb as never, 7);

   		expect(fakeDb.query).toHaveBeenCalledTimes(1);
   		expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [7]);
   		const sql = (fakeDb.query.mock.calls[0][0] as string).toLowerCase();
   		expect(sql).toContain("from agent_artifacts");
   		expect(sql).toMatch(/board_id\s*=\s*\$1/i);
   		expect(result).toMatchObject({ filename: "title.md" });
   	});
   });
   ```

   > Note: `realArtifactDeps` is the exported holder for the artifact DB functions (matching the existing `getToolTrace`/`runInsertColumns` export-for-test convention). Wire `insertArtifact`/`getArtifact` into `realDeps` from it. The download header contract (`Content-Disposition: attachment; filename="<name>.md"`, body = content) is set inline in the `GET .../artifact/download` handler, which delegates to the same `service.getArtifact`; it carries no branching beyond the 200/404 already covered above, so it needs no separate unit (its auth + 404 path is identical to the metadata endpoint and asserted via the service method).
2. Run test — verify FAIL:
   `npx vitest run server/src/agent/service.test.ts server/src/agent/routes.test.ts`
   Expected failure: `service.getArtifact` undefined; `realArtifactDeps` not exported.
3. Implement minimal code:
   - `service.ts`: add `getArtifact({boardId, workspaceId})` returning `{filename, format, content}` or `{status:404}` (reuse workspace-scoping pattern of getCardOutput).
   - `routes.ts`: add an exported `realArtifactDeps` holder (matching the `getToolTrace`/`runInsertColumns` export-for-test convention) with `insertArtifact(db, {...})` (`INSERT ... ON CONFLICT (board_id) DO UPDATE SET filename=EXCLUDED.filename, content=EXCLUDED.content, format=EXCLUDED.format, created_at=now()`) and `getArtifact(db, boardId)` (`SELECT filename, format, content FROM agent_artifacts WHERE board_id=$1`); wire both into `realDeps`. Register `GET .../artifact` and `GET .../artifact/download`, both `requireAuth` + `requireWorkspaceMember`, delegating to `service.getArtifact`; the download handler sets `Content-Disposition: attachment; filename="<name>.md"` and writes `content` as the body.
4. Run test — verify PASS:
   `npx vitest run server/src/agent/service.test.ts server/src/agent/routes.test.ts`
5. Commit:
   `git add server/src/agent/routes.ts server/src/agent/service.ts server/src/agent/routes.test.ts server/src/agent/service.test.ts`
   `git commit -m "feat(agent): artifact fetch + download endpoints"`

## REFERENCES LOADED
- docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md — rule: storage + auth (404 cross-workspace)
- server/src/agent/routes.ts — outputs endpoint (requireAuth + requireWorkspaceMember, 404 pattern), realDeps DB-fn style, ON CONFLICT usage
- server/src/agent/service.ts — getCardOutput workspace-scoping pattern

## WHY THIS APPROACH
Complexity: standard
Justification: Two endpoints + two DB functions + service method; must replicate the exact auth/404 contract and set correct download headers.

## SANDWICH CONTEXT
[CRITICAL: Both endpoints MUST use requireAuth + requireWorkspaceMember and return 404 (not 403) for cross-workspace access. insertArtifact MUST upsert on board_id (one per board).]
You are implementing the artifact REST endpoints for the Agent File Artifact feature.
Spec: docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md
Design decision: Endpoints mirror outputs endpoint; storage isolated to agent_artifacts.
Files in scope: server/src/agent/routes.ts, server/src/agent/service.ts, server/src/agent/routes.test.ts, server/src/agent/service.test.ts.
Available after: T4 (insertArtifact dep + finalize logic in service)
Architecture rule: Same auth guard as outputs endpoint; 404 cross-workspace; upsert on board_id.
[RESTATE: requireAuth + requireWorkspaceMember, 404 cross-workspace; upsert one artifact per board.]

## DELIVERABLE
Given a member with an existing artifact, When GET .../artifact, Then 200 {filename, format, content}.
Given no artifact, When GET .../artifact, Then 404.
Given a cross-workspace board id, When GET .../artifact, Then 404.
Given GET .../artifact/download, Then attachment headers with the .md filename and content body.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests before implementation (TDD)
  - 404 (not 403) cross-workspace, matching outputs endpoint
  - insertArtifact upserts on board_id
  - Download sets Content-Disposition attachment with the derived filename
Must-not-have:
  - New auth pattern divergent from outputs endpoint
  - Exposing artifacts cross-workspace
Open question risks:
  - none (auth pattern is established)
Rollback note:
  - Endpoints are additive; removing them leaves storage intact.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created.
Escalate when: replicating the 404 guard requires touching auth middleware.

---

### Task 6: client data + ArtifactCard component [depends: T5]

## OBJECTIVE
Add the client contract (types + api) and a self-contained `ArtifactCard` that renders the card (name · "Document · MD" · Download) and a full-screen markdown modal on click — verifiable in isolation via a jsdom test.

Files:
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Create: `client/src/components/ArtifactCard.tsx`
- Test: `client/src/components/ArtifactCard.test.tsx`

Steps:
1. Write failing tests for (jsdom):
   File: `client/src/components/ArtifactCard.test.tsx`
   - Given `ArtifactCard` with `artifact={filename:"x.md", format:"md", content:"# Hi"}`, When rendered, Then shows `"x.md"` and the text `"Document · MD"` and a Download control.
   - When the card body is clicked, Then a full-screen modal appears rendering the markdown (`# Hi` → an `<h1>` with "Hi").
   - When the modal close control is clicked, Then the modal is removed.
   - Download control points to the artifact download URL (assert `href`/handler).

   ```tsx
   import { fireEvent, render, screen } from "@testing-library/react";
   import { describe, expect, it } from "vitest";
   import ArtifactCard from "./ArtifactCard";

   const ARTIFACT = {
   	filename: "x.md",
   	format: "md" as const,
   	content: "# Hi\n\nBody text.",
   };

   const DOWNLOAD_URL = "/workspaces/1/agent/boards/2/artifact/download";

   describe("ArtifactCard", () => {
   	it("renders the filename, the Document · MD meta, and a Download control", () => {
   		render(<ArtifactCard artifact={ARTIFACT} downloadUrl={DOWNLOAD_URL} />);
   		expect(screen.getByText("x.md")).toBeTruthy();
   		expect(screen.getByText(/Document · MD/i)).toBeTruthy();
   		expect(screen.getByText(/download/i)).toBeTruthy();
   	});

   	it("points the Download control at the artifact download URL", () => {
   		const { container } = render(
   			<ArtifactCard artifact={ARTIFACT} downloadUrl={DOWNLOAD_URL} />,
   		);
   		const link = container.querySelector(`a[href="${DOWNLOAD_URL}"]`);
   		expect(link).toBeTruthy();
   	});

   	it("opens a full-screen markdown modal rendering the document on card click", () => {
   		render(<ArtifactCard artifact={ARTIFACT} downloadUrl={DOWNLOAD_URL} />);
   		expect(screen.queryByRole("dialog")).toBeNull();

   		fireEvent.click(screen.getByText("x.md"));

   		const heading = screen.getByRole("heading", { level: 1 });
   		expect(heading.textContent).toContain("Hi");
   	});

   	it("closes the modal when the close control is clicked", () => {
   		render(<ArtifactCard artifact={ARTIFACT} downloadUrl={DOWNLOAD_URL} />);
   		fireEvent.click(screen.getByText("x.md"));
   		expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();

   		fireEvent.click(screen.getByLabelText(/close/i));
   		expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
   	});
   });
   ```
2. Run test — verify FAIL:
   `npx vitest run client/src/components/ArtifactCard.test.tsx`
   Expected failure: component not found.
3. Implement minimal code:
   - `types.ts`: `export interface AgentArtifact { filename: string; format: "md"; content: string }`; add `"agent.artifact.ready"` to the `AgentEvent["type"]` union.
   - `api.ts`: `getAgentArtifact(workspaceId, boardId)` → `request<AgentArtifact>(.../artifact)`; `agentArtifactDownloadUrl(workspaceId, boardId)` returning the download path.
   - `ArtifactCard.tsx`: presentational; props `{artifact, downloadUrl}`. Card uses creative-brief tokens (surface neutral-100, border neutral-200, radius 6px, doc icon neutral-600, filename base, meta "Document · MD" sm neutral-500, Download = Button Secondary). Click opens a full-screen modal reusing `react-markdown` + `remark-gfm` (same as AgentCardDetail) with a close control. No localStorage.
4. Run test — verify PASS:
   `npx vitest run client/src/components/ArtifactCard.test.tsx`
5. Commit:
   `git add client/src/types.ts client/src/api.ts client/src/components/ArtifactCard.tsx client/src/components/ArtifactCard.test.tsx`
   `git commit -m "feat(agent): artifact card + full-screen reader"`

## REFERENCES LOADED
- docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md — rule: delivery surface
- client/src/components/AgentCardDetail.tsx — react-markdown + remark-gfm usage to reuse for the modal
- client/src/api.ts — typed request wrapper + existing agent methods (getAgentCardOutput)
- client/src/types.ts — AgentEvent union, AgentBoard/AgentCardOutput shapes
- docs/pocket/rule/creative-brief.md — Button Secondary, neutral/primary tokens, radius 6px, Work Sans

## WHY THIS APPROACH
Complexity: standard
Justification: Component with interaction (modal open/close) plus contract additions; isolated jsdom test makes it verifiable without AgentPage.

## SANDWICH CONTEXT
[CRITICAL: No browser storage (localStorage/sessionStorage). Reuse the existing react-markdown renderer — do NOT add a new markdown library. UI must follow creative-brief tokens.]
You are implementing the artifact card + reader for the Agent File Artifact feature.
Spec: docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md
Design decision: Delivery = artifact card in right panel → full-screen modal.
Files in scope: client/src/types.ts, client/src/api.ts, client/src/components/ArtifactCard.tsx, client/src/components/ArtifactCard.test.tsx.
Available after: T5 (endpoints live)
Architecture rule: Reuse react-markdown/remark-gfm; creative-brief tokens; no localStorage.
[RESTATE: Reuse existing markdown renderer; creative-brief tokens; no browser storage.]

## DELIVERABLE
Given an artifact, When ArtifactCard renders, Then filename + "Document · MD" + Download shown.
Given the card is clicked, When opened, Then a full-screen modal renders the markdown.
Given the modal close control, When clicked, Then the modal closes.
[must-not] Given the component, When implemented, Then it must NOT use localStorage/sessionStorage.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests before implementation (TDD)
  - Reuse react-markdown + remark-gfm
  - creative-brief tokens (Button Secondary for Download, radius 6px)
Must-not-have:
  - New markdown library
  - localStorage/sessionStorage
  - Business logic in the component beyond render + modal toggle
Open question risks:
  - none
Rollback note:
  - New component; unused until T7 wires it in.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created.
Escalate when: tcss/markdown reuse forces adding a dependency.

---

### Task 7: AgentPage panel integration [depends: T6]

## OBJECTIVE
Render `ArtifactCard` in the right chat panel when `executionStatus === "done"` and an artifact exists; fetch it on the existing terminal-event watcher; show nothing on NEEDS REVISION / failed.

Files:
- Modify: `client/src/pages/AgentPage.tsx`
- Test: `client/src/pages/AgentPage.test.tsx` (create if absent, jsdom)

Steps:
1. Write failing tests for (jsdom, mocking `api.getAgentArtifact`):
   - Given a board with `executionStatus="done"` and `getAgentArtifact` resolves an artifact, When AgentPage renders, Then an ArtifactCard appears below the "Agent" message.
   - Given `executionStatus="done"` and `getAgentArtifact` rejects/404 (no artifact), When rendered, Then no ArtifactCard.
   - Given `executionStatus="failed"`, When rendered, Then no ArtifactCard and no artifact fetch.

   ```tsx
   // client/src/pages/AgentPage.test.tsx — NEW FILE (jsdom).
   // AgentPage is coupled to useBoard(), react-router, and the api module; mock
   // all three (matching AgentCardDetail.test.tsx) so the test exercises ONLY the
   // done-state artifact fetch + conditional ArtifactCard render.
   import { render, screen, waitFor } from "@testing-library/react";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
   import type { AgentBoard } from "../types";

   const mockUseBoard = vi.fn();
   vi.mock("../context/BoardContext", () => ({
   	useBoard: () => mockUseBoard(),
   }));

   vi.mock("react-router", () => ({
   	useSearchParams: () => [new URLSearchParams("board=2"), vi.fn()],
   }));

   const getAgentArtifact = vi.fn();
   vi.mock("../api", () => ({
   	ApiError: class ApiError extends Error {
   		status: number;
   		constructor(status: number) {
   			super("api error");
   			this.status = status;
   		}
   	},
   	api: {
   		getAgentBoard: (...a: unknown[]) => mockGetBoard(...a),
   		getAgentArtifact: (...a: unknown[]) => getAgentArtifact(...a),
   	},
   	agentArtifactDownloadUrl: () =>
   		"/workspaces/1/agent/boards/2/artifact/download",
   }));

   // ArtifactCard is verified in isolation in T6; stub it to a sentinel so this
   // test asserts only that AgentPage renders it (or not) on the right transition.
   vi.mock("../components/ArtifactCard", () => ({
   	default: ({ artifact }: { artifact: { filename: string } }) => (
   		<div data-testid="artifact-card">{artifact.filename}</div>
   	),
   }));

   const mockGetBoard = vi.fn();
   import AgentPage from "./AgentPage";

   function makeBoard(executionStatus: AgentBoard["executionStatus"]): AgentBoard {
   	return {
   		id: 2,
   		originalIntent: "riset thailand",
   		templateId: "research-report",
   		status: "approved",
   		executionStatus,
   		createdAt: "2026-06-16T10:00:00Z",
   		columns: [],
   	} as AgentBoard;
   }

   beforeEach(() => {
   	getAgentArtifact.mockReset();
   	mockGetBoard.mockReset();
   	mockUseBoard.mockReturnValue({ activeWorkspaceId: 1, agentEvents: [] });
   });
   afterEach(() => vi.clearAllMocks());

   describe("AgentPage artifact panel", () => {
   	it("renders ArtifactCard when done and an artifact resolves", async () => {
   		mockGetBoard.mockResolvedValue(makeBoard("done"));
   		getAgentArtifact.mockResolvedValue({
   			filename: "x.md",
   			format: "md",
   			content: "# Hi",
   		});
   		render(<AgentPage />);
   		expect(await screen.findByTestId("artifact-card")).toBeTruthy();
   	});

   	it("renders no ArtifactCard when done but the artifact 404s", async () => {
   		mockGetBoard.mockResolvedValue(makeBoard("done"));
   		getAgentArtifact.mockRejectedValue({ status: 404 });
   		render(<AgentPage />);
   		await waitFor(() => expect(getAgentArtifact).toHaveBeenCalled());
   		expect(screen.queryByTestId("artifact-card")).toBeNull();
   	});

   	it("renders no ArtifactCard and never fetches the artifact on a failed run", async () => {
   		mockGetBoard.mockResolvedValue(makeBoard("failed"));
   		render(<AgentPage />);
   		await waitFor(() => expect(mockGetBoard).toHaveBeenCalled());
   		expect(screen.queryByTestId("artifact-card")).toBeNull();
   		expect(getAgentArtifact).not.toHaveBeenCalled();
   	});
   });
   ```

   > Note: the exact `useBoard()` shape and the board-fetch method (`getAgentBoard` here) must be aligned to what `AgentPage` actually calls during implementation — adjust the mock surface to match the real context/api the page consumes; the assertions (card present / absent / no-fetch-on-failed) are the load-bearing contract.
2. Run test — verify FAIL:
   `npx vitest run client/src/pages/AgentPage.test.tsx`
   Expected failure: no artifact card rendered.
3. Implement minimal code:
   - In `AgentPage`, add state `artifact`; in the existing terminal-event effect (re-fetch on done/failed), when status becomes `done`, call `api.getAgentArtifact`; on success set state, on 404 leave null. Render `<ArtifactCard>` in the right panel below the "Agent" message block when `isDone && artifact`. Guard so failed/needs-revision show nothing.
4. Run test — verify PASS:
   `npx vitest run client/src/pages/AgentPage.test.tsx`
5. Commit:
   `git add client/src/pages/AgentPage.tsx client/src/pages/AgentPage.test.tsx`
   `git commit -m "feat(agent): show artifact card in panel on done"`

## REFERENCES LOADED
- docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md — rule: delivery surface (card on done; none on failed)
- client/src/pages/AgentPage.tsx — right panel structure, terminal-event watcher (re-fetch on done/failed), isDone/isFailed flags
- client/src/components/ArtifactCard.tsx — component API (from T6)
- client/src/api.ts — getAgentArtifact (from T6)

## WHY THIS APPROACH
Complexity: standard
Justification: Single page modification but with async fetch on a state transition and conditional rendering across done/failed/needs-revision.

## SANDWICH CONTEXT
[CRITICAL: Reuse the EXISTING terminal-event watcher — do not add a new SSE subscription. Card renders only when isDone AND an artifact is present; failed/needs-revision render nothing.]
You are implementing the panel integration for the Agent File Artifact feature.
Spec: docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md
Design decision: Delivery surface = right chat panel artifact card on done.
Files in scope: client/src/pages/AgentPage.tsx, client/src/pages/AgentPage.test.tsx.
Available after: T6 (ArtifactCard + api)
Architecture rule: Reuse existing watcher; conditional render guarded on isDone + artifact.
[RESTATE: Reuse existing terminal-event watcher; render card only when done + artifact present.]

## DELIVERABLE
Given done + artifact, When the panel renders, Then ArtifactCard appears below the Agent message.
Given done + no artifact (404), When rendered, Then no card.
[must-not] Given executionStatus failed, When rendered, Then no card and no artifact fetch.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests before implementation (TDD)
  - Fetch on the existing terminal-event watcher only
  - Card only when isDone && artifact present
Must-not-have:
  - New SSE subscription path
  - Card shown on failed/needs-revision
Open question risks:
  - none
Rollback note:
  - Remove the conditional render to hide the card; rest of page unaffected.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created.
Escalate when: integration requires changes to ArtifactCard's contract (loop back to T6).

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|------------------|
| T1 | agent_artifacts schema | prereq | lightweight | Table exists, UNIQUE(board_id), idempotent migrate |
| T2 | pure artifact helpers | prereq | standard | deriveFilename/extractRevisedDocument/parseQaVerdict incl. substring-trap |
| T3 | create_file tool factory | T2 | standard | Bound execute persists derived filename; empty/oversize guarded |
| T4 | service integration + QA template | T1, T3 | standard | PASS → artifact + SSE; NEEDS REVISION → none; fallback on parsed PASS |
| T5 | artifact REST endpoints | T4 | standard | 200/404 fetch + download headers; 404 cross-workspace |
| T6 | client data + ArtifactCard | T5 | standard | Card renders + modal opens/closes; no localStorage |
| T7 | AgentPage panel integration | T6 | standard | Card on done+artifact; none on failed |
