import type { ReactNode } from "react";
import { ContextPanelEditorView } from "./ContextPanelEditorView";
import {
	type ContextPanelEditorInput,
	useContextPanelEditor,
} from "./useContextPanelEditor";

export function ContextPanelEditor({
	board,
	card,
	onClose,
	renderFocusEntryButton,
	saveCard,
	children,
}: ContextPanelEditorInput & {
	onClose: () => void;
	children?: ReactNode;
}) {
	const viewProps = useContextPanelEditor({
		board,
		card,
		renderFocusEntryButton,
		saveCard,
	});
	return (
		<ContextPanelEditorView
			{...viewProps}
			onClose={onClose}
			children={children}
		/>
	);
}
