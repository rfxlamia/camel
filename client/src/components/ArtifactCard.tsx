import { Download, FileText, X } from "lucide-react";
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
		<h1 className="text-xl font-bold text-neutral-900 mt-8 mb-3 first:mt-0 leading-tight">
			{children}
		</h1>
	),
	h2: ({ children }: { children?: React.ReactNode }) => (
		<h2 className="text-lg font-semibold text-neutral-900 mt-7 mb-2.5 first:mt-0 leading-snug">
			{children}
		</h2>
	),
	h3: ({ children }: { children?: React.ReactNode }) => (
		<h3 className="text-md font-semibold text-neutral-900 mt-6 mb-2 first:mt-0 leading-snug">
			{children}
		</h3>
	),
	h4: ({ children }: { children?: React.ReactNode }) => (
		<h4 className="text-base font-semibold text-neutral-800 mt-5 mb-1.5 first:mt-0 leading-normal">
			{children}
		</h4>
	),
	p: ({ children }: { children?: React.ReactNode }) => (
		<p className="text-base text-neutral-800 leading-relaxed mb-3 last:mb-0">
			{children}
		</p>
	),
	ul: ({ children }: { children?: React.ReactNode }) => (
		<ul className="list-disc pl-6 mb-3 space-y-1.5 text-base text-neutral-800">
			{children}
		</ul>
	),
	ol: ({ children }: { children?: React.ReactNode }) => (
		<ol className="list-decimal pl-6 mb-3 space-y-1.5 text-base text-neutral-800">
			{children}
		</ol>
	),
	li: ({ children }: { children?: React.ReactNode }) => (
		<li className="text-base text-neutral-800 leading-relaxed">{children}</li>
	),
	strong: ({ children }: { children?: React.ReactNode }) => (
		<strong className="font-semibold text-neutral-900">{children}</strong>
	),
	em: ({ children }: { children?: React.ReactNode }) => (
		<em className="italic text-neutral-600">{children}</em>
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
				<pre className="rounded-md bg-neutral-100 border border-neutral-200 p-4 mb-3 overflow-x-auto">
					<code className="text-sm font-mono text-neutral-800">{children}</code>
				</pre>
			);
		}
		return (
			<code className="rounded bg-neutral-100 px-1.5 py-0.5 text-sm font-mono text-neutral-800 border border-neutral-200">
				{children}
			</code>
		);
	},
	blockquote: ({ children }: { children?: React.ReactNode }) => (
		<blockquote className="border-l-[3px] border-primary-300 bg-primary-100/40 pl-4 py-2.5 mb-3 text-base text-neutral-700 rounded-r-md">
			{children}
		</blockquote>
	),
	hr: () => <hr className="my-6 border-neutral-200" />,
	table: ({ children }: { children?: React.ReactNode }) => (
		<div className="overflow-x-auto mb-4 rounded-md border border-neutral-200">
			<table className="w-full text-sm">{children}</table>
		</div>
	),
	thead: ({ children }: { children?: React.ReactNode }) => (
		<thead className="bg-neutral-100">{children}</thead>
	),
	tbody: ({ children }: { children?: React.ReactNode }) => (
		<tbody className="divide-y divide-neutral-200">{children}</tbody>
	),
	tr: ({ children }: { children?: React.ReactNode }) => (
		<tr className="border-b border-neutral-200 last:border-0">{children}</tr>
	),
	th: ({ children }: { children?: React.ReactNode }) => (
		<th className="px-3 py-2.5 text-left font-semibold text-neutral-700 text-xs uppercase tracking-wider">
			{children}
		</th>
	),
	td: ({ children }: { children?: React.ReactNode }) => (
		<td className="px-3 py-2.5 text-neutral-800">{children}</td>
	),
};

export default function ArtifactCard({
	artifact,
	downloadUrl,
}: ArtifactCardProps) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="flex w-full items-start gap-3 p-3.5 text-left cursor-pointer hover:bg-primary-100/30 hover:border-primary-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 rounded-t-lg"
				>
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-100">
						<FileText size={18} className="text-primary-600" aria-hidden />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium text-neutral-900 truncate">
							{artifact.filename}
						</p>
						<p className="text-xs text-neutral-500 mt-0.5">Document · MD</p>
					</div>
				</button>
				<div className="border-t border-neutral-200 px-3.5 py-2.5">
					<a
						href={downloadUrl}
						className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<Download size={14} aria-hidden />
						Download
					</a>
				</div>
			</div>

			{open && (
				<div
					className="fixed inset-0 z-50 flex flex-col bg-white"
					role="dialog"
					aria-modal="true"
				>
					<div className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
						<p className="text-sm font-medium text-neutral-600 truncate">
							{artifact.filename}
						</p>
						<button
							type="button"
							onClick={() => setOpen(false)}
							aria-label="Close document"
							className="rounded-md p-1.5 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<X size={18} aria-hidden />
						</button>
					</div>
					<div className="flex-1 overflow-y-auto">
						<div className="max-w-3xl mx-auto px-6 py-8 md:px-8 md:py-10">
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								components={markdownComponents}
							>
								{artifact.content}
							</ReactMarkdown>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
