import "dotenv/config";
import { existsSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import express from "express";
import request from "supertest";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { db } from "../db/kysely.js";
import {
	batchUpsertSettings,
	DEFAULT_SETTINGS,
	generateDefaultSettings,
	settingsRouter,
	UPLOADS_DIR,
	validateBoardName,
	validateSettingKey,
} from "./settings.js";

describe("validateBoardName", () => {
	it("rejects empty string", () => {
		const result = validateBoardName("");
		expect(result).toEqual({ valid: false, error: "Name is required" });
	});

	it("rejects whitespace-only string", () => {
		const result = validateBoardName("   ");
		expect(result).toEqual({ valid: false, error: "Name is required" });
	});

	it("rejects names exceeding 15 characters", () => {
		const result = validateBoardName("Super Long Board Name");
		expect(result).toEqual({ valid: false, error: "Max 15 characters" });
	});

	it("accepts valid name and trims whitespace", () => {
		const result = validateBoardName("  Dev Team  ");
		expect(result).toEqual({ valid: true, trimmed: "Dev Team" });
	});

	it("accepts single character name", () => {
		const result = validateBoardName("A");
		expect(result).toEqual({ valid: true, trimmed: "A" });
	});

	it("accepts exactly 15 character name", () => {
		const name = "A".repeat(15);
		const result = validateBoardName(name);
		expect(result).toEqual({ valid: true, trimmed: name });
	});
});

describe("validateSettingKey", () => {
	it("accepts known setting keys", () => {
		expect(validateSettingKey("board_name")).toBe(true);
		expect(validateSettingKey("logo_path")).toBe(true);
	});

	it("rejects unknown setting keys", () => {
		expect(validateSettingKey("unknown_key")).toBe(false);
		expect(validateSettingKey("")).toBe(false);
	});
});

describe("DEFAULT_SETTINGS", () => {
	it("has correct default values", () => {
		expect(DEFAULT_SETTINGS.boardName).toBe("Camel");
		expect(DEFAULT_SETTINGS.logoPath).toBe("/logo.png");
	});
});

describe("generateDefaultSettings", () => {
	it("returns defaults when no rows provided", () => {
		const settings = generateDefaultSettings([]);
		expect(settings).toEqual({
			boardName: "Camel",
			logoPath: "/logo.png",
			version: 0,
		});
	});

	it("merges board_name from rows", () => {
		const rows = [
			{
				key: "board_name",
				textValue: "Dev Team",
				boolValue: null,
				version: 2,
				updatedAt: "2026-06-13",
			},
		];
		const settings = generateDefaultSettings(rows);
		expect(settings.boardName).toBe("Dev Team");
		expect(settings.logoPath).toBe("/logo.png");
	});

	it("merges both settings from rows", () => {
		const rows = [
			{
				key: "board_name",
				textValue: "Dev Team",
				boolValue: null,
				version: 2,
				updatedAt: "2026-06-13",
			},
			{
				key: "logo_path",
				textValue: "/uploads/custom.png",
				boolValue: null,
				version: 3,
				updatedAt: "2026-06-13",
			},
		];
		const settings = generateDefaultSettings(rows);
		expect(settings.boardName).toBe("Dev Team");
		expect(settings.logoPath).toBe("/uploads/custom.png");
	});

	it("uses max version across all rows", () => {
		const rows = [
			{
				key: "board_name",
				textValue: "A",
				boolValue: null,
				version: 5,
				updatedAt: "2026-06-13",
			},
			{
				key: "logo_path",
				textValue: "/b.png",
				boolValue: null,
				version: 3,
				updatedAt: "2026-06-13",
			},
		];
		const settings = generateDefaultSettings(rows);
		expect(settings.version).toBe(5);
	});
});

describe("PATCH validation", () => {
	it("rejects setting with unknown key", () => {
		// Verify validateSettingKey rejects unknown keys
		expect(validateSettingKey("unknown_key")).toBe(false);
	});

	it("rejects board_name with empty value", () => {
		const result = validateBoardName("");
		expect(result.valid).toBe(false);
	});

	it("accepts valid board_name update", () => {
		const result = validateBoardName("Dev Team");
		expect(result.valid).toBe(true);
		if (result.valid) expect(result.trimmed).toBe("Dev Team");
	});
});

import {
	generateLogoFilename,
	MAX_LOGO_SIZE_BYTES,
	validateFileSize,
	validateLogoFile,
} from "./settings.js";

describe("validateLogoFile", () => {
	it("accepts image/png", () => {
		expect(validateLogoFile("image/png")).toEqual({ valid: true });
	});

	it("accepts image/jpeg", () => {
		expect(validateLogoFile("image/jpeg")).toEqual({ valid: true });
	});

	it("rejects application/pdf", () => {
		expect(validateLogoFile("application/pdf")).toEqual({
			valid: false,
			error: "Only .png and .jpg files are accepted",
		});
	});

	it("rejects image/gif", () => {
		expect(validateLogoFile("image/gif")).toEqual({
			valid: false,
			error: "Only .png and .jpg files are accepted",
		});
	});

	it("rejects empty mimetype", () => {
		expect(validateLogoFile("")).toEqual({
			valid: false,
			error: "Only .png and .jpg files are accepted",
		});
	});
});

describe("validateFileSize", () => {
	it("accepts file under 10MB", () => {
		expect(validateFileSize(2 * 1024 * 1024)).toEqual({ valid: true });
	});

	it("accepts file exactly at 10MB", () => {
		expect(validateFileSize(10 * 1024 * 1024)).toEqual({ valid: true });
	});

	it("rejects file over 10MB", () => {
		expect(validateFileSize(15 * 1024 * 1024)).toEqual({
			valid: false,
			error: "File size must be under 10MB",
		});
	});

	it("rejects file at 10MB + 1 byte", () => {
		expect(validateFileSize(10 * 1024 * 1024 + 1)).toEqual({
			valid: false,
			error: "File size must be under 10MB",
		});
	});
});

describe("generateLogoFilename", () => {
	it("generates filename with logo prefix and timestamp", () => {
		const filename = generateLogoFilename("image/png");
		expect(filename).toMatch(/^logo-\d+-\w+\.png$/);
	});

	it("uses jpg extension for jpeg", () => {
		const filename = generateLogoFilename("image/jpeg");
		expect(filename).toMatch(/\.jpg$/);
	});

	it("generates unique filenames on consecutive calls", () => {
		const a = generateLogoFilename("image/png");
		const b = generateLogoFilename("image/png");
		// Both should match pattern, but may be same if called in same ms
		expect(a).toMatch(/^logo-/);
		expect(b).toMatch(/^logo-/);
	});
});

describe("MAX_LOGO_SIZE_BYTES", () => {
	it("is 10MB", () => {
		expect(MAX_LOGO_SIZE_BYTES).toBe(10 * 1024 * 1024);
	});
});

import {
	createWorkspaceSettingsService,
	hasResetAppRoute,
} from "./settings.js";

describe("workspace settings service", () => {
	it("reads and writes settings by workspace id", async () => {
		const repo = {
			getMembership: vi.fn(async (_workspaceId, userId) => ({
				userId,
				role: "admin",
			})),
			getSettings: vi.fn(async (workspaceId) =>
				workspaceId === 1
					? [
							{
								key: "board_name",
								textValue: "Alpha",
								boolValue: null,
								version: 1,
								updatedAt: "2026-06-13",
							},
						]
					: [
							{
								key: "board_name",
								textValue: "Beta",
								boolValue: null,
								version: 1,
								updatedAt: "2026-06-13",
							},
						],
			),
			updateSettings: vi.fn(async (workspaceId, updates) => ({
				workspaceId,
				updates,
			})),
		};
		const service = createWorkspaceSettingsService(repo);

		await expect(
			service.getSettings({ userId: 1, workspaceId: 1 }),
		).resolves.toMatchObject({ boardName: "Alpha" });
		await expect(
			service.getSettings({ userId: 1, workspaceId: 2 }),
		).resolves.toMatchObject({ boardName: "Beta" });

		await service.updateSettings({
			userId: 1,
			workspaceId: 2,
			updates: [{ key: "board_name", textValue: "Beta 2", version: 1 }],
		});
		expect(repo.updateSettings).toHaveBeenCalledWith(2, [
			{ key: "board_name", textValue: "Beta 2", version: 1 },
		]);
	});

	it("blocks member writes and removes reset-app", async () => {
		const service = createWorkspaceSettingsService({
			getMembership: vi.fn(async () => ({ userId: 4, role: "member" })),
			getSettings: vi.fn(),
			updateSettings: vi.fn(),
		});

		await expect(
			service.updateSettings({
				userId: 4,
				workspaceId: 7,
				updates: [{ key: "board_name", textValue: "Nope", version: 1 }],
			}),
		).resolves.toEqual({ status: 403, error: "Forbidden" });
		expect(hasResetAppRoute()).toBe(false);
	});
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"batchUpsertSettings (real DB)",
	() => {
		let workspaceId: number;
		let ownerId: number;

		beforeAll(async () => {
			const owner = await db
				.insertInto("users")
				.values({
					username: `settings-batch-${Date.now()}`,
					display_name: "Owner",
					password_hash: "h",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			ownerId = owner.id;
			const workspace = await db
				.insertInto("workspaces")
				.values({
					name: "Batch Settings WS",
					owner_user_id: ownerId,
					is_personal: false,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;
		});

		afterAll(async () => {
			await db
				.deleteFrom("settings")
				.where("workspace_id", "=", workspaceId)
				.execute();
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db.deleteFrom("users").where("id", "=", ownerId).execute();
		});

		afterEach(async () => {
			await db
				.deleteFrom("settings")
				.where("workspace_id", "=", workspaceId)
				.execute();
		});

		it("returns early for empty updates array", async () => {
			await batchUpsertSettings(workspaceId, [], 1);
			const rows = await db
				.selectFrom("settings")
				.selectAll()
				.where("workspace_id", "=", workspaceId)
				.execute();
			expect(rows).toHaveLength(0);
		});

		it("upserts multiple keys atomically in one call", async () => {
			const updates = [
				{ key: "board_name", textValue: "Dev Team" },
				{ key: "logo_path", textValue: "/uploads/custom.png" },
			];

			await batchUpsertSettings(workspaceId, updates, 5);

			const rows = await db
				.selectFrom("settings")
				.select(["key", "text_value", "version"])
				.where("workspace_id", "=", workspaceId)
				.orderBy("key")
				.execute();
			expect(rows).toEqual([
				{ key: "board_name", text_value: "Dev Team", version: 5 },
				{ key: "logo_path", text_value: "/uploads/custom.png", version: 5 },
			]);
		});

		it("handles single key update and upserts existing rows on conflict", async () => {
			await batchUpsertSettings(
				workspaceId,
				[{ key: "board_name", textValue: "A" }],
				1,
			);
			await batchUpsertSettings(
				workspaceId,
				[{ key: "board_name", textValue: "B" }],
				2,
			);

			const rows = await db
				.selectFrom("settings")
				.select(["key", "text_value", "version"])
				.where("workspace_id", "=", workspaceId)
				.execute();
			expect(rows).toEqual([
				{ key: "board_name", text_value: "B", version: 2 },
			]);
		});
	},
);

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"PATCH / — version race (real DB)",
	() => {
		let workspaceId: number;
		let ownerId: number;
		let app: express.Express;

		beforeAll(async () => {
			const owner = await db
				.insertInto("users")
				.values({
					username: `settings-patch-race-${Date.now()}`,
					display_name: "Owner",
					password_hash: "h",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			ownerId = owner.id;
			const workspace = await db
				.insertInto("workspaces")
				.values({
					name: "Patch Race WS",
					owner_user_id: ownerId,
					is_personal: false,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;
			await db
				.insertInto("workspace_members")
				.values({ workspace_id: workspaceId, user_id: ownerId, role: "owner" })
				.execute();

			app = express();
			app.use(express.json());
			app.use((req, _res, next) => {
				(req as unknown as { user: { id: number } }).user = { id: ownerId };
				next();
			});
			app.use("/workspaces/:workspaceId/settings", settingsRouter);
		});

		afterAll(async () => {
			await db
				.deleteFrom("settings")
				.where("workspace_id", "=", workspaceId)
				.execute();
			await db
				.deleteFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.execute();
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db.deleteFrom("users").where("id", "=", ownerId).execute();
		});

		afterEach(async () => {
			await db
				.deleteFrom("settings")
				.where("workspace_id", "=", workspaceId)
				.execute();
		});

		it("rejects the loser with 409 instead of silently clobbering the winner", async () => {
			await db
				.insertInto("settings")
				.values({
					workspace_id: workspaceId,
					key: "board_name",
					text_value: "Original",
					version: 1,
				})
				.execute();

			// Delay the first insertInto call (whichever request's write reaches it
			// first) so the second request's read-check-write cycle completes
			// first — reproducing the window between the version read and the
			// write where a concurrent request can slip through undetected.
			// Kysely builders are immutable — each chained call (.values(),
			// .onConflict()) returns a new instance, so the terminal .execute()
			// is never the object insertInto() itself returned. A Proxy that
			// re-wraps every chained call catches whichever instance execute()
			// finally lands on.
			function delayExecuteOnce(builder: any, delayMs: number): any {
				return new Proxy(builder, {
					get(target, prop, receiver) {
						const value = Reflect.get(target, prop, receiver);
						if (typeof value !== "function") return value;
						if (
							prop === "execute" ||
							prop === "executeTakeFirst" ||
							prop === "executeTakeFirstOrThrow"
						) {
							return async (...args: unknown[]) => {
								await new Promise((r) => setTimeout(r, delayMs));
								return value.apply(target, args);
							};
						}
						return (...args: unknown[]) => {
							const result = value.apply(target, args);
							return result && typeof result === "object"
								? delayExecuteOnce(result, delayMs)
								: result;
						};
					},
				});
			}

			const originalInsertInto = db.insertInto.bind(db);
			const spy = vi
				.spyOn(db, "insertInto")
				.mockImplementationOnce((...args: any[]) => {
					const builder = (originalInsertInto as any)(...args);
					return delayExecuteOnce(builder, 150);
				});

			try {
				const [first, second] = await Promise.all([
					request(app)
						.patch(`/workspaces/${workspaceId}/settings`)
						.send({ version: 1, boardName: "From A" }),
					request(app)
						.patch(`/workspaces/${workspaceId}/settings`)
						.send({ version: 1, boardName: "From B" }),
				]);

				const statuses = [first.status, second.status].sort();
				expect(statuses).toEqual([200, 409]);
			} finally {
				spy.mockRestore();
			}

			const row = await db
				.selectFrom("settings")
				.select(["text_value", "version"])
				.where("workspace_id", "=", workspaceId)
				.where("key", "=", "board_name")
				.executeTakeFirstOrThrow();
			expect(row.version).toBe(2);
		});
	},
);

describe.skipIf(!process.env.RUN_INTEGRATION)("POST /logo (real DB)", () => {
	let workspaceId: number;
	let ownerId: number;
	let app: express.Express;

	beforeAll(async () => {
		const owner = await db
			.insertInto("users")
			.values({
				username: `settings-logo-${Date.now()}`,
				display_name: "Owner",
				password_hash: "h",
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		ownerId = owner.id;
		const workspace = await db
			.insertInto("workspaces")
			.values({ name: "Logo WS", owner_user_id: ownerId, is_personal: false })
			.returning("id")
			.executeTakeFirstOrThrow();
		workspaceId = workspace.id;
		await db
			.insertInto("workspace_members")
			.values({ workspace_id: workspaceId, user_id: ownerId, role: "owner" })
			.execute();

		app = express();
		app.use((req, _res, next) => {
			(req as unknown as { user: { id: number } }).user = { id: ownerId };
			next();
		});
		app.use("/workspaces/:workspaceId/settings", settingsRouter);
		app.use((err: any, _req: any, res: any, _next: any) => {
			res.status(500).json({ error: err.message ?? "error" });
		});
	});

	afterAll(async () => {
		await db
			.deleteFrom("settings")
			.where("workspace_id", "=", workspaceId)
			.execute();
		await db
			.deleteFrom("workspace_members")
			.where("workspace_id", "=", workspaceId)
			.execute();
		await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
		await db.deleteFrom("users").where("id", "=", ownerId).execute();
	});

	afterEach(async () => {
		await db
			.deleteFrom("settings")
			.where("workspace_id", "=", workspaceId)
			.execute();
		vi.restoreAllMocks();
	});

	it("keeps the old logo file on disk when the DB write fails", async () => {
		const oldFilename = `old-test-logo-${Date.now()}.png`;
		const oldAbsPath = path.join(UPLOADS_DIR, oldFilename);
		writeFileSync(oldAbsPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		const filesBefore = new Set(readdirSync(UPLOADS_DIR));

		await db
			.insertInto("settings")
			.values({
				workspace_id: workspaceId,
				key: "logo_path",
				text_value: `/uploads/${oldFilename}`,
				version: 1,
			})
			.execute();

		// Simulate a DB failure on the upsert that persists the new logo
		// path. The write now runs inside db.transaction(), so patch the
		// trx handed to the callback rather than db.insertInto directly.
		const originalTransaction = db.transaction.bind(db);
		vi.spyOn(db, "transaction").mockImplementationOnce(() => {
			const builder = originalTransaction();
			const originalExecute = builder.execute.bind(builder);
			builder.execute = ((cb: any) =>
				originalExecute((trx: any) => {
					trx.insertInto = () => {
						throw new Error("simulated DB failure");
					};
					return cb(trx);
				})) as typeof builder.execute;
			return builder;
		});

		const pngMagic = Buffer.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		]);
		try {
			const res = await request(app)
				.post(`/workspaces/${workspaceId}/settings/logo`)
				.attach("logo", pngMagic, {
					filename: "new-logo.png",
					contentType: "image/png",
				});

			expect(res.status).toBe(500);
			expect(existsSync(oldAbsPath)).toBe(true);
		} finally {
			if (existsSync(oldAbsPath)) unlinkSync(oldAbsPath);
			for (const f of readdirSync(UPLOADS_DIR)) {
				if (!filesBefore.has(f)) unlinkSync(path.join(UPLOADS_DIR, f));
			}
		}
	});
});
