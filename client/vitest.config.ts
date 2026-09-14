import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
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
