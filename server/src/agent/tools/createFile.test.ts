import { describe, expect, it, vi } from "vitest";
import { MAX_ARTIFACT_BYTES } from "../artifact.js";
import { makeCreateFile } from "./createFile.js";

function buildCtx(overrides: Record<string, unknown> = {}) {
	const insertArtifact = vi.fn(async () => {});
	const ctx = {
		boardId: 7,
		workspaceId: 3,
		intent: "riset thailand",
		documentContent: "# Title\nBody",
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

	it("falls back to slug(intent) when bound document has no H1", async () => {
		const { ctx, insertArtifact } = buildCtx({
			documentContent: "Body without a heading",
		});
		const tool = makeCreateFile(ctx as never);
		await tool.execute({});

		expect(insertArtifact).toHaveBeenCalledWith(
			expect.objectContaining({ filename: "riset-thailand.md" }),
		);
	});

	it("ignores LLM-supplied content and persists the server-bound document", async () => {
		const { ctx, insertArtifact } = buildCtx({
			documentContent: "# Title\nBody from editor",
		});
		const tool = makeCreateFile(ctx as never);
		await tool.execute({ content: "# Hacker\nEvil body" });

		expect(insertArtifact).toHaveBeenCalledWith(
			expect.objectContaining({ content: "# Title\nBody from editor" }),
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

	it("returns EMPTY_CONTENT when the bound document is blank", async () => {
		const { ctx, insertArtifact } = buildCtx({ documentContent: "   " });
		const tool = makeCreateFile(ctx as never);
		const result = await tool.execute({ content: "# Title\nBody" });

		expect(result).toMatchObject({ ok: false, errorCode: "EMPTY_CONTENT" });
		expect(insertArtifact).not.toHaveBeenCalled();
	});

	it("returns TOO_LARGE and does not persist when bound document exceeds byte cap", async () => {
		const { ctx, insertArtifact } = buildCtx({
			documentContent: `# T\n${"a".repeat(MAX_ARTIFACT_BYTES + 1)}`,
		});
		const tool = makeCreateFile(ctx as never);
		const result = await tool.execute({});

		expect(result).toMatchObject({ ok: false, errorCode: "TOO_LARGE" });
		expect(insertArtifact).not.toHaveBeenCalled();
	});
});
