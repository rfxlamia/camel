import { ChevronDown, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { thinkingMarkdownComponents } from "./agentMarkdown";

interface AgentThinkingSectionProps {
	thinking: string;
	isOpen: boolean;
	onToggle: () => void;
}

/** Collapsible live/stored thinking panel for the agent card drawer. */
export default function AgentThinkingSection({
	thinking,
	isOpen,
	onToggle,
}: AgentThinkingSectionProps) {
	return (
		<div>
			<button
				type="button"
				aria-expanded={isOpen}
				onClick={onToggle}
				className="flex w-full items-center gap-1.5 text-left"
			>
				{isOpen ? (
					<ChevronDown
						size={14}
						className="shrink-0 text-neutral-500"
						aria-hidden
					/>
				) : (
					<ChevronRight
						size={14}
						className="shrink-0 text-neutral-500"
						aria-hidden
					/>
				)}
				<span className="text-xs font-medium text-neutral-600">Thinking</span>
			</button>
			{isOpen && (
				<div className="mt-1 rounded-md border border-neutral-200 bg-neutral-100 p-3">
					<div className="text-sm text-neutral-700 leading-relaxed">
						<ReactMarkdown
							remarkPlugins={[remarkGfm]}
							components={thinkingMarkdownComponents}
						>
							{thinking}
						</ReactMarkdown>
					</div>
				</div>
			)}
		</div>
	);
}
