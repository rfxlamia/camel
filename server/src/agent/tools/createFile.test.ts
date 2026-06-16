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
