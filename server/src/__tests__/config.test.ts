import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Required env vars for Zod schema to pass
const REQUIRED_ENV = {
	DATABASE_URL: "postgresql://localhost:5432/test",
	ANTHROPIC_API_KEY: "test-key",
};

describe("AGENT_SPEND_KILL_SWITCH config", () => {
	const originalEnv = { ...process.env };
	const requiredEnv = {
		...REQUIRED_ENV,
		NODE_ENV: "test",
	};

	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv, ...requiredEnv };
		delete process.env.AGENT_SPEND_KILL_SWITCH;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("defaults to false when the flag is absent", async () => {
		const { resolveConfig } = await import("../config.js");
		expect(resolveConfig(requiredEnv).AGENT_SPEND_KILL_SWITCH).toBe("false");
	});

	it.each([
		"false",
		"true",
	] as const)("preserves explicit %s values", async (value) => {
		const { resolveConfig } = await import("../config.js");
		expect(
			resolveConfig({ ...requiredEnv, AGENT_SPEND_KILL_SWITCH: value })
				.AGENT_SPEND_KILL_SWITCH,
		).toBe(value);
	});

	it("rejects any value other than true or false", async () => {
		const { resolveConfig } = await import("../config.js");
		expect(() =>
			resolveConfig({ ...requiredEnv, AGENT_SPEND_KILL_SWITCH: "yes" }),
		).toThrow();
	});
});

describe("BETTER_AUTH_SECRET production guard", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv, ...REQUIRED_ENV };
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("crashes in production with default secret", async () => {
		process.env.NODE_ENV = "production";
		process.env.BETTER_AUTH_SECRET = "dev-secret-change-in-production";
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await import("../config.js");

		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("BETTER_AUTH_SECRET must be set in production"),
		);
	});

	it("crashes in production with empty secret", async () => {
		process.env.NODE_ENV = "production";
		process.env.BETTER_AUTH_SECRET = "";
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await import("../config.js");

		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("BETTER_AUTH_SECRET must be set in production"),
		);
	});

	it("crashes in production when BETTER_AUTH_SECRET is not set", async () => {
		process.env.NODE_ENV = "production";
		delete process.env.BETTER_AUTH_SECRET;
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await import("../config.js");

		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("BETTER_AUTH_SECRET must be set in production"),
		);
	});

	it("passes in production with custom secret", async () => {
		process.env.NODE_ENV = "production";
		process.env.BETTER_AUTH_SECRET = "my-real-secret";

		const { config } = await import("../config.js");
		expect(config.BETTER_AUTH_SECRET).toBe("my-real-secret");
	});

	it("passes in development with default secret", async () => {
		process.env.NODE_ENV = "development";
		process.env.BETTER_AUTH_SECRET = "dev-secret-change-in-production";

		const { config } = await import("../config.js");
		expect(config.BETTER_AUTH_SECRET).toBe("dev-secret-change-in-production");
	});
});
