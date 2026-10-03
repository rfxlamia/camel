import { FocusEntryButton } from "../focus";
import { useBoard } from "./BoardContext";
import { ContextPanelSurface } from "./ContextPanelSurface";

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
