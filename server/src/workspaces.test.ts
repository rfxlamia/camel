import { describe, expect, it } from "vitest";
import { serializeWorkspaceList } from "./routes.js";

describe("workspace helper contracts", () => {
	it("serializes workspaces and pending invites for the client", () => {
		const response = serializeWorkspaceList({
			workspaces: [
				{ id: 1, name: "Default Workspace", role: "owner", isPersonal: false },
			],
			invites: [
				{ id: 5, workspaceId: 9, workspaceName: "Team", role: "member" },
			],
		});

		expect(response.workspaces[0]).toMatchObject({
			id: 1,
			name: "Default Workspace",
			role: "owner",
			isPersonal: false,
		});
		expect(response.pendingInvites).toEqual([
			{ id: 5, workspaceId: 9, workspaceName: "Team", role: "member" },
		]);
	});
});
