import { ContextPanelSurface, useBoard } from "../features/board";
import { FocusEntryButton } from "../features/focus";

type FocusEntryButtonProps = {
	source: "board";
	taskId: number;
	taskKey: string | null;
};

export default function ContextPanel() {
	const board = useBoard();
	return (
		<ContextPanelSurface
			board={board}
			renderFocusEntryButton={(props: FocusEntryButtonProps) => (
				<FocusEntryButton {...props} />
			)}
		/>
	);
}
