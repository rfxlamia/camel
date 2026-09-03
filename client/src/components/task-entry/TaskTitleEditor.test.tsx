// client/src/components/task-entry/TaskTitleEditor.test.tsx — jsdom.
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { useReducer } from "react";
import {
	createInitialTaskMetadataDraft,
	taskMetadataReducer,
	type TaskMetadataAction,
	type TaskMetadataDraft,
} from "./taskMetadataDraft";
import {
	TaskTitleEditor,
	type TaskFieldCommandDefinition,
	type TaskTitleEditorHandle,
} from "./TaskTitleEditor";

function boardFields(
	overrides: Partial<TaskFieldCommandDefinition>[] = [],
): TaskFieldCommandDefinition[] {
	const base: TaskFieldCommandDefinition[] = [
		{
			id: "assigneeIds",
			label: "Assignee",
			multiple: true,
			catalogState: "ready",
			options: [
				{ id: "1", label: "Rafi" },
				{ id: "2", label: "Maya" },
			],
			mapOptionToValue: (id) => Number(id),
			buildSelectAction: (value) => ({ type: "toggleAssignee", id: value as number }),
			buildRemoveAction: () => ({ type: "removeField", field: "assigneeIds" }),
			getSelectedOptionIds: (draft) =>
				draft.assigneeIds.map((id) => String(id)),
		},
		{
			id: "priorityId",
			label: "Priority",
			catalogState: "ready",
			options: [
				{ id: "10", label: "High" },
				{ id: "11", label: "Low" },
			],
			mapOptionToValue: (id) => Number(id),
			buildSelectAction: (value) => ({
				type: "setField",
				field: "priorityId",
				value: value as number,
			}),
			buildRemoveAction: () => ({ type: "removeField", field: "priorityId" }),
			getSelectedOptionIds: (draft) =>
				draft.priorityId === null ? [] : [String(draft.priorityId)],
		},
	];
	return base.map((field, index) => ({ ...field, ...overrides[index] }));
}

function EditorHarness({
	fields = boardFields(),
	initialDraft,
	onSubmit,
	editorRef,
}: {
	fields?: TaskFieldCommandDefinition[];
	initialDraft?: Partial<TaskMetadataDraft>;
	onSubmit?: (title: string) => void;
	editorRef?: React.RefObject<TaskTitleEditorHandle | null>;
}) {
	const [draft, dispatch] = useReducer(
		taskMetadataReducer,
		createInitialTaskMetadataDraft(initialDraft ?? {}),
	);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				const candidate = editorRef?.current?.getSubmitCandidate();
				if (candidate?.valid && onSubmit) onSubmit(candidate.title);
			}}
		>
			<TaskTitleEditor
				ref={editorRef}
				fields={fields}
				draft={draft}
				dispatch={(action: TaskMetadataAction) => dispatch(action)}
			/>
			<button type="submit">Create</button>
		</form>
	);
}

function getTitleTextarea() {
	return screen.getByRole("combobox", { name: "Task title" }) as HTMLTextAreaElement;
}

function getActiveOption() {
	return document.querySelector('[role="option"][aria-selected="true"]');
}

describe("TaskTitleEditor", () => {
	afterEach(() => cleanup());

	it("Open the field menu", () => {
		render(<EditorHarness />);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Fix login " } });
		fireEvent.keyDown(textarea, { key: "@" });

		const listbox = screen.getByRole("listbox", { name: "Task fields" });
		expect(listbox).toBeTruthy();
		const active = getActiveOption();
		expect(active).toBeTruthy();
		expect(active?.textContent).toContain("Assignee");
	});

	it("Do not trigger inside an email-like word", () => {
		render(<EditorHarness />);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Notify foo@bar.com" } });
		fireEvent.keyDown(textarea, { key: "m" });

		expect(screen.queryByRole("listbox", { name: "Task fields" })).toBeNull();
	});

	it("Abandon a partial command", () => {
		render(<EditorHarness />);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Fix login @pri" } });

		fireEvent.keyDown(textarea, { key: "Escape" });
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(textarea.value).toBe("Fix login @pri");

		fireEvent.change(textarea, { target: { value: "Fix login @pri" } });
		fireEvent.mouseDown(document.body);
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(textarea.value).toBe("Fix login @pri");
	});

	it("Ignore IME composition keystrokes", () => {
		const onSubmit = vi.fn();
		const editorRef = { current: null as TaskTitleEditorHandle | null };
		render(
			<EditorHarness onSubmit={onSubmit} editorRef={editorRef} />,
		);
		const textarea = getTitleTextarea();

		fireEvent.compositionStart(textarea);
		fireEvent.keyDown(textarea, { key: "@", isComposing: true });
		fireEvent.change(textarea, { target: { value: "@" } });
		expect(screen.queryByRole("listbox")).toBeNull();

		fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
		fireEvent.compositionEnd(textarea, { data: "@" });
		fireEvent.change(textarea, { target: { value: "@" } });

		expect(screen.queryByRole("listbox")).toBeNull();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("Select an assignee with the keyboard", async () => {
		render(<EditorHarness />);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Fix login" } });
		fireEvent.keyDown(textarea, { key: "@" });

		fireEvent.keyDown(textarea, { key: "Enter" });
		fireEvent.change(textarea, { target: { value: "Fix login @raf" } });
		fireEvent.keyDown(textarea, { key: "ArrowDown" });
		fireEvent.keyDown(textarea, { key: "Enter" });

		expect(screen.getByText(/Assignee:\s*Rafi/)).toBeTruthy();
		expect(textarea.value).toBe("Fix login");
	});

	it("Do not create a missing option", () => {
		render(
			<EditorHarness
				fields={boardFields([
					{
						options: [{ id: "1", label: "Rafi" }],
					},
				])}
			/>,
		);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Fix login" } });
		fireEvent.keyDown(textarea, { key: "@" });
		fireEvent.keyDown(textarea, { key: "Enter" });
		fireEvent.change(textarea, { target: { value: "Fix login @zzz" } });
		fireEvent.keyDown(textarea, { key: "Enter" });

		expect(screen.queryByText(/Assignee:/)).toBeNull();
		expect(screen.getByRole("listbox")).toBeTruthy();
	});

	it("Consume Enter while the picker is unavailable", () => {
		const onSubmit = vi.fn();
		const states: Array<TaskFieldCommandDefinition["catalogState"]> = [
			"loading",
			"failed",
			"disabled",
			"empty",
		];

		for (const catalogState of states) {
			onSubmit.mockClear();
			cleanup();
			render(
				<EditorHarness
					onSubmit={onSubmit}
					fields={boardFields([
						{ catalogState, options: [] },
						{ catalogState: "ready" },
					])}
				/>,
			);
			const textarea = getTitleTextarea();
			fireEvent.change(textarea, { target: { value: "Fix login" } });
			fireEvent.keyDown(textarea, { key: "@" });
			fireEvent.keyDown(textarea, { key: "Enter" });

			fireEvent.keyDown(textarea, { key: "Enter" });
			expect(onSubmit).not.toHaveBeenCalled();
		}
	});

	it("Edit a chip by clicking it", () => {
		render(
			<EditorHarness initialDraft={{ priorityId: 10 }} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Priority: High" }));

		const selected = document.querySelector(
			'[role="option"][aria-selected="true"]',
		);
		expect(selected?.textContent).toContain("High");
	});

	it("Remove a chip by pointer or keyboard", () => {
		render(
			<EditorHarness
				initialDraft={{ priorityId: 10 }}
			/>,
		);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Ship it" } });

		fireEvent.click(
			screen.getByRole("button", { name: /Remove Priority:\s*High/i }),
		);
		expect(screen.queryByText(/Priority:\s*High/)).toBeNull();

		cleanup();
		render(
			<EditorHarness initialDraft={{ priorityId: 10 }} />,
		);
		const textarea2 = getTitleTextarea();
		fireEvent.change(textarea2, { target: { value: "Ship it" } });
		textarea2.setSelectionRange(7, 7);
		fireEvent.keyDown(textarea2, { key: "Backspace" });
		expect(
			screen.getByRole("button", { name: "Priority: High" }).getAttribute(
				"data-selected",
			),
		).toBe("true");
		fireEvent.keyDown(textarea2, { key: "Backspace" });
		expect(screen.queryByText(/Priority:\s*High/)).toBeNull();
		expect(textarea2.value).toBe("Ship it");
	});

	it("Select multiple assignees", () => {
		render(<EditorHarness />);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Fix login" } });
		fireEvent.keyDown(textarea, { key: "@" });
		fireEvent.keyDown(textarea, { key: "Enter" });

		fireEvent.keyDown(textarea, { key: "Enter" });
		expect(screen.getByText(/Assignee:\s*Rafi/)).toBeTruthy();
		expect(screen.getByRole("listbox")).toBeTruthy();

		fireEvent.keyDown(textarea, { key: "ArrowDown" });
		fireEvent.keyDown(textarea, { key: "Enter" });
		expect(screen.getByText(/Assignee:\s*Maya/)).toBeTruthy();
		expect(screen.getByRole("listbox")).toBeTruthy();

		fireEvent.keyDown(textarea, { key: "Enter" });
		expect(screen.queryByRole("listbox")).toBeNull();

		cleanup();
		render(<EditorHarness />);
		const textarea2 = getTitleTextarea();
		fireEvent.change(textarea2, { target: { value: "Fix login" } });
		fireEvent.keyDown(textarea2, { key: "@" });
		fireEvent.keyDown(textarea2, { key: "Enter" });
		fireEvent.keyDown(textarea2, { key: "Enter" });
		fireEvent.keyDown(textarea2, { key: "Enter" });
		expect(screen.getByRole("listbox")).toBeTruthy();
		fireEvent.keyDown(textarea2, { key: "Escape" });
		expect(screen.queryByRole("listbox")).toBeNull();
	});

	it("Restore title focus after a picker closes", async () => {
		render(<EditorHarness />);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Fix login" } });
		textarea.setSelectionRange(9, 9);
		fireEvent.keyDown(textarea, { key: "@" });

		fireEvent.keyDown(textarea, { key: "Escape" });
		await waitFor(() => expect(document.activeElement).toBe(textarea));
		expect(textarea.selectionStart).toBe(9);

		fireEvent.keyDown(textarea, { key: "@" });
		fireEvent.mouseDown(document.body);
		await waitFor(() => expect(document.activeElement).toBe(textarea));

		fireEvent.keyDown(textarea, { key: "@" });
		fireEvent.keyDown(textarea, { key: "Enter" });
		fireEvent.keyDown(textarea, { key: "Enter" });
		await waitFor(() => expect(document.activeElement).toBe(textarea));

		fireEvent.keyDown(textarea, { key: "@" });
		fireEvent.keyDown(textarea, { key: "Enter" });
		fireEvent.keyDown(textarea, { key: "Enter" });
		fireEvent.keyDown(textarea, { key: "Enter" });
		await waitFor(() => expect(document.activeElement).toBe(textarea));
	});

	it("Reject a chips-only draft", () => {
		const onSubmit = vi.fn();
		const editorRef = { current: null as TaskTitleEditorHandle | null };
		render(
			<EditorHarness
				onSubmit={onSubmit}
				editorRef={editorRef}
				initialDraft={{ priorityId: 10 }}
			/>,
		);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "   " } });

		const candidate = editorRef.current?.getSubmitCandidate();
		expect(candidate?.valid).toBe(false);
		expect(candidate?.titleRequired).toBe(true);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByText(/Title is required/i)).toBeTruthy();
	});

	it("Exclude chips from title length validation", () => {
		const editorRef = { current: null as TaskTitleEditorHandle | null };
		const maxTitle = "a".repeat(255);
		render(
			<EditorHarness
				editorRef={editorRef}
				initialDraft={{ priorityId: 10 }}
			/>,
		);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: maxTitle } });

		const candidate = editorRef.current?.getSubmitCandidate();
		expect(candidate?.valid).toBe(true);
		expect(candidate?.title).toBe(maxTitle);
		expect(candidate?.title).not.toMatch(/Priority|High|@/);
	});

	it("exposes combobox semantics and announces chip changes", async () => {
		const { container } = render(<EditorHarness />);
		const textarea = getTitleTextarea();
		expect(textarea.getAttribute("role")).toBe("combobox");
		expect(textarea.getAttribute("aria-expanded")).toBe("false");

		fireEvent.change(textarea, { target: { value: "Fix login" } });
		fireEvent.keyDown(textarea, { key: "@" });
		expect(textarea.getAttribute("aria-expanded")).toBe("true");
		expect(textarea.getAttribute("aria-controls")).toBeTruthy();
		expect(textarea.getAttribute("aria-activedescendant")).toBeTruthy();

		fireEvent.keyDown(textarea, { key: "Enter" });
		fireEvent.keyDown(textarea, { key: "Enter" });

		const liveRegion = container.querySelector('[aria-live="polite"]');
		expect(liveRegion?.textContent).toMatch(/added/i);
	});

	it("preserves Tab and Shift+Tab navigation around the command editor", async () => {
		function TabHarness() {
			const [draft, dispatch] = useReducer(
				taskMetadataReducer,
				createInitialTaskMetadataDraft({ priorityId: 10 }),
			);
			return (
				<TaskTitleEditor
					fields={boardFields()}
					draft={draft}
					dispatch={(action: TaskMetadataAction) => dispatch(action)}
				/>
			);
		}

		render(
			<form>
				<button type="button">Before</button>
				<TabHarness />
				<button type="button">After</button>
			</form>,
		);
		const textarea = getTitleTextarea();
		const before = screen.getByRole("button", { name: "Before" });
		const after = screen.getByRole("button", { name: "After" });
		const chip = screen.getByRole("button", { name: "Priority: High" });

		fireEvent.change(textarea, { target: { value: "Fix login" } });
		fireEvent.keyDown(textarea, { key: "@" });
		expect(screen.getByRole("listbox")).toBeTruthy();

		textarea.focus();
		fireEvent.keyDown(textarea, { key: "Tab" });
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(textarea.value).toBe("Fix login");
		chip.focus();
		expect(document.activeElement).toBe(chip);
		fireEvent.keyDown(chip, { key: "Tab" });
		expect(document.activeElement).toBe(after);

		after.focus();
		fireEvent.keyDown(after, { key: "Tab", shiftKey: true });
		chip.focus();
		expect(document.activeElement).toBe(chip);
		fireEvent.keyDown(chip, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(textarea);
		fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(before);
	});
});
