import { Plus } from "lucide-react";
import { useState } from "react";

export function AddColumn({
	onAddColumn,
}: {
	onAddColumn: (title: string) => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState("");

	if (!open) {
		return (
			<button
				onClick={() => setOpen(true)}
				className="flex w-72 shrink-0 items-center gap-1.5 self-start rounded-xl border border-dashed border-neutral-300 px-3 py-2.5 text-left text-sm font-medium text-neutral-500 transition-colors hover:border-primary-300 hover:bg-primary-100/50 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
			>
				<Plus size={16} className="shrink-0" aria-hidden />
				Add column
			</button>
		);
	}

	const submit = async () => {
		if (title.trim() === "") return;
		await onAddColumn(title.trim());
		setTitle("");
		setOpen(false);
	};

	return (
		<div className="w-72 shrink-0 self-start space-y-2 rounded-xl border border-neutral-200 bg-neutral-100 p-3 shadow-sm">
			<input
				autoFocus
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						void submit();
					}
					if (e.key === "Escape") setOpen(false);
				}}
				placeholder="Column title"
				className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none"
			/>
			<div className="flex gap-2">
				<button
					onClick={() => void submit()}
					className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Add column
				</button>
				<button
					onClick={() => setOpen(false)}
					className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
