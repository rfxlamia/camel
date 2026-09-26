/** Whether to clear accumulated agent events when the active workspace changes.
 * True only when switching from one workspace to a different one (not initial set).
 */
export function shouldClearOnWorkspaceChange(
	prevId: number | null,
	nextId: number | null,
): boolean {
	if (prevId === null) return false;
	if (nextId === null) return false;
	return prevId !== nextId;
}
