# Agent File Artifact (`create_file` Tool & Deliverable Card) — agent_artifacts schema (Phase 1 of 3)

**Date:** 2026-06-16
**Original plan:** docs/pocket/plans/2026-06-16-agent-file-artifact/execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T3}
**Unlocks next:** Phase 2

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T1: agent_artifacts schema [prereq]
T2: pure artifact helpers [prereq]
T3: create_file tool factory [depends: T2]

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
   - `extractRevisedDocument`: Given REAL editor output ending with the handoff footer (`# Title\nBody\n\n---\n*Handoff: Ready for QA Guardian.*`), When extracted, Then the trailing `---`/handoff footer is stripped — returns `"# Title\nBody"` (the artifact must be the clean body, not include the handoff line).
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

   	it("strips the trailing handoff footer from real editor output", () => {
   		const input =
   			"## Editorial Notes\n- note\n\n---\n\n## Revised Document\n# Title\nBody\n\n---\n*Handoff: Ready for QA Guardian.*";
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
   - `slugify(text: string): string` — lowercase, replace non-alphanumeric runs with `-`, cap 80 chars, THEN trim leading/trailing `-` (cap first so a mid-word cut never leaves a trailing hyphen).
   - `deriveFilename(content: string, intent: string): string` — first `^# ` H1 → slugify; else slugify(intent); else `"deliverable"`; suffix `.md`.
   - `extractRevisedDocument(editorOutput: string): string` — if `## Revised Document` heading present, return text after it; else strip a leading `## Editorial Notes` … first `---` block; else return input. In all branches, strip a trailing `---`/`*Handoff:* …` footer if present and trim. Never return empty when input is non-empty.
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
   - `inputSchema` (mirror `webSearch`): `{ type: "object", properties: { content: { type: "string" }, filename: { type: "string" } }, required: ["content"] }`. The model needs `content` declared to call the tool; `filename` is accepted but ignored (backend-derived).
   - `makeCreateFile(ctx: CreateFileCtx): Tool` — `execute` trims content; empty → return `{ ok:false, content:"content is empty", errorCode:"EMPTY_CONTENT" }`; `Buffer.byteLength(content, "utf8") > MAX_ARTIFACT_BYTES` → return `{ ok:false, content:"content exceeds size limit", errorCode:"TOO_LARGE" }`; else `deriveFilename(content, ctx.intent)`, `await ctx.insertArtifact(...)`, return `{ ok:true, content:"saved <filename>" }`. Ignore `input.filename`. NOTE: `ToolResult.content` is REQUIRED (`types.ts`) — every return path, including errors, MUST set `content`, or `tsc --noEmit` fails.
   - Use byte length (`Buffer.byteLength`), not `String.length`, for the cap — the const is named `MAX_ARTIFACT_BYTES` and the spec budgets ~1MB of bytes.
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
Done when: all DELIVERABLE scenarios pass, tests green, `make typecheck` clean (every `ToolResult` return sets `content`), commit created.
Escalate when: a test forces changing Tool.execute signature or importing pg here.

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- `make typecheck` is clean on the server workspace (vitest does not type-check; tsc must pass)
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
