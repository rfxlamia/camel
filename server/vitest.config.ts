import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Keep test runs light on shared machines; CLI --maxWorkers can override.
		maxWorkers: 1,
		include: ["src/**/*.test.ts"],
		env: {
			NODE_ENV: "test",
		},
	},
});
