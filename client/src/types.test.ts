import { describe, expect, it } from "vitest";
import type { SettingsMap } from "./types";

function getBoardName(s: SettingsMap): string {
	return s.boardName;
}

function getLogoPath(s: SettingsMap): string {
	return s.logoPath;
}

function getVersion(s: SettingsMap): number {
	return s.version;
}

describe("SettingsMap interface", () => {
	it("allows access to boardName, logoPath, and version", () => {
		const settings: SettingsMap = {
			boardName: "Dev Team",
			logoPath: "/uploads/logo.png",
			version: 3,
		};
		expect(getBoardName(settings)).toBe("Dev Team");
		expect(getLogoPath(settings)).toBe("/uploads/logo.png");
		expect(getVersion(settings)).toBe(3);
	});

	it("works with default values", () => {
		const settings: SettingsMap = {
			boardName: "Camel",
			logoPath: "/logo.png",
			version: 0,
		};
		expect(settings.boardName).toBe("Camel");
		expect(settings.logoPath).toBe("/logo.png");
		expect(settings.version).toBe(0);
	});
});

import type {
	Workspace,
	WorkspaceInvite,
	WorkspaceListResponse,
	WorkspaceMember,
	WorkspaceRole,
} from "./types";

describe("workspace response types", () => {
	it("type-checks the server response shape", () => {
		const role: WorkspaceRole = "owner";
		const workspace: Workspace = {
			id: 7,
			name: "Launch",
			role,
			isPersonal: false,
			memberCount: 3,
		};
		const member: WorkspaceMember = {
			userId: 2,
			username: "iris",
			displayName: "Iris",
			role: "member",
		};
		const invite: WorkspaceInvite = {
			id: 12,
			workspaceId: 7,
			workspaceName: "Launch",
			role: "member",
		};
		const response: WorkspaceListResponse = {
			workspaces: [workspace],
			pendingInvites: [invite],
		};

		expect(response.workspaces[0].role).toBe("owner");
		expect(member.role).toBe("member");
		expect(response.pendingInvites[0].workspaceName).toBe("Launch");
	});
});

import type { AgentEvent } from "./types";

describe("AgentEvent live-thinking shape", () => {
	it("type-checks agent.card.thinking with boardId + columnSlug + token", () => {
		const event: AgentEvent = {
			type: "agent.card.thinking",
			columnSlug: "analysis-specialist",
			boardId: 42,
			token: "reasoning chunk",
		};
		expect(event.type).toBe("agent.card.thinking");
		expect(event.boardId).toBe(42);
		expect(event.columnSlug).toBe("analysis-specialist");
	});

	it("type-checks boardId on existing agent.card.* events", () => {
		const started: AgentEvent = {
			type: "agent.card.started",
			columnSlug: "research-specialist",
			boardId: 7,
		};
		expect(started.boardId).toBe(7);
	});
});

import type {
	ActivityEvent,
	BoardEvent,
	Card,
	CardAttachment,
	User,
} from "./types";

const actor: User = {
	id: 7,
	username: "sinta",
	displayName: "Sinta",
	emailVerified: true,
	needsUsername: false,
};
const activityActor = { username: "sinta", displayName: actor.displayName };

const attachment: CardAttachment = {
	id: 9,
	thumbnailUrl: "/api/workspaces/7/cards/42/attachments/9/thumbnail",
	originalUrl: "/api/workspaces/7/cards/42/attachments/9/original",
	downloadUrl: "/api/workspaces/7/cards/42/attachments/9/original/download",
	mimeType: "image/png",
	createdAt: "2026-09-05T10:00:00.000Z",
};

describe("attachment response and realtime types", () => {
	it("accepts safe attachment metadata on cards and activity", () => {
		const card: Card = {
			id: 42,
			columnId: 3,
			title: "Card with image",
			description: "",
			position: 1,
			version: 1,
			createdAt: attachment.createdAt,
			updatedAt: attachment.createdAt,
			startedAt: null,
			doneAt: null,
			dueDate: null,
			assignees: [],
			attachments: [attachment],
		};
		const activity: ActivityEvent = {
			id: 11,
			type: "attachment_added",
			cardId: card.id,
			cardTitle: card.title,
			fromColumn: null,
			toColumn: null,
			actor: activityActor,
			createdAt: attachment.createdAt,
			payload: {
				attachmentId: attachment.id,
				mimeType: attachment.mimeType,
				createdAt: attachment.createdAt,
			},
		};

		expect(card.attachments?.[0].thumbnailUrl).toContain("/thumbnail");
		expect(activity.payload?.attachmentId).toBe(attachment.id);
		expect(activity.payload).not.toHaveProperty("thumbnailBytes");
	});

	it("accepts metadata-only attachment realtime events", () => {
		const event: BoardEvent = {
			type: "attachment.added",
			actor,
			cardId: 42,
			at: attachment.createdAt,
			payload: {
				attachmentId: attachment.id,
				mimeType: attachment.mimeType,
				createdAt: attachment.createdAt,
			},
		};
		expect(event.type).toBe("attachment.added");
		expect(event.payload?.attachmentId).toBe(attachment.id);

		const removedEvent: BoardEvent = {
			type: "attachment.removed",
			actor,
			cardId: 42,
			at: attachment.createdAt,
			payload: {
				attachmentId: attachment.id,
				mimeType: attachment.mimeType,
				createdAt: attachment.createdAt,
			},
		};
		expect(removedEvent.type).toBe("attachment.removed");
		expect(removedEvent.payload?.attachmentId).toBe(attachment.id);
		expect(removedEvent.payload?.mimeType).toBe(attachment.mimeType);
		expect(removedEvent.payload?.createdAt).toBe(attachment.createdAt);
	});
});
