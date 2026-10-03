import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, logger, requestContext } from "./logger.js";

describe("logger", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("is silent under NODE_ENV=test", () => {
		expect(logger.level).toBe("silent");
	});

	it("honors LOG_LEVEL", () => {
		vi.stubEnv("LOG_LEVEL", "debug");
		expect(createLogger().level).toBe("debug");
	});

	it("adds requestId from the async context to every record", () => {
		vi.stubEnv("LOG_LEVEL", "info");
		const lines: string[] = [];
		const log = createLogger({ write: (msg: string) => void lines.push(msg) });

		log.info("outside");
		requestContext.run({ requestId: "req-1" }, () => log.info("inside"));

		const [outside, inside] = lines.map((l) => JSON.parse(l));
		expect(outside.requestId).toBeUndefined();
		expect(inside).toMatchObject({ requestId: "req-1", msg: "inside" });
	});
});
