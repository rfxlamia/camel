# Agent File Artifact (`create_file` Tool & Deliverable Card) — AgentPage panel integration (Phase 3 of 3)

**Date:** 2026-06-16
**Original plan:** docs/pocket/plans/2026-06-16-agent-file-artifact/execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T7}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 1 tasks | Prerequisite phases must be complete before starting

T7: AgentPage panel integration [depends: T6]

---

## Pocket Packets

---

### Task 7: AgentPage panel integration [depends: T6]

## OBJECTIVE
Render `ArtifactCard` in the right chat panel when `executionStatus === "done"` and an artifact exists; fetch it in an effect keyed on the board's done-state (covers both reload-already-done and live-transition-to-done) without adding any new SSE/EventSource subscription; show nothing on NEEDS REVISION / failed.

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

   // AgentPage reads searchParams.get("boardId") — the param name MUST be
   // "boardId" (not "board"), or the load effect early-returns and no board
   // ever loads (all three tests would fail).
   vi.mock("react-router", () => ({
   	useSearchParams: () => [new URLSearchParams("boardId=2"), vi.fn()],
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
   	// AgentPage destructures showToast + clearAgentEvents from useBoard() and
   	// calls clearAgentEvents() in the load effect — both MUST be stubbed or the
   	// page crashes (undefined is not a function) once the board loads.
   	mockUseBoard.mockReturnValue({
   		activeWorkspaceId: 1,
   		agentEvents: [],
   		showToast: vi.fn(),
   		clearAgentEvents: vi.fn(),
   	});
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
   - In `AgentPage`, add state `artifact`. Add an effect keyed on `[activeWorkspaceId, board?.id, board?.executionStatus]` that calls `api.getAgentArtifact(activeWorkspaceId, board.id)` when `board?.executionStatus === "done"` (clear to null otherwise). This covers BOTH reload-already-done (`agentEvents` is `[]` after the load effect's `clearAgentEvents()`, so the terminal-event watcher never fires) AND live transition to done — without adding any new SSE subscription. Do NOT hang the fetch off `shouldRefetchBoardOnTerminalEvent`: it returns `shouldFetch:false` on empty events, so a reloaded done board would never get its artifact.
   - On fetch failure, **catch-all → leave `artifact` null** (do NOT gate on `instanceof ApiError`; the 404 rejection is a plain object and would escape an `instanceof` check).
   - Render `<ArtifactCard artifact={artifact} downloadUrl={api.agentArtifactDownloadUrl(activeWorkspaceId, board.id)} />` in the right panel below the "Agent" message block (AgentPage.tsx:617–626) when `isDone && artifact`. `downloadUrl` is a required prop. Guard so failed/needs-revision show nothing.
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
[CRITICAL: Do not add a new SSE/EventSource subscription — `agentEvents` already flows from context. Fetch the artifact in an effect keyed on the board's done-state so a reloaded already-done board also gets it. Card renders only when isDone AND an artifact is present; failed/needs-revision render nothing.]
You are implementing the panel integration for the Agent File Artifact feature.
Spec: docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md
Design decision: Delivery surface = right chat panel artifact card on done.
Files in scope: client/src/pages/AgentPage.tsx, client/src/pages/AgentPage.test.tsx.
Available after: T6 (ArtifactCard + api)
Architecture rule: No new SSE subscription; fetch via a done-state-keyed effect; conditional render guarded on isDone + artifact.
[RESTATE: No new SSE subscription; fetch on board done-state (covers reload-already-done); render card only when done + artifact present.]

## DELIVERABLE
Given done + artifact, When the panel renders, Then ArtifactCard appears below the Agent message.
Given done + no artifact (404), When rendered, Then no card.
[must-not] Given executionStatus failed, When rendered, Then no card and no artifact fetch.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests before implementation (TDD)
  - Fetch in a done-state-keyed effect (works on reload-already-done, not just live transition)
  - Catch-all on fetch failure → artifact null (no `instanceof ApiError` gate)
  - Card only when isDone && artifact present; pass required `downloadUrl` prop
Must-not-have:
  - New SSE/EventSource subscription path
  - Fetch hung off `shouldRefetchBoardOnTerminalEvent` (false on empty events → reloaded done board never gets artifact)
  - Card shown on failed/needs-revision
Open question risks:
  - none
Rollback note:
  - Remove the conditional render to hide the card; rest of page unaffected.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created.
Escalate when: integration requires changes to ArtifactCard's contract (loop back to T6).

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
