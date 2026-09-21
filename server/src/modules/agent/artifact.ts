export const MAX_ARTIFACT_BYTES = 1_000_000;

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 80)
		.replace(/^-+|-+$/g, "");
}

export function deriveFilename(content: string, intent: string): string {
	const h1Match = content.match(/^# (.+)$/m);
	let slug: string;
	if (h1Match) {
		slug = slugify(h1Match[1]);
		if (!slug && intent.trim()) {
			slug = slugify(intent);
		}
	} else if (intent.trim()) {
		slug = slugify(intent);
	} else {
		slug = "deliverable";
	}
	return `${slug || "deliverable"}.md`;
}

function stripTrailingFooter(text: string): string {
	const footerMatch = text.match(/\n---\n\*Handoff:[\s\S]*$/);
	if (footerMatch?.index !== undefined) {
		return text.slice(0, footerMatch.index);
	}
	const hrMatch = text.match(/\n---\s*$/);
	if (hrMatch?.index !== undefined) {
		return text.slice(0, hrMatch.index);
	}
	return text;
}

export function extractRevisedDocument(editorOutput: string): string {
	if (!editorOutput) {
		return editorOutput;
	}

	let body: string;

	const revisedMatch = editorOutput.match(/^## Revised Document\s*$/m);
	if (revisedMatch?.index !== undefined) {
		const afterHeading = editorOutput.indexOf("\n", revisedMatch.index);
		body = afterHeading === -1 ? "" : editorOutput.slice(afterHeading + 1);
	} else if (/^## Editorial Notes\s*$/m.test(editorOutput)) {
		const hrMatch = editorOutput.match(/\n---\s*\n/);
		body =
			hrMatch?.index !== undefined
				? editorOutput.slice(hrMatch.index + hrMatch[0].length)
				: editorOutput;
	} else {
		body = editorOutput;
	}

	body = stripTrailingFooter(body).trim();

	if (editorOutput.trim().length > 0 && body.length === 0) {
		return editorOutput.trim();
	}

	return body;
}

const PASS_STATUS_LINE = /^\s*\**status\**:?\**\s*pass\s*$/i;
const NEEDS_REVISION_STATUS_LINE =
	/^\s*\**status\**:?\**\s*needs[\s-]+revision\s*$/i;

export function parseQaVerdict(
	qaOutput: string,
): "pass" | "needs_revision" | "unknown" {
	for (const line of qaOutput.split("\n")) {
		if (PASS_STATUS_LINE.test(line)) {
			return "pass";
		}
		if (NEEDS_REVISION_STATUS_LINE.test(line)) {
			return "needs_revision";
		}
	}
	return "unknown";
}
