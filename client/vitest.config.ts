import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Keep test runs light on shared machines; CLI --maxWorkers can override.
		maxWorkers: 1,
		// Browser tests use jsdom by default; audited pure suites opt into Node
		// with a per-file @vitest-environment directive.
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
		env: {
			NODE_ENV: "test",
		},
		// jsdom integration tests inflate up to ~8x under parallel CPU load; the
		// heaviest reaches 10.9s against the 5s default with no hang to catch.
		testTimeout: 20000,
	},
});
