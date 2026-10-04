import type { Components } from "react-markdown";

// ReactMarkdown element styling for the agent card drawer, split out of
// AgentCardDetail.tsx (300-on-touch).

export const thinkingMarkdownComponents: Components = {
	h1: ({ children }) => (
		<h1 className="text-lg font-semibold text-neutral-800 mt-3 mb-1.5 first:mt-0">
			{children}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="text-base font-semibold text-neutral-800 mt-3 mb-1.5 first:mt-0">
			{children}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="text-sm font-semibold text-neutral-800 mt-2 mb-1 first:mt-0">
			{children}
		</h3>
	),
	p: ({ children }) => (
		<p className="text-sm text-neutral-700 leading-relaxed mb-1.5 last:mb-0">
			{children}
		</p>
	),
	ul: ({ children }) => (
		<ul className="list-disc pl-5 mb-1.5 space-y-0.5 text-sm text-neutral-700">
			{children}
		</ul>
	),
	ol: ({ children }) => (
		<ol className="list-decimal pl-5 mb-1.5 space-y-0.5 text-sm text-neutral-700">
			{children}
		</ol>
	),
	li: ({ children }) => (
		<li className="text-sm text-neutral-700 leading-relaxed">{children}</li>
	),
	strong: ({ children }) => (
		<strong className="font-semibold text-neutral-800">{children}</strong>
	),
	em: ({ children }) => <em className="italic text-neutral-600">{children}</em>,
	code: ({ children, className }) => {
		const isBlock = className?.includes("language-");
		if (isBlock) {
			return (
				<pre className="rounded-md bg-neutral-200/60 border border-neutral-200 p-2.5 mb-1.5 overflow-x-auto">
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
	blockquote: ({ children }) => (
		<blockquote className="border-l-2 border-neutral-300 pl-3 py-1 mb-1.5 text-sm text-neutral-600 italic">
			{children}
		</blockquote>
	),
	hr: () => <hr className="my-2 border-neutral-300" />,
};

export const outputMarkdownComponents: Components = {
	h1: ({ children }) => (
		<h1 className="text-xl font-semibold text-neutral-900 mt-4 mb-2 first:mt-0">
			{children}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="text-lg font-semibold text-neutral-900 mt-4 mb-2 first:mt-0">
			{children}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="text-base font-semibold text-neutral-900 mt-3 mb-1.5 first:mt-0">
			{children}
		</h3>
	),
	p: ({ children }) => (
		<p className="text-sm text-neutral-800 leading-relaxed mb-2 last:mb-0">
			{children}
		</p>
	),
	ul: ({ children }) => (
		<ul className="list-disc pl-5 mb-2 space-y-1 text-sm text-neutral-800">
			{children}
		</ul>
	),
	ol: ({ children }) => (
		<ol className="list-decimal pl-5 mb-2 space-y-1 text-sm text-neutral-800">
			{children}
		</ol>
	),
	li: ({ children }) => (
		<li className="text-sm text-neutral-800 leading-relaxed">{children}</li>
	),
	strong: ({ children }) => (
		<strong className="font-semibold text-neutral-900">{children}</strong>
	),
	em: ({ children }) => <em className="italic text-neutral-700">{children}</em>,
	a: ({ href, children }) => (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="text-primary-600 hover:text-primary-700 underline underline-offset-2"
		>
			{children}
		</a>
	),
	hr: () => <hr className="my-3 border-neutral-200" />,
	code: ({ children, className }) => {
		const isBlock = className?.includes("language-");
		if (isBlock) {
			return (
				<pre className="rounded-md bg-neutral-100 border border-neutral-200 p-3 mb-2 overflow-x-auto">
					<code className="text-xs font-mono text-neutral-800">{children}</code>
				</pre>
			);
		}
		return (
			<code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-mono text-neutral-800">
				{children}
			</code>
		);
	},
	blockquote: ({ children }) => (
		<blockquote className="border-l-2 border-primary-300 pl-3 py-1 mb-2 text-sm text-neutral-600 italic">
			{children}
		</blockquote>
	),
	table: ({ children }) => (
		<div className="overflow-x-auto mb-2">
			<table className="w-full text-sm border-collapse">{children}</table>
		</div>
	),
	th: ({ children }) => (
		<th className="border-b border-neutral-200 px-3 py-1.5 text-left text-xs font-semibold text-neutral-700">
			{children}
		</th>
	),
	td: ({ children }) => (
		<td className="border-b border-neutral-200 px-3 py-1.5 text-sm text-neutral-800">
			{children}
		</td>
	),
};
