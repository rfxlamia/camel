import { db } from "../db/kysely.js";

// ---- Auth checks ------------------------------------------------------------

export type AuthCheck =
	| { allowed: true }
	| { allowed: false; status: number; error: string };

export function checkActorCanManage(role: string): AuthCheck {
	if (role === "admin" || role === "owner") return { allowed: true };
	return { allowed: false, status: 404, error: "Not found" };
}

export function checkActorCanChangeRole(role: string): AuthCheck {
	if (role === "owner") return { allowed: true };
	return { allowed: false, status: 404, error: "Not found" };
}

export function checkCanRemoveUser(
	actorId: number,
	targetUserId: number,
	targetRole: string,
): AuthCheck {
	if (actorId === targetUserId) {
		return {
			allowed: false,
			status: 403,
			error: "Cannot remove yourself",
		};
	}
	if (targetRole === "owner") {
		return {
			allowed: false,
			status: 403,
			error: "Cannot remove workspace owner",
		};
	}
	return { allowed: true };
}

// ---- Membership helpers -----------------------------------------------------

export async function lookupMembership(
	userId: number,
	workspaceId: number,
): Promise<string | undefined> {
	const row = await db
		.selectFrom("workspace_members")
		.select("role")
		.where("workspace_id", "=", workspaceId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return row?.role;
}

export function parseWorkspaceId(raw: string): number | null {
	const workspaceId = Number(raw);
	return Number.isInteger(workspaceId) ? workspaceId : null;
}
