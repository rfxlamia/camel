import {
	COLOR_LABELS,
	COLOR_PREVIEWS,
	COLUMN_STYLES,
} from "../lib/columnColors";
import type { TemplateColumn, WorkspaceTemplate } from "../lib/templates";
import LoadingCamel from "./LoadingCamel";
import SuccessAnimation from "./SuccessAnimation";

type TemplatePickerProps = {
	templates: WorkspaceTemplate[];
	state: "idle" | "loading" | "success";
	onApply: (template: WorkspaceTemplate) => void;
	onStartBlank: () => void;
};

function ColumnPreview({ column }: { column: TemplateColumn }) {
	return (
		<div
			className={`rounded-md border px-2 py-1.5 ${COLUMN_STYLES[column.color]}`}
		>
			<div className="flex items-center gap-1.5">
				<span
					className="h-2.5 w-2.5 shrink-0 rounded-full border border-neutral-300/60"
					style={{ backgroundColor: COLOR_PREVIEWS[column.color] }}
					title={COLOR_LABELS[column.color]}
					aria-hidden
				/>
				<span className="text-xs font-medium text-neutral-900">
					{column.title}
				</span>
				{column.wipLimit != null && (
					<span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-neutral-600">
						WIP {column.wipLimit}
					</span>
				)}
				{column.isDone && (
					<span className="rounded-full bg-success-100 px-1.5 py-0.5 text-[10px] font-semibold text-success-900">
						Done
					</span>
				)}
			</div>
			<p className="mt-1 text-[10px] leading-snug text-neutral-600">
				{column.policy}
			</p>
		</div>
	);
}

function TemplateCard({
	template,
	disabled,
	onApply,
}: {
	template: WorkspaceTemplate;
	disabled: boolean;
	onApply: (template: WorkspaceTemplate) => void;
}) {
	return (
		<article className="flex w-64 shrink-0 flex-col rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
			<h3 className="text-base font-semibold text-neutral-900">
				{template.name}
			</h3>
			<p className="mt-0.5 text-sm text-neutral-600">{template.tagline}</p>
			<div className="mt-3 flex flex-col gap-1.5">
				{template.columns.map((column) => (
					<ColumnPreview key={column.title} column={column} />
				))}
			</div>
			<button
				type="button"
				disabled={disabled}
				onClick={() => onApply(template)}
				className="mt-4 w-full rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none"
			>
				Use this template
			</button>
		</article>
	);
}

export default function TemplatePicker({
	templates,
	state,
	onApply,
	onStartBlank,
}: TemplatePickerProps) {
	const applyDisabled = state === "loading";

	if (state === "loading") {
		return (
			<div className="flex flex-col items-center justify-center gap-3 py-12">
				<LoadingCamel size={88} />
				<p className="text-sm text-neutral-600">Building your board…</p>
			</div>
		);
	}

	if (state === "success") {
		return (
			<div className="flex flex-col items-center justify-center gap-3 py-12">
				<SuccessAnimation size={88} />
				<p className="max-w-md text-center text-sm text-neutral-600">
					Your board is ready — edit any column anytime to fit your workflow.
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex gap-4 overflow-x-auto pb-2">
				{templates.map((template) => (
					<TemplateCard
						key={template.id}
						template={template}
						disabled={applyDisabled}
						onApply={onApply}
					/>
				))}
			</div>
			<div className="flex justify-center">
				<button
					type="button"
					onClick={onStartBlank}
					className="rounded-md px-4 py-2 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Start blank instead
				</button>
			</div>
		</div>
	);
}
