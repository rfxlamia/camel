import { useNavigate } from "react-router";
import { useBoard } from "../context/BoardContext";
import { useFocusSession } from "../context/FocusSessionContext";

export default function FocusIndicator() {
	const { session, loading } = useFocusSession();
	const { focusModeEnabled } = useBoard();
	const navigate = useNavigate();

	if (loading || !focusModeEnabled || session === null) {
		return null;
	}

	return (
		<button
			type="button"
			onClick={() => navigate("/focus")}
			className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
		>
			Focus active
		</button>
	);
}
