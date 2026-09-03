import {
	forwardRef,
	useCallback,
	useEffect,
	useId,
	useImperativeHandle,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import type {
	TaskMetadataAction,
	TaskMetadataDraft,
} from "./taskMetadataDraft";
import {
	isPickerUnavailable,
	TaskFieldCommandPopover,
	type TaskFieldCatalogState,
	type TaskFieldCommandOption,
} from "./TaskFieldCommandPopover";

export const TASK_TITLE_MAX_LENGTH = 255;

export interface TaskFieldCommandDefinition {
	id: string;
	label: string;
	multiple?: boolean;
	catalogState?: TaskFieldCatalogState;
	options: TaskFieldCommandOption[];
	onRetry?: () => void;
	mapOptionToValue: (optionId: string) => unknown;
	buildSelectAction: (value: unknown) => TaskMetadataAction;
	buildRemoveAction: () => TaskMetadataAction;
	getSelectedOptionIds: (draft: TaskMetadataDraft) => string[];
}

export interface TaskSubmitCandidate {
	valid: boolean;
	title: string;
	titleRequired?: boolean;
	titleTooLong?: boolean;
}

export interface TaskTitleEditorHandle {
	getSubmitCandidate: () => TaskSubmitCandidate;
}

interface TaskTitleEditorProps {
	fields: TaskFieldCommandDefinition[];
	draft: TaskMetadataDraft;
	dispatch: (action: TaskMetadataAction) => void;
	placeholder?: string;
	titleMaxLength?: number;
}

type CommandStage = "field" | "value" | null;

interface CommandState {
	open: boolean;
	stage: CommandStage;
	fieldId: string | null;
	query: string;
	activeIndex: number;
	commandStart: number;
	editingFieldId: string | null;
}

const initialCommandState = (): CommandState => ({
	open: false,
	stage: null,
	fieldId: null,
	query: "",
	activeIndex: 0,
	commandStart: -1,
	editingFieldId: null,
});

function isEmailLikeAt(text: string, atIndex: number): boolean {
	const after = text.slice(atIndex + 1);
	if (!after) return false;
	const before = text[atIndex - 1];
	return Boolean(before && /\S/.test(before) && /\S/.test(after.split(/\s/)[0] ?? ""));
}

function findCommandAt(text: string): { start: number; query: string } | null {
	const atIndex = text.lastIndexOf("@");
	if (atIndex < 0 || isEmailLikeAt(text, atIndex)) return null;
	const query = text.slice(atIndex + 1);
	if (/\s/.test(query)) return null;
	return { start: atIndex, query };
}

function isValidCommandTrigger(text: string, atIndex: number): boolean {
	if (isEmailLikeAt(text, atIndex)) return false;
	if (atIndex === 0) return true;
	const before = text[atIndex - 1];
	if (before === " " || before === "\t") return true;
	return atIndex === text.length - 1;
}

function filterByQuery<T extends { label: string }>(items: T[], query: string) {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return items;
	return items.filter((item) => item.label.toLowerCase().includes(normalized));
}

export const TaskTitleEditor = forwardRef<
	TaskTitleEditorHandle,
	TaskTitleEditorProps
>(function TaskTitleEditor(
	{
		fields,
		draft,
		dispatch,
		placeholder = "Task title",
		titleMaxLength = TASK_TITLE_MAX_LENGTH,
	},
	ref,
) {
	const [title, setTitle] = useState("");
	const [command, setCommand] = useState<CommandState>(initialCommandState);
	const [selectedChipId, setSelectedChipId] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const [isComposing, setIsComposing] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const shellRef = useRef<HTMLDivElement>(null);
	const restoreCaretRef = useRef<number | null>(null);
	const suppressCommandRef = useRef(false);
	const listboxId = useId();

	const availableFields = fields.filter((field) => field.catalogState !== "disabled");

	const getField = useCallback(
		(fieldId: string | null) => fields.find((field) => field.id === fieldId),
		[fields],
	);

	const plainTitle = useCallback(
		(fullTitle: string, commandStart: number) => {
			if (commandStart < 0) return fullTitle;
			return fullTitle.slice(0, commandStart).replace(/\s+$/, "");
		},
		[],
	);

	const restoreFocus = useCallback((caret: number) => {
		restoreCaretRef.current = caret;
		requestAnimationFrame(() => {
			const textarea = textareaRef.current;
			if (!textarea) return;
			textarea.focus();
			const position = restoreCaretRef.current ?? textarea.value.length;
			textarea.setSelectionRange(position, position);
		});
	}, []);

	const closeCommand = useCallback(
		(caret?: number) => {
			const position =
				caret ??
				(command.commandStart >= 0
					? plainTitle(title, command.commandStart).length
					: title.length);
			setCommand(initialCommandState());
			restoreFocus(position);
		},
		[command.commandStart, plainTitle, restoreFocus, title],
	);

	const announce = useCallback((message: string) => {
		setAnnouncement(message);
	}, []);

	const openCommandAt = useCallback(
		(_fullTitle: string, start: number, query: string, stage: CommandStage = "field", fieldId: string | null = null) => {
			const filtered =
				stage === "field"
					? filterByQuery(availableFields, query)
					: filterByQuery(getField(fieldId)?.options ?? [], query);
			setCommand({
				open: true,
				stage,
				fieldId,
				query,
				activeIndex: 0,
				commandStart: start,
				editingFieldId: null,
			});
			if (filtered.length === 0 && stage === "field") {
				setCommand((current) => ({ ...current, activeIndex: 0 }));
			}
		},
		[availableFields, getField],
	);

	const syncCommandFromTitle = useCallback(
		(nextTitle: string) => {
			const match = findCommandAt(nextTitle);
			if (!match) {
				if (command.open && !command.editingFieldId) {
					setCommand(initialCommandState());
				}
				return;
			}
			if (command.editingFieldId) return;
			const filtered = filterByQuery(availableFields, match.query);
			setCommand((current) => ({
				open: true,
				stage: current.stage === "value" ? "value" : "field",
				fieldId: current.stage === "value" ? current.fieldId : null,
				query: match.query,
				activeIndex: Math.min(current.activeIndex, Math.max(filtered.length - 1, 0)),
				commandStart: match.start,
				editingFieldId: null,
			}));
		},
		[availableFields, command.editingFieldId, command.open],
	);

	useEffect(() => {
		if (!command.open) return;
		const onPointerDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (shellRef.current?.contains(target)) return;
			closeCommand(command.commandStart >= 0 ? plainTitle(title, command.commandStart).length : title.length);
		};
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [closeCommand, command.commandStart, command.open, plainTitle, title]);

	const activeField = getField(command.fieldId);
	const fieldOptions = filterByQuery(availableFields, command.stage === "field" ? command.query : "");
	const valueOptions =
		command.stage === "value" && activeField
			? filterByQuery(activeField.options, command.query)
			: [];
	const visibleOptions = command.stage === "field" ? fieldOptions : valueOptions;
	const activeOption = visibleOptions[command.activeIndex];
	const catalogState =
		command.stage === "field"
			? "ready"
			: activeField?.catalogState ?? "ready";
	const pickerUnavailable = isPickerUnavailable(
		catalogState,
		command.stage === "value" ? activeField?.options ?? [] : fieldOptions,
	);

	const activeDescendant =
		activeOption && command.open
			? `${listboxId}-${activeOption.id}`
			: undefined;

	function focusAdjacentControl(
		current: HTMLElement,
		backwards: boolean,
	) {
		const root = shellRef.current?.closest("form") ?? document.body;
		const focusables = Array.from(
			root.querySelectorAll<HTMLElement>(
				'button:not([disabled]):not([tabindex="-1"]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
			),
		);
		const index = focusables.indexOf(current);
		if (index < 0) return;
		const next = focusables[index + (backwards ? -1 : 1)];
		next?.focus();
	}

	const chips = fields.flatMap((field) => {
		const selectedIds = field.getSelectedOptionIds(draft);
		return selectedIds.flatMap((optionId) => {
			const option = field.options.find((candidate) => candidate.id === optionId);
			if (!option) return [];
			const chipId = `${field.id}:${optionId}`;
			return [
				{
					chipId,
					field,
					option,
					label: `${field.label}: ${option.label}`,
				},
			];
		});
	});

	const removeChip = (field: TaskFieldCommandDefinition, optionLabel: string) => {
		dispatch(field.buildRemoveAction());
		announce(`${field.label} ${optionLabel} removed`);
		setSelectedChipId(null);
	};

	const selectValue = (field: TaskFieldCommandDefinition, option: TaskFieldCommandOption) => {
		const value = field.mapOptionToValue(option.id);
		dispatch(field.buildSelectAction(value));
		announce(`${field.label} ${option.label} added`);
		const nextPlainTitle = plainTitle(title, command.commandStart);
		setTitle(nextPlainTitle);
		if (field.multiple) {
			setCommand((current) => ({
				...current,
				open: true,
				stage: "value",
				fieldId: field.id,
				query: "",
				activeIndex: current.activeIndex,
				commandStart: nextPlainTitle.length,
			}));
			restoreFocus(nextPlainTitle.length);
			return;
		}
		closeCommand(nextPlainTitle.length);
	};

	const enterFieldStage = (field: TaskFieldCommandDefinition) => {
		if (isPickerUnavailable(field.catalogState, field.options)) {
			setCommand((current) => ({
				...current,
				open: true,
				stage: "value",
				fieldId: field.id,
				query: "",
				activeIndex: 0,
			}));
			return;
		}
		const nextPlainTitle = plainTitle(title, command.commandStart);
		const nextTitle = `${nextPlainTitle}@`;
		setTitle(nextTitle);
		setCommand({
			open: true,
			stage: "value",
			fieldId: field.id,
			query: "",
			activeIndex: 0,
			commandStart: nextPlainTitle.length,
			editingFieldId: null,
		});
	};

	const openChipEditor = (field: TaskFieldCommandDefinition) => {
		setSelectedChipId(null);
		setCommand({
			open: true,
			stage: "value",
			fieldId: field.id,
			query: "",
			activeIndex: Math.max(
				0,
				filterByQuery(field.options, "").findIndex((option) =>
					field.getSelectedOptionIds(draft).includes(option.id),
				),
			),
			commandStart: title.length,
			editingFieldId: field.id,
		});
	};

	const handleTitleChange = (nextTitle: string) => {
		setTitle(nextTitle);
		setSelectedChipId(null);
		if (suppressCommandRef.current) {
			suppressCommandRef.current = false;
			setCommand(initialCommandState());
			return;
		}
		if (isComposing || command.editingFieldId) return;
		const match = findCommandAt(nextTitle);
		if (!match) {
			if (command.open) setCommand(initialCommandState());
			return;
		}
		syncCommandFromTitle(nextTitle);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (isComposing || event.nativeEvent.isComposing) return;

		if (event.key === "Tab") {
			if (command.open) {
				const nextPlain = plainTitle(title, command.commandStart);
				setTitle(nextPlain);
				setCommand(initialCommandState());
			}
			setSelectedChipId(null);
			return;
		}

		if (event.key === "@" && !command.open) {
			const textarea = textareaRef.current;
			if (!textarea) return;
			const atIndex = textarea.selectionStart;
			const nextTitle =
				title.slice(0, atIndex) +
				"@" +
				title.slice(textarea.selectionEnd);
			if (!isEmailLikeAt(nextTitle, atIndex) && isValidCommandTrigger(nextTitle, atIndex)) {
					event.preventDefault();
					setTitle(nextTitle);
					openCommandAt(nextTitle, atIndex, "");
				}
			return;
		}

		if (event.key === "Escape") {
			if (command.open) {
				event.preventDefault();
				closeCommand(
					command.commandStart >= 0
						? plainTitle(title, command.commandStart).length
						: title.length,
				);
			} else if (selectedChipId) {
				setSelectedChipId(null);
			}
			return;
		}

		if (event.key === "Backspace" && !command.open) {
			const textarea = textareaRef.current;
			if (!textarea) return;
			const atEnd = textarea.selectionStart === textarea.selectionEnd && textarea.selectionEnd === title.length;
			if (atEnd && chips.length > 0) {
				const lastChip = chips[chips.length - 1];
				if (selectedChipId === lastChip.chipId) {
					event.preventDefault();
					removeChip(lastChip.field, lastChip.option.label);
					return;
				}
				if (title.length === 0 || textarea.selectionStart === title.length) {
					event.preventDefault();
					setSelectedChipId(lastChip.chipId);
					return;
				}
			}
		}

		if (!command.open) return;

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			if (visibleOptions.length === 0) return;
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			setCommand((current) => ({
				...current,
				activeIndex:
					(current.activeIndex + step + visibleOptions.length) %
					visibleOptions.length,
			}));
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();

			if (command.stage === "field") {
				const field = fieldOptions[command.activeIndex] ?? fieldOptions[0];
				if (!field) return;
				enterFieldStage(field);
				return;
			}

			if (pickerUnavailable) return;

			if (command.stage === "value" && activeField) {
				if (!activeOption) {
					if (activeField.multiple && command.query === "") {
						closeCommand(plainTitle(title, command.commandStart).length);
					}
					return;
				}
				const selected = activeField.getSelectedOptionIds(draft);
				if (
					activeField.multiple &&
					command.query === "" &&
					selected.includes(activeOption.id)
				) {
					const nextUnselected = valueOptions.find(
						(option) => !selected.includes(option.id),
					);
					if (nextUnselected) {
						selectValue(activeField, nextUnselected);
						return;
					}
					closeCommand(plainTitle(title, command.commandStart).length);
					return;
				}
				selectValue(activeField, activeOption);
				return;
			}
		}
	};

	useImperativeHandle(ref, () => ({
		getSubmitCandidate: () => {
			const currentPlain = plainTitle(title, command.commandStart);
			const trimmed = currentPlain.trim();
			if (trimmed === "") {
				return {
					valid: false,
					title: currentPlain,
					titleRequired: chips.length > 0 || currentPlain.length > 0,
				};
			}
			if (trimmed.length > titleMaxLength) {
				return { valid: false, title: trimmed, titleTooLong: true };
			}
			return { valid: true, title: trimmed };
		},
	}));

	const listLabel = command.stage === "field" ? "Task fields" : `${activeField?.label ?? "Value"} options`;
	const selectedIds =
		command.stage === "value" && activeField
			? activeField.getSelectedOptionIds(draft)
			: [];

	return (
		<div ref={shellRef} className="relative flex flex-wrap items-start gap-1">
			<textarea
				ref={textareaRef}
				value={title}
				placeholder={placeholder}
				aria-label="Task title"
				role="combobox"
				aria-expanded={command.open}
				aria-controls={command.open ? listboxId : undefined}
				aria-activedescendant={activeDescendant}
				aria-autocomplete="list"
				onChange={(event) => handleTitleChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Tab" && event.shiftKey) {
						handleKeyDown(event);
						focusAdjacentControl(event.currentTarget, true);
						return;
					}
					handleKeyDown(event);
				}}
				onCompositionStart={() => setIsComposing(true)}
				onCompositionEnd={() => {
			setIsComposing(false);
			suppressCommandRef.current = true;
		}}
				className="min-h-8 min-w-[8rem] flex-1 resize-none border-0 bg-transparent p-0 text-neutral-900 text-sm focus:outline-none"
			/>
			{chips.map(({ chipId, field, option, label }) => (
				<span key={chipId} className="inline-flex items-center gap-1">
					<button
						type="button"
						data-selected={selectedChipId === chipId ? "true" : "false"}
						aria-label={label}
						onClick={() => openChipEditor(field)}
						onKeyDown={(event) => {
							if (event.key !== "Tab") return;
							event.preventDefault();
							focusAdjacentControl(event.currentTarget, event.shiftKey);
						}}
						className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
							selectedChipId === chipId
								? "border-primary-600 bg-primary-50"
								: "border-neutral-200 bg-neutral-100"
						}`}
					>
						{label}
					</button>
					<button
						type="button"
						aria-label={`Remove ${label}`}
						tabIndex={-1}
						onClick={() => removeChip(field, option.label)}
						className="text-neutral-500 text-xs hover:text-neutral-800"
					>
						×
					</button>
				</span>
			))}
			{command.open ? (
				<TaskFieldCommandPopover
					stage={command.stage ?? "field"}
					listLabel={listLabel}
					options={visibleOptions}
					activeIndex={command.activeIndex}
					selectedIds={selectedIds}
					multiple={activeField?.multiple}
					catalogState={command.stage === "value" ? catalogState : "ready"}
					onRetry={activeField?.onRetry}
					listboxId={listboxId}
				/>
			) : null}
			<div aria-live="polite" className="sr-only">
				{announcement}
			</div>
			{(() => {
				const candidate = (() => {
					const currentPlain = plainTitle(title, command.commandStart);
					if (currentPlain.trim() === "" && chips.length > 0) return true;
					return false;
				})();
				return candidate ? (
					<p className="w-full text-red-600 text-xs">Title is required.</p>
				) : null;
			})()}
		</div>
	);
});
