import { X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { WorkspaceMember } from "../types";

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface Props {
	members: WorkspaceMember[];
	value: number[];
	onChange: (ids: number[]) => void;
}

export function AssigneePicker({ members, value, onChange }: Props) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const rootRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listboxId = useId();

	const memberById = useMemo(
		() => new Map(members.map((m) => [m.userId, m])),
		[members],
	);

	const selected = value
		.map((id) => memberById.get(id))
		.filter((m): m is WorkspaceMember => m !== undefined);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		const pool = members.filter((m) => !value.includes(m.userId));
		if (!q) return pool;
		return pool.filter(
			(m) =>
				m.displayName.toLowerCase().includes(q) ||
				m.username.toLowerCase().includes(q),
		);
	}, [members, value, query]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: MouseEvent) => {
			if (rootRef.current?.contains(e.target as Node)) return;
			setOpen(false);
			setQuery("");
		};
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [open]);

	const addMember = (userId: number) => {
		if (value.includes(userId)) return;
		onChange([...value, userId]);
		setQuery("");
		inputRef.current?.focus();
	};

	const removeMember = (userId: number) => {
		onChange(value.filter((id) => id !== userId));
	};

	if (members.length === 0) {
		return <p className="mt-1 text-sm text-neutral-500">No members</p>;
	}

	return (
		<div ref={rootRef} className="relative mt-1">
			<div
				className={`flex min-h-10 flex-wrap items-center gap-1 rounded-md border bg-white px-2 py-1.5 transition-[border-color,box-shadow] ${
					open
						? "border-primary-600 shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)]"
						: "border-neutral-300 hover:border-neutral-400"
				}`}
				onClick={() => {
					setOpen(true);
					inputRef.current?.focus();
				}}
			>
				{selected.map((m) => (
					<span
						key={m.userId}
						className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-100 py-0.5 pr-1 pl-0.5 text-sm text-primary-800"
					>
						<span
							className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-200 text-[10px] font-semibold"
							aria-hidden
						>
							{initials(m.displayName)}
						</span>
						<span className="max-w-24 truncate">{m.displayName}</span>
						<button
							type="button"
							className="rounded-full p-0.5 text-primary-600 hover:bg-primary-200 hover:text-primary-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600"
							aria-label={`Remove ${m.displayName}`}
							onClick={(e) => {
								e.stopPropagation();
								removeMember(m.userId);
							}}
						>
							<X size={12} strokeWidth={2.5} aria-hidden />
						</button>
					</span>
				))}
				<input
					ref={inputRef}
					type="text"
					value={query}
					role="combobox"
					aria-expanded={open}
					aria-controls={listboxId}
					aria-autocomplete="list"
					placeholder={selected.length === 0 ? "Search members…" : "Add…"}
					className="min-w-16 flex-1 border-0 bg-transparent py-1 text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none"
					onChange={(e) => {
						setQuery(e.target.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							setOpen(false);
							setQuery("");
							inputRef.current?.blur();
						}
						if (e.key === "Backspace" && query === "" && value.length > 0) {
							removeMember(value[value.length - 1]);
						}
					}}
				/>
			</div>

			{open && (
				<div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg">
					<ul
						id={listboxId}
						role="listbox"
						aria-label="Workspace members"
						className="max-h-48 overflow-y-auto overscroll-contain py-1"
					>
						{filtered.length === 0 ? (
							<li className="px-3 py-2 text-sm text-neutral-500">
								{query.trim() ? "No matching members" : "Everyone is assigned"}
							</li>
						) : (
							filtered.map((m) => (
								<li key={m.userId} role="presentation">
									<button
										type="button"
										role="option"
										className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-neutral-900 hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none"
										onClick={() => addMember(m.userId)}
									>
										<span
											className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-semibold text-neutral-700"
											aria-hidden
										>
											{initials(m.displayName)}
										</span>
										<span className="min-w-0 flex-1 truncate font-medium">
											{m.displayName}
										</span>
										<span className="shrink-0 text-xs text-neutral-500">
											@{m.username}
										</span>
									</button>
								</li>
							))
						)}
					</ul>
				</div>
			)}
		</div>
	);
}
