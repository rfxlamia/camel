import {
	AlertCircle,
	ChevronDown,
	ChevronRight,
	MessageSquare,
	Search,
} from "lucide-react";
import { useState } from "react";
import type { ToolTraceItem } from "../types";

interface ToolTraceProps {
	steps: ToolTraceItem[];
}

export function ToolTrace({ steps }: ToolTraceProps) {
	const [expanded, setExpanded] = useState(false);

	const toolSteps = steps.filter((s) => s.toolName !== "_reasoning");
	const reasoningSteps = steps.filter((s) => s.toolName === "_reasoning");

	if (toolSteps.length === 0 && reasoningSteps.length === 0) return null;

	// Summary: first tool step's toolName · query · resultCount
	const first = toolSteps[0] ?? reasoningSteps[0];
	const summaryParts: string[] = [];
	if (first.toolName === "_reasoning") {
		summaryParts.push("reasoning");
		if (first.reasoningText) {
			const preview =
				first.reasoningText.length > 48
					? `${first.reasoningText.slice(0, 48)}…`
					: first.reasoningText;
			summaryParts.push(preview);
		}
	} else {
		summaryParts.push(first.toolName);
		if (first.query) summaryParts.push(first.query);
		if (first.resultCount !== undefined)
			summaryParts.push(`${first.resultCount} results`);
		else if (first.toolName === "create_file" && first.query)
			summaryParts.push("saved");
	}
	const summary = summaryParts.join(" · ");

	const hasError = toolSteps.some((s) => s.errorCode);

	return (
		<div className="rounded-md border border-neutral-200 bg-neutral-100">
			<button
				type="button"
				role="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-200 rounded-md"
			>
				{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				<Search size={14} className="text-primary-600" />
				<span className="font-medium">{summary}</span>
				{hasError && (
					<span className="ml-auto rounded bg-error-100 px-1.5 py-0.5 text-xs font-medium text-error-700">
						error
					</span>
				)}
			</button>
			{expanded && (
				<div
					data-testid="tool-trace-detail"
					className="border-t border-neutral-200 px-3 py-2 space-y-2"
				>
					{reasoningSteps.map((step, i) => (
						<div key={`r-${i}`} className="flex items-start gap-2 text-sm">
							<MessageSquare size={14} className="mt-0.5 text-neutral-500" />
							<p className="text-neutral-700 italic">{step.reasoningText}</p>
						</div>
					))}
					{toolSteps.map((step, i) => (
						<div key={i} className="flex items-start gap-2 text-sm">
							{step.errorCode ? (
								<AlertCircle size={14} className="mt-0.5 text-error-600" />
							) : (
								<Search size={14} className="mt-0.5 text-primary-600" />
							)}
							<div>
								<span className="font-medium text-neutral-900">
									{step.toolName}
								</span>
								{step.query && (
									<span className="text-neutral-600"> · {step.query}</span>
								)}
								{step.resultCount !== undefined && (
									<span className="text-neutral-600">
										{" "}
										· {step.resultCount} results
									</span>
								)}
								{step.resultCount === undefined &&
									step.toolName === "create_file" &&
									step.query?.startsWith("saved ") && (
										<span className="text-neutral-600"> · {step.query}</span>
									)}
								{step.errorCode && (
									<span className="ml-2 rounded bg-error-100 px-1.5 py-0.5 text-xs font-medium text-error-700">
										{step.errorCode}
									</span>
								)}
								{step.createdAt && (
									<span className="text-neutral-500 text-xs ml-2">
										{step.createdAt}
									</span>
								)}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
