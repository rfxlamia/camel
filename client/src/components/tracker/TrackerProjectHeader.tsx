import { ArrowLeft, MoreHorizontal, Pencil } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef } from "react";

interface Props {
	projectName: string;
	renaming: boolean;
	nameDraft: string;
	menuOpen: boolean;
	onBack: () => void;
	onStartRename: () => void;
	onCancelRename: () => void;
	onSaveRename: () => void | Promise<void>;
	onNameDraftChange: (value: string) => void;
	onMenuOpenChange: (open: boolean) => void;
	onOpenDelete: () => void;
}

export default function TrackerProjectHeader({
	projectName,
	renaming,
	nameDraft,
	menuOpen,
	onBack,
	onStartRename,
	onCancelRename,
	onSaveRename,
	onNameDraftChange,
	onMenuOpenChange,
	onOpenDelete,
}: Props) {
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!menuOpen) return;
		const handlePointerDown = (e: MouseEvent) => {
			if (
				menuRef.current &&
				!menuRef.current.contains(e.target as Node)
			) {
				onMenuOpenChange(false);
			}
		};
		document.addEventListener("mousedown", handlePointerDown);
		return () => document.removeEventListener("mousedown", handlePointerDown);
	}, [menuOpen, onMenuOpenChange]);

	const handleRenameSubmit = (e: FormEvent) => {
		e.preventDefault();
		if (!nameDraft.trim()) return;
		void onSaveRename();
	};

	const handleRenameKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") onCancelRename();
	};

	return (
		<div className="sticky top-0 z-20 border-neutral-200 border-b bg-white px-4 py-3 md:px-6">
			<div className="flex items-start gap-3">
				<button
					type="button"
					aria-label="Back to Tracker"
					onClick={onBack}
					className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					<ArrowLeft size={16} aria-hidden />
				</button>
				<div className="min-w-0 flex-1">
					{renaming ? (
						<form onSubmit={handleRenameSubmit} className="space-y-2">
							<label className="block">
								<span className="mb-1 block font-medium text-neutral-700 text-sm">
									Project name
								</span>
								<input
									type="text"
									aria-label="Project name"
									value={nameDraft}
									onChange={(e) => onNameDraftChange(e.target.value)}
									onKeyDown={handleRenameKeyDown}
									className="h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-neutral-900 text-sm focus:border-primary-600 focus-visible:outline-none"
								/>
							</label>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={onCancelRename}
									className="rounded-md px-3 py-1.5 text-neutral-600 text-sm hover:bg-neutral-100"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={!nameDraft.trim()}
									className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-60"
								>
									Save
								</button>
							</div>
						</form>
					) : (
						<h1 className="truncate font-medium text-neutral-900 text-sm">
							{projectName}
						</h1>
					)}
				</div>
				{!renaming && (
					<div className="flex shrink-0 items-center gap-1">
						<button
							type="button"
							aria-label="Rename project"
							onClick={onStartRename}
							className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<Pencil size={14} aria-hidden />
						</button>
						<div ref={menuRef} className="relative">
							<button
								type="button"
								aria-label="Project menu"
								aria-haspopup="menu"
								aria-expanded={menuOpen}
								onClick={() => onMenuOpenChange(!menuOpen)}
								className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								<MoreHorizontal size={16} aria-hidden />
							</button>
							{menuOpen && (
								<div
									role="menu"
									className="absolute top-full right-0 z-30 mt-1 min-w-[10rem] rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
								>
									<button
										type="button"
										role="menuitem"
										onClick={() => {
											onMenuOpenChange(false);
											onOpenDelete();
										}}
										className="w-full px-3 py-1.5 text-left text-error-700 text-sm hover:bg-neutral-100"
									>
										Delete project
									</button>
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
