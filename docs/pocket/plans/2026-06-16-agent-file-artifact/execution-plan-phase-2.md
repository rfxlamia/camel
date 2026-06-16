# Agent File Artifact (`create_file` Tool & Deliverable Card) — service integration — bind tool, fallback gate, SSE, QA template (Phase 2 of 3)

**Date:** 2026-06-16
**Original plan:** docs/pocket/plans/2026-06-16-agent-file-artifact/execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T4, T5, T6}
**Unlocks next:** Phase 3

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T4: service integration — bind tool, fallback gate, SSE, QA template [depends: T1, T3]
T5: artifact REST endpoints [depends: T4]
T6: client data + ArtifactCard component [depends: T5]

---

## Pocket Packets

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

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
