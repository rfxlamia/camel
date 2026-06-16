# Agent Live Thinking Stream + Clickable Active Column — AgentBoardVisual clickable active/pending/failed columns (consumer) (Phase 3 of 3)

**Date:** 2026-06-16
**Original plan:** /Users/rfxlamia/project/kanban/docs/pocket/plans/2026-06-16-agent-live-thinking-stream/execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T7}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 1 tasks | Prerequisite phases must be complete before starting

T7: AgentBoardVisual clickable active/pending/failed columns (consumer) [depends: T6]

---

## Pocket Packets

---

### Task 7: AgentBoardVisual clickable active/pending/failed columns (consumer) [depends: T6]

## OBJECTIVE
Make the in-progress (active), pending, and failed columns clickable to open the panel, with correct state derivation — an active column opens the live panel; a failed column is distinguished from a not-yet-run one.

Files:
- Modify: `client/src/pages/AgentPage.tsx` (AgentBoardVisual + state derivation)
- Test: `client/src/pages/agentBoardVisual.test.tsx` (extract pure derivation helper to test)

Steps:
1. Write failing tests for an extracted pure helper `deriveColumnState(agentEvents, boardId, slug, executionStatus)` → `"active" | "done" | "failed" | "pending"`:
   File: `client/src/pages/agentBoardVisual.test.tsx`
   Tests verify:
   - Given started without done/failed, Then "active".
   - Given done, Then "done".
   - Given failed for that slug, Then "failed" (NOT forced done by board executionStatus).
   - Given no events for slug while another runs, Then "pending".

   ```tsx
   // client/src/pages/agentBoardVisual.test.tsx — NEW FILE.
   // Tests ONLY the extracted pure helper (no DOM render needed). Export
   // deriveColumnState from AgentPage.tsx so it is unit-testable in isolation.
   import { describe, expect, it } from "vitest";
   import type { AgentEvent } from "../types";
   import { deriveColumnState } from "./AgentPage";

   const SLUG = "analysis-specialist";
   const BOARD = 5;

   function ev(
   	type: AgentEvent["type"],
   	columnSlug = SLUG,
   	boardId = BOARD,
   ): AgentEvent {
   	return { type, columnSlug, boardId } as AgentEvent;
   }

   describe("deriveColumnState", () => {
   	it("returns 'active' when started but not done/failed", () => {
   		expect(
   			deriveColumnState([ev("agent.card.started")], BOARD, SLUG, "running"),
   		).toBe("active");
   	});

   	it("returns 'done' when the column emitted agent.card.done", () => {
   		expect(
   			deriveColumnState(
   				[ev("agent.card.started"), ev("agent.card.done")],
   				BOARD,
   				SLUG,
   				"running",
   			),
   		).toBe("done");
   	});

   	it("returns 'failed' for a failed column even when board executionStatus is 'done'", () => {
   		expect(
   			deriveColumnState(
   				[ev("agent.card.started"), ev("agent.card.failed")],
   				BOARD,
   				SLUG,
   				"done",
   			),
   		).toBe("failed");
   	});

   	it("returns 'pending' when no events exist for this slug while another column runs", () => {
   		const eventsForOther = [
   			ev("agent.card.started", "research-specialist"),
   		];
   		expect(
   			deriveColumnState(eventsForOther, BOARD, SLUG, "running"),
   		).toBe("pending");
   	});

   	it("does not bleed across boards (same slug, different boardId)", () => {
   		const otherBoard = [ev("agent.card.started", SLUG, 99)];
   		expect(deriveColumnState(otherBoard, BOARD, SLUG, "running")).toBe(
   			"pending",
   		);
   	});
   });
   ```
2. Run — verify FAIL: `npx vitest run client/src/pages/agentBoardVisual.test.tsx`.
3. Implement:
   - Extract `deriveColumnState` (pure) and use it in `AgentBoardVisual`; do not force `isDone` for all columns when `executionStatus==="done"` if that column failed.
   - Make active, pending, and failed columns clickable (onClick → onCardClick(col)) with appropriate affordance; keep done clickable.
   - Active shows LoadingCamel + remains clickable; failed shows a failed affordance; pending shows neutral.
4. Run — verify PASS.
5. Commit: `git add client/src/pages/AgentPage.tsx client/src/pages/agentBoardVisual.test.tsx` → `git commit -m "feat(agent): clickable active/pending/failed columns during execution"`

## REFERENCES LOADED
spec — rules R-B, R-E, EC4
client/src/pages/AgentPage.tsx — AgentBoardVisual (isDone/isActive derivation, line ~143; only done clickable)
client/src/lib/agentStream.ts (T4) — boardId-scoped helpers if needed

## WHY THIS APPROACH
Complexity: standard
Justification: One file; the risky part (state derivation incl. failed-vs-done) is extracted to a pure tested helper; the rest is clickability wiring.

## SANDWICH CONTEXT
[CRITICAL: Do NOT force every column to isDone when board executionStatus==="done" — a failed/not-run column must derive its own state (EC4).]
You are implementing clickable in-progress columns.
Spec: docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md
Design decision: reuse panel; distinct failed vs pending.
Files in scope: client/src/pages/AgentPage.tsx (+ test).
Available after: T6 (panel handles the states it opens into).
Architecture rule: consult creative-brief.md for affordances; Biome tabs; no out-of-scope files.
[RESTATE: per-column state derivation; never blanket-done; active is clickable.]

## DELIVERABLE
Given a column is active, When clicked, Then the live panel opens.
Given a column failed, Then it shows a failed affordance and opens a failed state.
Given a pending column, Then neutral + clickable to a neutral panel.
Given done, Then unchanged.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have: active/pending/failed clickable; deriveColumnState tested; failed≠done; TDD order; creative-brief affordances.
Must-not-have: blanket isDone; touching card_events; chat re-enable.
Open question risks: none.
Rollback note: revert commit returns to done-only clickable.

## STOP CONDITIONS
Done when: DELIVERABLE passes, tests green, commit created.
Escalate when: state derivation needs data not present in agentEvents/board.

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
