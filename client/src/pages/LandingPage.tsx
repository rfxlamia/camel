import {
	ArrowRight,
	Check,
	FileText,
	Gauge,
	GitBranch,
	LayoutGrid,
	LineChart,
	Radio,
	Search,
	ShieldCheck,
	Sparkles,
	Users,
	Workflow,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";

// Logged-out marketing page, mounted at "/" by the unauthenticated router in
// App.tsx. Calm-Linear aesthetic per docs/pocket/rule/creative-brief.md:
// Work Sans, primary navy + warm accent, muted chroma, tokens only.

const FEATURES = [
	{
		key: "board",
		icon: LayoutGrid,
		title: "See all your work at glance",
		body: "Drag tasks across clean kanban columns and watch progress move in real time. Set the rules for each column right where your team can see them.",
	},
	{
		key: "wip",
		icon: Gauge,
		title: "Keep your team focused",
		body: "Cap how much work each column can hold, so tasks get finished instead of piling up. Camel stops overload before it starts — nothing slips through.",
	},
	{
		key: "realtime",
		icon: Radio,
		title: "Always in sync",
		body: "See who's online and watch every update appear the moment a teammate makes it. No refreshing, no stepping on each other's changes.",
	},
	{
		key: "flow",
		icon: LineChart,
		title: "Know how fast you ship",
		body: "Track lead time, cycle time, and throughput on a simple 8-week trend — so you can spot bottlenecks early and keep delivery steady.",
	},
	{
		key: "version",
		icon: ShieldCheck,
		title: "Edit together, lose nothing",
		body: "Two people on the same card? Camel keeps every edit safe and shows the latest version automatically. No overwritten work, ever.",
	},
	{
		key: "team",
		icon: Users,
		title: "Made for small teams",
		body: "Invite your team to a shared workspace, assign cards, set due dates, and follow every change in one clear activity feed.",
	},
] as const;

const PIPELINE = ["Research", "Analysis", "Writer", "Editor", "QA Guardian"];

const PRACTICES = [
	"Visualize workflow",
	"Limit work in progress",
	"Manage flow",
	"Make policies explicit",
	"Build feedback loops",
	"Improve continuously",
];

// ── Card preview visuals ────────────────────────────────────────────
// Each feature card opens with a uniform inset "preview pane" holding a
// small, true-to-product diagram (a mini board, a WIP chip, a sparkline).
// Consistent frame keeps the grid calm; distinct content keeps it from
// reading as a generic feature wall. Tokens only, mostly static.

function PaneFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="relative h-28 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
			<div className="board-canvas absolute inset-0 opacity-50" aria-hidden />
			<div className="relative flex h-full items-center justify-center px-4">
				{children}
			</div>
		</div>
	);
}

// Skeleton card line used across several previews.
function MiniCard({ tone = "neutral" }: { tone?: "neutral" | "primary" | "success" }) {
	const bar =
		tone === "primary"
			? "bg-primary-300"
			: tone === "success"
				? "bg-success-200"
				: "bg-neutral-200";
	return (
		<div className="rounded-sm border border-neutral-200 bg-white px-1.5 py-1 shadow-[0_1px_2px_oklch(28%_0.044_250_/_0.06)]">
			<div className={`h-1 w-full rounded-full ${bar}`} />
			<div className="mt-1 h-1 w-3/5 rounded-full bg-neutral-200" />
		</div>
	);
}

function FeaturePreview({ kind }: { kind: (typeof FEATURES)[number]["key"] }) {
	switch (kind) {
		case "board":
			return (
				<PaneFrame>
					<div className="relative grid w-full grid-cols-3 gap-2">
						{[
							{ label: "To do", cards: ["neutral", "neutral"] as const },
							{ label: "Doing", cards: ["primary"] as const },
							{ label: "Done", cards: ["success", "neutral"] as const },
						].map((col) => (
							<div key={col.label} className="space-y-1">
								<div className="mb-1 flex items-center justify-between">
									<span className="text-[8px] font-semibold uppercase tracking-wide text-neutral-500">
										{col.label}
									</span>
									<span className="h-1 w-1 rounded-full bg-neutral-300" />
								</div>
								{col.cards.map((t, i) => (
									<MiniCard key={`${col.label}-${i}`} tone={t} />
								))}
							</div>
						))}
						{/* Card mid-drag — lifted, tilted, casting a soft shadow. */}
						<div className="absolute left-[28%] top-1 w-1/3 rotate-[-5deg] rounded-sm border border-primary-300 bg-white px-1.5 py-1 shadow-[0_8px_16px_-6px_oklch(28%_0.044_250_/_0.5)]">
							<div className="h-1 w-full rounded-full bg-primary-400" />
							<div className="mt-1 h-1 w-2/3 rounded-full bg-neutral-200" />
						</div>
					</div>
				</PaneFrame>
			);
		case "wip":
			return (
				<PaneFrame>
					<div className="w-3/4 space-y-1">
						<div className="flex items-center justify-between">
							<span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-600">
								In progress
							</span>
							<span className="rounded-full bg-primary-700 px-1.5 py-px text-[9px] font-bold tabular-nums text-white">
								3 / 3
							</span>
						</div>
						<MiniCard tone="primary" />
						<MiniCard />
						{/* Rejected drop — dashed ghost with a clean 409. */}
						<div className="flex items-center justify-between rounded-sm border border-dashed border-error-500/70 bg-error-100 px-1.5 py-1">
							<div className="h-1 w-2/5 rounded-full bg-error-500/40" />
							<span className="text-[9px] font-bold tabular-nums text-error-700">
								409
							</span>
						</div>
					</div>
				</PaneFrame>
			);
		case "realtime":
			return (
				<PaneFrame>
					<div className="flex flex-col items-center gap-3">
						<div className="flex -space-x-2">
							{[
								{ bg: "bg-primary-600", t: "AR" },
								{ bg: "bg-accent-600", t: "MK" },
								{ bg: "bg-success-500", t: "JD" },
							].map((a) => (
								<span
									key={a.t}
									className={`inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-neutral-100 text-[8px] font-bold text-white ${a.bg}`}
								>
									{a.t}
								</span>
							))}
							<span className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-neutral-100 bg-white text-[8px] font-bold text-neutral-500">
								+2
							</span>
						</div>
						<span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[9px] font-semibold text-neutral-600">
							<span className="pulse-dot relative inline-flex h-1.5 w-1.5 rounded-full bg-success-500" />
							SSE · live
						</span>
					</div>
				</PaneFrame>
			);
		case "flow":
			return (
				<PaneFrame>
					<div className="flex h-14 w-3/4 items-end justify-between gap-1">
						{[40, 55, 35, 62, 50, 72, 58, 84].map((h, i) => (
							<div
								key={`${h}-${i}`}
								className={`w-full rounded-sm ${i === 7 ? "bg-accent-500" : "bg-primary-300"}`}
								style={{ height: `${h}%` }}
							/>
						))}
					</div>
				</PaneFrame>
			);
		case "version":
			return (
				<PaneFrame>
					<div className="relative w-3/5">
						<div className="absolute -right-3 -top-3 w-full rotate-3 rounded-md border border-neutral-200 bg-white/70 p-2 shadow-sm" />
						<div className="relative rounded-md border border-neutral-200 bg-white p-2 shadow-[0_4px_12px_-4px_oklch(28%_0.044_250_/_0.25)]">
							<div className="flex items-center justify-between">
								<div className="h-1.5 w-1/2 rounded-full bg-neutral-200" />
								<span className="rounded bg-primary-100 px-1.5 py-px text-[9px] font-bold tabular-nums text-primary-800">
									v.7
								</span>
							</div>
							<div className="mt-2 inline-flex items-center gap-1 rounded bg-success-100 px-1.5 py-px text-[9px] font-semibold text-success-900">
								<Check className="h-2.5 w-2.5" /> 409 → refreshed
							</div>
						</div>
					</div>
				</PaneFrame>
			);
		case "team":
			return (
				<PaneFrame>
					<div className="w-3/4 rounded-md border border-neutral-200 bg-white p-2 shadow-sm">
						<div className="h-1.5 w-3/5 rounded-full bg-neutral-200" />
						<div className="mt-2.5 flex items-center justify-between">
							<div className="flex -space-x-1.5">
								{["bg-primary-500", "bg-accent-500", "bg-success-500"].map(
									(bg) => (
										<span
											key={bg}
											className={`h-4 w-4 rounded-full border-2 border-white ${bg}`}
										/>
									),
								)}
							</div>
							<span className="rounded bg-accent-100 px-1.5 py-px text-[9px] font-semibold text-accent-800">
								Due Fri
							</span>
						</div>
					</div>
				</PaneFrame>
			);
	}
}

export default function LandingPage() {
	const navigate = useNavigate();
	const rootRef = useRef<HTMLDivElement>(null);

	// Reveal-on-scroll. Under reduced motion, show everything immediately.
	useEffect(() => {
		const els = rootRef.current?.querySelectorAll<HTMLElement>(".reveal");
		if (!els?.length) return;
		const reduced = window.matchMedia?.(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (reduced || typeof IntersectionObserver === "undefined") {
			for (const el of els) el.classList.add("is-visible");
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						e.target.classList.add("is-visible");
						io.unobserve(e.target);
					}
				}
			},
			{ threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
		);
		for (const el of els) io.observe(el);
		return () => io.disconnect();
	}, []);

	return (
		<div ref={rootRef} className="min-h-screen bg-neutral-100 text-neutral-900">
			{/* ── Nav ───────────────────────────────────────────────── */}
			<header className="sticky top-0 z-30 border-b border-neutral-200 bg-neutral-100/80 backdrop-blur-md">
				<nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
					<a href="#top" className="flex items-center gap-2">
						<img src="/logo.png" alt="" className="h-7 w-7" />
						<span className="text-md font-bold tracking-tight text-primary-900">
							Camel
						</span>
					</a>
					<div className="hidden items-center gap-7 text-sm font-medium text-neutral-600 md:flex">
						<a href="#features" className="hover:text-primary-700">
							Features
						</a>
						<a href="#agent" className="hover:text-primary-700">
							Agentic
						</a>
						<a href="#practices" className="hover:text-primary-700">
							Practices
						</a>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => navigate("/login")}
							className="rounded-md px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Sign in
						</button>
						<button
							type="button"
							onClick={() => navigate("/signup")}
							className="rounded-md bg-primary-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Get started
						</button>
					</div>
				</nav>
			</header>

			{/* ── Hero ──────────────────────────────────────────────── */}
			<section id="top" className="landing-aura relative overflow-hidden">
				<div className="board-canvas absolute inset-0 opacity-60" aria-hidden />
				<div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 md:grid-cols-2 md:py-28">
					<div>
						<span
							className="reveal inline-flex items-center gap-2 rounded-full border border-accent-300 bg-accent-100 px-3 py-1 text-sm font-medium text-accent-800"
							style={{ transitionDelay: "0ms" }}
						>
							<Sparkles className="h-3.5 w-3.5" />
							Kanban with an agentic mind
						</span>
						<h1
							className="reveal mt-5 text-3xl font-bold leading-[1.1] tracking-tight text-primary-900"
							style={{ transitionDelay: "80ms" }}
						>
							Move the work forward,{" "}
							<span className="text-accent-700">calmly.</span>
						</h1>
						<p
							className="reveal mt-5 max-w-md text-md leading-relaxed text-neutral-600"
							style={{ transitionDelay: "160ms" }}
						>
							Camel is a kanban board for small dev teams — work-in-progress
							limits that keep everyone focused, live delivery metrics,
							real-time collaboration, and built-in AI that work on repetitive tasks, so you don&apos;t have to.
						</p>
						<div
							className="reveal mt-8 flex flex-wrap items-center gap-3"
							style={{ transitionDelay: "240ms" }}
						>
							<button
								type="button"
								onClick={() => navigate("/signup")}
								className="group inline-flex items-center gap-2 rounded-md bg-primary-600 px-5 py-2.5 text-base font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								Create your board
								<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
							</button>
							<button
								type="button"
								onClick={() => navigate("/login")}
								className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-neutral-100 px-5 py-2.5 text-base font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								Sign in
							</button>
						</div>
						<p
							className="reveal mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-neutral-500"
							style={{ transitionDelay: "320ms" }}
						>
							<span className="inline-flex items-center gap-1.5">
								<GitBranch className="h-3.5 w-3.5" /> GitHub-friendly
							</span>
							<span className="inline-flex items-center gap-1.5">
								<Check className="h-3.5 w-3.5" /> Real-time
							</span>
							<span className="inline-flex items-center gap-1.5">
								<Check className="h-3.5 w-3.5" /> Free to self-host
							</span>
						</p>
					</div>

					{/* Mascot — the calm camel, sipping while the work flows. */}
					<div
						className="reveal relative mx-auto w-full max-w-sm"
						style={{ transitionDelay: "200ms" }}
					>
						<div className="float-soft relative">
							<div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_24px_60px_-24px_oklch(28%_0.044_250_/_0.45)]">
								<img
									src="/camel-mascot-real.webp"
									alt="The Camel mascot, calmly sipping tea"
									className="block aspect-square w-full object-cover"
								/>
							</div>
							{/* Floating mini board card — top left */}
							<div className="absolute -left-6 top-8 hidden w-40 rotate-[-4deg] rounded-lg border border-neutral-200 bg-white p-3 shadow-lg sm:block">
								<div className="flex items-center justify-between">
									<span className="rounded bg-success-100 px-1.5 py-0.5 text-xs font-medium text-success-900">
										Done
									</span>
									<span className="text-xs text-neutral-400">#142</span>
								</div>
								<p className="mt-2 text-sm font-medium text-neutral-800">
									Ship flow metrics
								</p>
							</div>
							{/* Floating WIP chip — bottom right */}
							<div className="absolute -right-5 bottom-10 hidden rotate-[5deg] rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-lg sm:block">
								<p className="text-xs font-medium text-neutral-500">
									WIP limit
								</p>
								<p className="text-md font-bold text-primary-700">3 / 3</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* ── Features (bento) ──────────────────────────────────── */}
			<section id="features" className="mx-auto max-w-6xl px-5 py-20">
				<div className="reveal max-w-2xl">
					<h2 className="text-xl font-bold tracking-tight text-primary-900">
						Everything a small team needs to stay in flow
					</h2>
					<p className="mt-3 text-base text-neutral-600">
						Six proven kanban practices, built right into the board — plus
						real-time collaboration and AI that handles the busywork for you.
					</p>
				</div>

				<div className="mt-10 grid gap-4 md:grid-cols-3">
					{/* Wide spotlight card: the agentic pipeline */}
					<article
						className="reveal group relative col-span-1 flex flex-col overflow-hidden rounded-xl border border-primary-700 bg-primary-900 p-7 text-neutral-100 md:col-span-2"
						id="agent"
					>
						<div
							className="board-canvas absolute inset-0 opacity-10"
							aria-hidden
						/>
						<div className="relative">
							<span className="inline-flex items-center gap-2 rounded-full bg-accent-600/90 px-3 py-1 text-sm font-medium text-white">
								<Sparkles className="h-3.5 w-3.5" /> Agentic Kanban
							</span>
							<h3 className="mt-4 text-lg font-bold text-white">
								Let AI do the thing for you
							</h3>
							<p className="mt-2 max-w-lg text-base text-primary-200">
								Describe what you need and Camel puts a team of AI agents to
								work on your board — researching the facts, pulling out the
								insights, and writing a polished, fact-checked document, step by
								step.
							</p>
						</div>

						{/* Pipeline rendered as connected mini board columns. */}
						<div className="relative mt-6 grid grid-cols-5 gap-2">
							{PIPELINE.map((stage, i) => (
								<div key={stage} className="relative">
									<div className="rounded-md border border-primary-700 bg-primary-800/80 p-2">
										<div className="mb-1.5 flex items-center justify-between">
											<span className="text-[10px] font-semibold uppercase tracking-wide text-primary-300">
												{`0${i + 1}`}
											</span>
											{i === 0 && (
												<span className="pulse-dot relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-400" />
											)}
										</div>
										<div className="text-[11px] font-semibold leading-tight text-primary-100">
											{stage}
										</div>
										<div className="mt-2 space-y-1">
											<div className="h-1 w-full rounded-full bg-primary-700" />
											<div className="h-1 w-2/3 rounded-full bg-primary-700" />
										</div>
									</div>
									{i < PIPELINE.length - 1 && (
										<ArrowRight className="absolute -right-[7px] top-1/2 z-10 h-3 w-3 -translate-y-1/2 text-primary-500" />
									)}
								</div>
							))}
						</div>

						<div className="relative mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm text-primary-300">
							<span className="inline-flex items-center gap-1.5">
								<Search className="h-3.5 w-3.5" /> Live web research
							</span>
							<span className="inline-flex items-center gap-1.5">
								<FileText className="h-3.5 w-3.5" /> Real documents, drafted
							</span>
							<span className="inline-flex items-center gap-1.5">
								<Workflow className="h-3.5 w-3.5" /> Reasons it through
							</span>
						</div>
					</article>

					{/* Tall accent card: live flow metrics */}
					<article className="reveal flex flex-col rounded-xl border border-accent-300 bg-accent-100 p-7">
						<div className="flex items-center gap-2">
							<span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-accent-200 text-accent-700">
								<LineChart className="h-5 w-5" />
							</span>
							<span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-700">
								<span className="pulse-dot relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-600" />
								Recomputed live
							</span>
						</div>

						{/* Metric readouts — fills the card body, no dead zone. */}
						<dl className="mt-6 space-y-2.5">
							{[
								{ k: "Lead time", v: "2.4d", w: "62%" },
								{ k: "Cycle time", v: "1.1d", w: "38%" },
								{ k: "Throughput", v: "9 / wk", w: "80%" },
							].map((m) => (
								<div key={m.k} className="flex items-center gap-3">
									<dt className="w-20 shrink-0 text-sm text-accent-800/80">
										{m.k}
									</dt>
									<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent-200">
										<div
											className="h-full rounded-full bg-accent-600"
											style={{ width: m.w }}
										/>
									</div>
									<dd className="w-12 shrink-0 text-right text-sm font-bold tabular-nums text-accent-900">
										{m.v}
									</dd>
								</div>
							))}
						</dl>

						<div className="mt-auto pt-6">
							<h3 className="text-md font-bold text-accent-900">
								Decisions backed by data
							</h3>
							<p className="mt-1.5 text-base leading-relaxed text-accent-800/80">
								See lead time, cycle time, and throughput update live with every
								move — so you lead with facts, not guesswork.
							</p>
						</div>
					</article>

					{/* Standard feature cards — each opens with a product preview. */}
					{FEATURES.map((f) => (
						<article
							key={f.title}
							className="reveal group/card flex flex-col rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-primary-300 hover:shadow-[0_12px_28px_-12px_oklch(28%_0.044_250_/_0.35)]"
						>
							<FeaturePreview kind={f.key} />
							<div className="mt-5 flex items-center gap-2.5">
								<span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary-100 text-primary-700 transition-colors group-hover/card:bg-primary-600 group-hover/card:text-white">
									<f.icon className="h-4 w-4" />
								</span>
								<h3 className="text-md font-bold text-neutral-900">{f.title}</h3>
							</div>
							<p className="mt-2.5 text-base leading-relaxed text-neutral-600">
								{f.body}
							</p>
						</article>
					))}
				</div>
			</section>

			{/* ── Practices ─────────────────────────────────────────── */}
			<section id="practices" className="border-y border-neutral-200 bg-white">
				<div className="mx-auto max-w-6xl px-5 py-20">
					<div className="reveal max-w-2xl">
						<h2 className="text-xl font-bold tracking-tight text-primary-900">
							The six kanban practices, by design
						</h2>
						<p className="mt-3 text-base text-neutral-600">
							Not a label on a tool — each practice is wired into how Camel
							behaves.
						</p>
					</div>
					<div className="reveal mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{PRACTICES.map((p) => (
							<div
								key={p}
								className="flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-100 px-4 py-3"
							>
								<span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-100 text-success-900">
									<Check className="h-3.5 w-3.5" />
								</span>
								<span className="text-base font-medium text-neutral-800">
									{p}
								</span>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* ── Final CTA ─────────────────────────────────────────── */}
			<section className="landing-aura relative overflow-hidden">
				<div className="board-canvas absolute inset-0 opacity-50" aria-hidden />
				<div className="reveal relative mx-auto max-w-3xl px-5 py-24 text-center">
					<img
						src="/logo.png"
						alt=""
						className="mx-auto h-14 w-14 drop-shadow-sm"
					/>
					<h2 className="mt-6 text-2xl font-bold tracking-tight text-primary-900">
						Bring a little calm to your board
					</h2>
					<p className="mx-auto mt-4 max-w-md text-md text-neutral-600">
						Create a workspace, connect your team, and let the camel carry the
						load. Steady pace, all the way across.
					</p>
					<div className="mt-8 flex flex-wrap justify-center gap-3">
						<button
							type="button"
							onClick={() => navigate("/signup")}
							className="group inline-flex items-center gap-2 rounded-md bg-primary-600 px-6 py-3 text-base font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Get started — it&apos;s free
							<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
						</button>
						<button
							type="button"
							onClick={() => navigate("/login")}
							className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-neutral-100 px-6 py-3 text-base font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Sign in
						</button>
					</div>
				</div>
			</section>

			{/* ── Footer ────────────────────────────────────────────── */}
			<footer className="border-t border-neutral-200 bg-neutral-100">
				<div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-neutral-500 sm:flex-row">
					<div className="flex items-center gap-2">
						<img src="/logo.png" alt="" className="h-5 w-5" />
						<span className="font-semibold text-neutral-700">Camel Kanban</span>
						<span className="text-neutral-400">· for small dev teams</span>
					</div>
					<p>Visualize · limit WIP · manage flow · improve.</p>
				</div>
			</footer>
		</div>
	);
}
