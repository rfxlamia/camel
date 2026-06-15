import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
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
	},
);
