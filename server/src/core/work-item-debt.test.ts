import { describe, expect, it } from "vitest";
import { findKeyCollisions } from "./work-item-debt.js";

describe("findKeyCollisions", () => {
	it("returns mapped collisions from the query executor", async () => {
		const dbExec = {
			selectFrom: () => ({
				innerJoin: () => ({
					select: () => ({
						where: () => ({
							where: () => ({
								where: () => ({
									execute: async () => [
										{
											workspace_id: 7,
											key_number: 3,
											card_id: 11,
											tracker_item_id: 22,
										},
									],
								}),
							}),
						}),
					}),
				}),
			}),
		};

		await expect(findKeyCollisions(dbExec as never)).resolves.toEqual([
			{
				workspaceId: 7,
				keyNumber: 3,
				cardId: 11,
				trackerItemId: 22,
			},
		]);
	});

	it("returns an empty list when no collisions exist", async () => {
		const dbExec = {
			selectFrom: () => ({
				innerJoin: () => ({
					select: () => ({
						where: () => ({
							where: () => ({
								where: () => ({
									execute: async () => [],
								}),
							}),
						}),
					}),
				}),
			}),
		};

		await expect(findKeyCollisions(dbExec as never)).resolves.toEqual([]);
	});
});
