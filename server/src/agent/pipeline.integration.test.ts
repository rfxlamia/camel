import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import type { CardTimestamps } from "../core/metrics.js";
import { executeCard as realExecuteCard } from "./llm.js";
import type { ColumnInfo } from "./service.js";
import { createAgentBoardService } from "./service.js";
import { getTemplate } from "./templates.js";

const INTENT = "Explain quantum computing to a business executive";

const template = getTemplate("research-report")!;
const mockColumns: ColumnInfo[] = template.columns.map((c) => ({
  columnId: c.position,
  columnSlug: c.slug,
  systemPrompt: c.system_prompt,
  reasoning: c.reasoning,
}));

describe.skipIf(!process.env.RUN_LLM_IT)(
  "Live-LLM pipeline: runPipeline end-to-end",
  { timeout: 900_000 },
  () => {
    it("runs all 5 cards, accumulates outputs, and leaves no placeholder leaks", async () => {
      const captured: {
        outputs: Array<{
          columnSlug: string;
          cardIndex: number;
          output: string;
        }>;
        prompts: string[];
        boardStatus: string;
        events: Array<Record<string, unknown>>;
      } = { outputs: [], prompts: [], boardStatus: "running", events: [] };

      const executeCardSpy = vi.fn(
        async (
          systemPrompt: string,
          intent: string,
          previousOutputs: string[],
          reasoning: boolean,
          onToken: (token: string) => void,
        ) => {
          captured.prompts.push(systemPrompt);
          return realExecuteCard(
            systemPrompt,
            intent,
            previousOutputs,
            reasoning,
            onToken,
          );
        },
      );

      const service = createAgentBoardService({
        getBoard: async () => ({
          id: 1,
          workspaceId: 1,
          userId: 1,
          templateId: "research-report",
          originalIntent: INTENT,
          status: "approved",
          executionStatus: "running",
        }),
        getColumns: async () => mockColumns,
        insertOutput: async (data) => {
          captured.outputs.push({
            columnSlug: data.columnSlug,
            cardIndex: data.cardIndex,
            output: data.output,
          });
        },
        insertCard: async () => {},
        updateBoard: async (_id, data) => {
          if (data.execution_status) {
            captured.boardStatus = data.execution_status as string;
          }
        },
        publishEvent: async (_wid, event) => {
          captured.events.push(event);
        },
        executeCard: executeCardSpy,
      });

      await service.runPipeline({ boardId: 1, workspaceId: 1 });

      expect(captured.outputs).toHaveLength(5);
      expect(captured.boardStatus).toBe("done");

      const PLACEHOLDER_RE = /\{[a-z][a-z0-9_]*\}/;

      for (const prompt of captured.prompts) {
        expect(prompt).not.toMatch(PLACEHOLDER_RE);
      }
      for (const { output } of captured.outputs) {
        expect(output.trim().length).toBeGreaterThan(0);
        expect(output).not.toMatch(PLACEHOLDER_RE);
      }

      const indices = captured.outputs
        .map((o) => o.cardIndex)
        .sort((a, b) => a - b);
      expect(indices).toEqual([0, 1, 2, 3, 4]);
    });

    it("streams live thinking end-to-end and accepts max_tokens=24576 (opt-in)", async () => {
      const events: Array<Record<string, unknown>> = [];
      const service = createAgentBoardService({
        getBoard: vi.fn(async () => ({
          id: 1,
          workspaceId: 1,
          userId: 1,
          templateId: "research-report",
          originalIntent: INTENT,
          status: "approved",
          executionStatus: "running",
        })),
        getColumns: vi.fn(async () => [mockColumns[0]]),
        executeCard: realExecuteCard,
        insertOutput: vi.fn(async () => {}),
        insertCard: vi.fn(async () => {}),
        updateBoard: vi.fn(async () => {}),
        publishEvent: vi.fn(
          async (_wid: number, e: Record<string, unknown>) => {
            events.push(e);
          },
        ),
      });

      await service.runPipeline({ boardId: 1, workspaceId: 1 });

      const failed = events.find((e) => e.type === "agent.card.failed");
      expect(failed, JSON.stringify(failed)).toBeUndefined();

      const thinking = events.filter((e) => e.type === "agent.card.thinking");
      expect(thinking.length).toBeGreaterThan(0);
      expect(thinking[0]).toMatchObject({
        columnSlug: mockColumns[0].columnSlug,
        boardId: 1,
      });
    }, 900_000);
  },
);

describe.skipIf(!process.env.RUN_LLM_IT)(
  "Live-LLM: status-report honesty + on-track behavior",
  { timeout: 900_000 },
  () => {
    const statusTemplate = getTemplate("status-report")!;
    const statusColumns: ColumnInfo[] = statusTemplate.columns.map((c) => ({
      columnId: c.position,
      columnSlug: c.slug,
      systemPrompt: c.system_prompt,
      reasoning: c.reasoning,
      tools: c.tools,
    }));

    const DAY = 24 * 60 * 60 * 1000;
    const NOW = new Date();

    function runStatusReport(cards: CardTimestamps[], intent: string) {
      const captured: { artifact?: string; qaOutput?: string } = {};
      const service = createAgentBoardService({
        getBoard: async () => ({
          id: 1,
          workspaceId: 1,
          userId: 1,
          templateId: "status-report",
          originalIntent: intent,
          status: "approved",
          executionStatus: "running",
        }),
        getColumns: async () => statusColumns,
        executeCard: realExecuteCard,
        fetchCardTimestamps: async () => cards,
        fetchActivityEvents: async () => [],
        insertOutput: async (data) => {
          if (data.columnSlug === statusColumns[1].columnSlug) {
            captured.qaOutput = data.output;
          }
        },
        insertCard: async () => {},
        insertArtifact: async (a) => {
          captured.artifact = a.content;
        },
        updateBoard: async () => {},
        publishEvent: async () => {},
      });
      return { service, captured };
    }

    it("Rule 2.2: on-track report saves an artifact and QA passes", async () => {
      // Rising throughput + falling cycle time over recent weeks.
      const cards: CardTimestamps[] = Array.from({ length: 8 }, (_, i) => ({
        createdAt: new Date(NOW.getTime() - (i + 3) * DAY),
        startedAt: new Date(NOW.getTime() - (i + 2) * DAY),
        doneAt: new Date(NOW.getTime() - (i + 1) * DAY),
      }));
      const { service, captured } = runStatusReport(
        cards,
        "status report for the last 2 weeks",
      );
      await service.runPipeline({ boardId: 1, workspaceId: 1 });

      // Structural outcome: artifact persisted (QA returned PASS).
      expect(captured.artifact).toBeTruthy();
      expect(captured.artifact!.length).toBeGreaterThan(0);
    });

    it("Rule 2.4: no completed cards → honest insufficient-data report, QA passes", async () => {
      // WIP only: started but never done.
      const cards: CardTimestamps[] = [
        {
          createdAt: new Date(NOW.getTime() - 2 * DAY),
          startedAt: new Date(NOW.getTime() - 1 * DAY),
          doneAt: null,
        },
      ];
      const { service, captured } = runStatusReport(
        cards,
        "status report for the last 2 weeks",
      );
      await service.runPipeline({ boardId: 1, workspaceId: 1 });

      // Artifact saved (no-data honesty is a PASS per Rule 2.4).
      expect(captured.artifact).toBeTruthy();
      // States insufficiency rather than inventing flow metrics.
      expect(captured.artifact!).toMatch(
        /insufficient|not yet measurable|no completed/i,
      );
    });

    it("Rule 2.5: avgCycleTimeMs=null → states not-yet-measurable, no cycle-time number", async () => {
      // Done but never started → cycle time is null (lead time exists).
      const cards: CardTimestamps[] = [
        {
          createdAt: new Date(NOW.getTime() - 3 * DAY),
          startedAt: null,
          doneAt: new Date(NOW.getTime() - 1 * DAY),
        },
      ];
      const { service, captured } = runStatusReport(
        cards,
        "status report for the last 2 weeks",
      );
      await service.runPipeline({ boardId: 1, workspaceId: 1 });

      expect(captured.artifact).toBeTruthy();
      const report = captured.artifact!;
      // Honesty phrase present.
      expect(report).toMatch(/cycle time[^.]*not yet measurable/i);
      // MUST NOT fabricate a cycle-time figure: no "cycle time ... <number>"
      // in the same clause. Structural check, not prose equality.
      const cycleClaim = report.match(
        /cycle time[^.]*?(\d[\d.,]*\s*(?:d|h|m|days|hours|ms)\b)/i,
      );
      expect(cycleClaim, cycleClaim?.[0]).toBeNull();
    });
  },
);
