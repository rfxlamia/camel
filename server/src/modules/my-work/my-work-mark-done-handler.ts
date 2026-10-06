import type { Request, Response } from "express";
import { domainBus, EVENTS } from "../../events.js";
import { publishEvent } from "../../realtime.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { optionalVersion } from "../../validators/schemas.js";
import { workItemParams } from "./my-work-route-params.js";
import {
	type MyWorkServiceMethods,
	rawWorkItemParams,
	sendUnavailable,
} from "./my-work-router-support.js";

export function createMarkDoneHandler(methods: MyWorkServiceMethods) {
	return async (req: Request, res: Response) => {
		const parsedParams = parseWith(
			workItemParams,
			rawWorkItemParams(req.params),
		);
		if (!parsedParams.ok) return sendValidationError(res, parsedParams.body);
		const {
			workspaceId,
			source: sourceValue,
			key,
			keyNumber,
		} = parsedParams.data;

		const parsedVersion = parseWith(optionalVersion, (req.body ?? {}).version);
		if (!parsedVersion.ok) return sendValidationError(res, parsedVersion.body);
		const version = parsedVersion.data;
		if (!methods.markDone) {
			sendUnavailable(res);
			return;
		}

		try {
			const result = await methods.markDone({
				userId: req.user!.id,
				actor: req.user!,
				workspaceId,
				source: sourceValue,
				keyNumber,
				version,
			});
			if (result.kind === "not_found") {
				return res.status(404).json({ error: "Not found" });
			}
			if (result.kind === "conflict") {
				return res.status(409).json({
					error: "Someone else updated this item first.",
					code: "version_conflict",
				});
			}
			if (result.kind === "unmappable" || result.kind === "invalid_status") {
				return res.status(409).json({
					error:
						sourceValue === "tracker"
							? "This status cannot be mapped to the current Tracker statuses."
							: "This status cannot be mapped to the current board columns.",
					code: "status_column_unmappable",
				});
			}
			if (result.kind === "wip") {
				return res.status(409).json({
					error: "WIP limit reached for this column",
					code: "wip_limit_reached",
					reason: result.reason,
				});
			}

			const item = await methods.detail({
				userId: req.user!.id,
				workspaceId,
				source: sourceValue,
				key,
				keyNumber,
			});
			if (!item) return res.status(404).json({ error: "Not found" });

			if (result.source === "tracker") {
				await publishEvent(workspaceId, {
					type: "tracker.updated",
					actor: req.user!,
					trackerItemId: result.itemId,
				});
			} else {
				await publishEvent(workspaceId, {
					type: result.moved ? "card.moved" : "card.updated",
					actor: req.user!,
					cardId: result.itemId,
					payload: { key: item.key },
				});

				if (result.addedSignableAssignee != null) {
					domainBus.emit(EVENTS.CARD_ASSIGNED, {
						type: EVENTS.CARD_ASSIGNED,
						workspaceId,
						actorId: req.user!.id,
						payload: {
							cardId: result.itemId,
							assigneeId: result.addedSignableAssignee,
							cardTitle: result.itemTitle,
							actorDisplayName: req.user!.displayName,
						},
					});
				}
			}
			return res.json(item);
		} catch {
			sendUnavailable(res);
		}
	};
}
