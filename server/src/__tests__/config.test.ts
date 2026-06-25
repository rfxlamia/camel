import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Required env vars for Zod schema to pass
const REQUIRED_ENV = {
	DATABASE_URL: "postgresql://localhost:5432/test",
	ANTHROPIC_API_KEY: "test-key",
};

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
		expect(errorSpy).toHaveBeenCalled();
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
		expect(errorSpy).toHaveBeenCalled();
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
