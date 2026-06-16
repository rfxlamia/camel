import { FileText, X } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentArtifact } from "../types";

interface ArtifactCardProps {
	artifact: AgentArtifact;
	downloadUrl: string;
}

const markdownComponents = {
	h1: ({ children }: { children?: React.ReactNode }) => (
		<h1 className="text-xl font-semibold text-neutral-900 mt-4 mb-2 first:mt-0">
			{children}
		</h1>
	),
	h2: ({ children }: { children?: React.ReactNode }) => (
		<h2 className="text-lg font-semibold text-neutral-900 mt-4 mb-2 first:mt-0">
			{children}
		</h2>
	),
	h3: ({ children }: { children?: React.ReactNode }) => (
		<h3 className="text-base font-semibold text-neutral-900 mt-3 mb-1.5 first:mt-0">
			{children}
		</h3>
	),
	p: ({ children }: { children?: React.ReactNode }) => (
		<p className="text-sm text-neutral-800 leading-relaxed mb-2 last:mb-0">
			{children}
		</p>
	),
	ul: ({ children }: { children?: React.ReactNode }) => (
		<ul className="list-disc pl-5 mb-2 space-y-1 text-sm text-neutral-800">
			{children}
		</ul>
	),
	ol: ({ children }: { children?: React.ReactNode }) => (
		<ol className="list-decimal pl-5 mb-2 space-y-1 text-sm text-neutral-800">
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
		<em className="italic text-neutral-700">{children}</em>
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
				<pre className="rounded-md bg-neutral-200/60 border border-neutral-200 p-2.5 mb-2 overflow-x-auto">
					<code className="text-xs font-mono text-neutral-700">{children}</code>
				</pre>
			);
		}
		return (
			<code className="rounded bg-neutral-200/60 px-1 py-0.5 text-xs font-mono text-neutral-700">
				{children}
			</code>
		);
	},
	blockquote: ({ children }: { children?: React.ReactNode }) => (
		<blockquote className="border-l-2 border-neutral-300 pl-3 py-1 mb-2 text-sm text-neutral-600 italic">
			{children}
		</blockquote>
	),
	hr: () => <hr className="my-3 border-neutral-300" />,
};

export default function ArtifactCard({
	artifact,
	downloadUrl,
}: ArtifactCardProps) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<div className="rounded-md border border-neutral-200 bg-neutral-100 p-3">
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="flex w-full items-start gap-3 text-left"
				>
					<FileText
						size={20}
						className="shrink-0 text-neutral-600"
						aria-hidden
					/>
					<div className="min-w-0 flex-1">
						<p className="text-base text-neutral-800">{artifact.filename}</p>
						<p className="text-sm text-neutral-500">Document · MD</p>
					</div>
				</button>
				<a
					href={downloadUrl}
					className="mt-2 inline-flex rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Download
				</a>
			</div>

			{open && (
				<div
					className="fixed inset-0 z-50 flex flex-col bg-white"
					role="dialog"
					aria-modal="true"
				>
					<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
						<p className="text-base font-medium text-neutral-800 truncate">
							{artifact.filename}
						</p>
						<button
							type="button"
							onClick={() => setOpen(false)}
							aria-label="Close document"
							className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<X size={20} aria-hidden />
						</button>
					</div>
					<div className="flex-1 overflow-y-auto p-6">
						<ReactMarkdown
							remarkPlugins={[remarkGfm]}
							components={markdownComponents}
						>
							{artifact.content}
						</ReactMarkdown>
					</div>
				</div>
			)}
		</>
	);
}
