import { z } from "zod";
import { parseKeyFromUrl } from "../../core/tracker-key.js";
import { workspaceIdParam } from "../../validators/schemas.js";

/** Validates `:workspaceId/:source/:key`; issues surface in this field order. */
export const workItemParams = z
	.object({
		workspaceId: workspaceIdParam,
		source: z.enum(["board", "tracker"], {
			error: "source must be board or tracker",
		}),
		key: z.string({ error: "invalid work item key" }),
	})
	.transform((params, ctx) => {
		const parsedKey = parseKeyFromUrl(params.key);
		if (!parsedKey) {
			ctx.addIssue({
				code: "custom",
				path: ["key"],
				message: "invalid work item key",
			});
			return z.NEVER;
		}
		return { ...params, keyNumber: parsedKey.keyNumber };
	});
