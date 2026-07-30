import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatAttachment, ToolTraceItem } from "../../types";
import { ToolTrace } from "../ToolTrace";
import { ChatAttachment as ChatAttachmentLink } from "./ChatAttachment";
import { ChatErrorBubble } from "./ChatErrorBubble";

const chatMarkdownComponents = {
	h1: ({ children }: { children?: React.ReactNode }) => (
		<h1 className="text-base font-semibold text-neutral-900 mt-2 mb-1 first:mt-0">
			{children}
		</h1>
	),
	h2: ({ children }: { children?: React.ReactNode }) => (
		<h2 className="text-sm font-semibold text-neutral-900 mt-2 mb-1 first:mt-0">
			{children}
		</h2>
	),
	h3: ({ children }: { children?: React.ReactNode }) => (
		<h3 className="text-sm font-semibold text-neutral-800 mt-1.5 mb-0.5 first:mt-0">
			{children}
		</h3>
	),
	p: ({ children }: { children?: React.ReactNode }) => (
		<p className="text-sm text-neutral-800 leading-relaxed mb-1 last:mb-0">
			{children}
		</p>
	),
	ul: ({ children }: { children?: React.ReactNode }) => (
		<ul className="list-disc pl-4 mb-1 space-y-0.5 text-sm text-neutral-800">
			{children}
		</ul>
	),
	ol: ({ children }: { children?: React.ReactNode }) => (
		<ol className="list-decimal pl-4 mb-1 space-y-0.5 text-sm text-neutral-800">
			{children}
		</ol>
	),
	li: ({ children }: { children?: React.ReactNode }) => (
		<li className="text-sm text-neutral-800 leading-relaxed">{children}</li>
	),
	strong: ({ children }: { children?: React.ReactNode }) => (
		<strong className="font-semibold text-neutral-900">{children}</strong>
	),
	em: ({ children }: { children?: React.ReactNode }) => (
		<em className="italic text-neutral-600">{children}</em>
	),
	a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="text-primary-600 hover:text-primary-700 underline underline-offset-2"
		>
			{children}
		</a>
	),
	code: ({
		children,
		className,
	}: {
		children?: React.ReactNode;
		className?: string;
	}) => {
		const isBlock = className?.includes("language-");
		if (isBlock) {
			return (
				<pre className="rounded-md bg-neutral-100 border border-neutral-200 p-2 mb-1 overflow-x-auto">
					<code className="text-xs font-mono text-neutral-800">{children}</code>
				</pre>
			);
		}
		return (
			<code className="rounded bg-neutral-100 px-1 py-0.5 text-xs font-mono text-neutral-800">
				{children}
			</code>
		);
	},
	blockquote: ({ children }: { children?: React.ReactNode }) => (
		<blockquote className="border-l-2 border-primary-300 pl-2.5 py-0.5 mb-1 text-sm text-neutral-600 italic">
			{children}
		</blockquote>
	),
};

export interface ChatMessageProps {
	role: "user" | "assistant" | "error";
	content: string;
	thinking: string | null;
	toolTrace: ToolTraceItem[];
	attachments: ChatAttachment[];
	onRetry?: () => void;
	canRetry?: boolean;
}

export function ChatMessage({
	role,
	content,
	thinking,
	toolTrace,
	attachments,
	onRetry,
	canRetry = true,
}: ChatMessageProps) {
	const [isThinkingOpen, setIsThinkingOpen] = useState(Boolean(thinking));

	if (role === "error") {
		return (
			<ChatErrorBubble
				message={content}
				canRetry={canRetry}
				onRetry={onRetry}
			/>
		);
	}

	const isUser = role === "user";

	return (
		<div
			className={`flex ${isUser ? "justify-end" : "justify-start"}`}
			data-role={role}
		>
			<div
				className={`max-w-[85%] space-y-2 rounded-lg px-4 py-3 ${
					isUser
						? "bg-primary-600 text-white"
						: "border border-neutral-200 bg-neutral-50 text-neutral-900"
				}`}
			>
				{thinking && (
					<div>
						<button
							type="button"
							onClick={() => setIsThinkingOpen((open) => !open)}
							className="flex w-full items-center gap-1.5 text-left"
						>
							{isThinkingOpen ? (
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
							<span className="text-xs font-medium text-neutral-600">
								Thinking
							</span>
						</button>
						{isThinkingOpen && (
							<p className="mt-1 text-sm italic text-neutral-600">{thinking}</p>
						)}
					</div>
				)}

				{toolTrace.length > 0 && <ToolTrace steps={toolTrace} />}

				<div className={isUser ? "text-sm text-white" : undefined}>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={
							isUser
								? {
										p: ({ children }) => (
											<p className="text-sm leading-relaxed">{children}</p>
										),
									}
								: chatMarkdownComponents
						}
					>
						{content.replace(/\\n/g, "\n")}
					</ReactMarkdown>
				</div>

				{attachments.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{attachments.map((attachment) => (
							<ChatAttachmentLink
								key={attachment.id}
								attachment={attachment}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
