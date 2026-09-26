import { BoardPageSurface, useBoard } from "../features/board";

export default function BoardPage() {
	return <BoardPageSurface board={useBoard()} />;
}
