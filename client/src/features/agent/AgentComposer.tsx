import { ArrowUp } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";

const EXAMPLE_PROMPTS = [
	"Competitive landscape for EV scooters in Southeast Asia",
	"Summarize recent research on GLP-1 drugs and their side effects",
	"Market entry analysis for a fintech app launching in Brazil",
];

interface AgentComposerProps {
	input: string;
	setInput: Dispatch<SetStateAction<string>>;
	onSend: () => void;
	inputDisabled: boolean;
	sendDisabled: boolean;
	error: string | null;
	onResetError: () => void;
}

/**
 * Empty-state hero for the Agent page. A single focused composer — the intent
 * input lives where the user's eyes land, not in a separate side panel. Reuses
 * the same chat input/send pipeline (createBoard fires when no board exists).
 */
export default function AgentComposer({
	input,
	setInput,
	onSend,
	inputDisabled,
	sendDisabled,
	error,
	onResetError,
}: AgentComposerProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Focus the composer on mount — it's the single focal input on the page.
	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			if (!sendDisabled) onSend();
		}
	};

	const applyExample = (prompt: string) => {
		setInput(prompt);
		// Defer focus so the value is committed before the caret lands at the end.
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(prompt.length, prompt.length);
		});
	};

	return (
		<div className="relative flex min-h-full items-center justify-center overflow-hidden px-6 py-16">
			{/* Atmosphere — calm radial wash + faint dot grid, within brand chroma */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0"
				style={{
					backgroundImage:
						"radial-gradient(60% 50% at 50% 0%, oklch(97% 0.02 250) 0%, transparent 70%)",
				}}
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 opacity-[0.5]"
				style={{
					backgroundImage:
						"radial-gradient(oklch(84% 0.007 250) 1px, transparent 1px)",
					backgroundSize: "22px 22px",
					maskImage:
						"radial-gradient(70% 55% at 50% 30%, black 0%, transparent 75%)",
					WebkitMaskImage:
						"radial-gradient(70% 55% at 50% 30%, black 0%, transparent 75%)",
				}}
			/>

			<div className="relative w-full max-w-2xl">
				<div className="animate-rise-in [animation-delay:40ms] flex flex-col items-center text-center">
					<h1 className="text-balance text-2xl font-semibold tracking-tight text-neutral-900">
						What should the agent look into?
					</h1>
					<p className="mt-3 max-w-md text-pretty text-base leading-relaxed text-neutral-600">
						Describe a topic to research or analyze. Camel drafts a board of
						specialist columns you can review before anything runs.
					</p>
				</div>

				{/* Composer */}
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (!sendDisabled) onSend();
					}}
					className="animate-rise-in [animation-delay:120ms] mt-8"
				>
					<div className="rounded-xl border border-neutral-300 bg-white p-2 shadow-sm transition-shadow focus-within:border-primary-600 focus-within:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)]">
						<textarea
							ref={textareaRef}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							disabled={inputDisabled}
							rows={3}
							aria-label="Describe what the agent should research"
							placeholder="Research the competitive landscape for EV scooters in Southeast Asia…"
							className="block w-full resize-none bg-transparent px-3 pt-2 text-base text-neutral-900 placeholder:text-neutral-400 focus:outline-none disabled:text-neutral-400"
						/>
						<div className="flex items-center justify-between gap-3 px-1 pt-1">
							<span className="hidden text-xs text-neutral-400 sm:block">
								<kbd className="rounded border border-neutral-200 bg-neutral-100 px-1 py-px font-sans">
									Enter
								</kbd>{" "}
								to generate ·{" "}
								<kbd className="rounded border border-neutral-200 bg-neutral-100 px-1 py-px font-sans">
									Shift + Enter
								</kbd>{" "}
								for a new line
							</span>
							<button
								type="submit"
								disabled={sendDisabled}
								className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								Generate board
								<ArrowUp size={15} aria-hidden />
							</button>
						</div>
					</div>
				</form>

				{/* Error */}
				{error && (
					<div className="animate-fade-in mt-4 flex items-start justify-between gap-3 rounded-lg border border-error-500/30 bg-error-100 px-3.5 py-2.5">
						<p className="text-sm text-error-900">{error}</p>
						<button
							type="button"
							onClick={onResetError}
							className="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-error-900 shadow-sm hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Try again
						</button>
					</div>
				)}

				{/* Example prompts */}
				<div className="animate-rise-in [animation-delay:200ms] mt-6 flex flex-wrap items-center justify-center gap-2">
					<span className="text-xs font-medium text-neutral-400">Try one:</span>
					{EXAMPLE_PROMPTS.map((prompt) => (
						<button
							key={prompt}
							type="button"
							onClick={() => applyExample(prompt)}
							disabled={inputDisabled}
							className="max-w-full truncate rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 transition-colors hover:border-primary-300 hover:bg-primary-100/40 hover:text-primary-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							{prompt}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
