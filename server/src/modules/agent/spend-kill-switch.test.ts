import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpendKillSwitch } = vi.hoisted(() => ({
	mockSpendKillSwitch: { value: undefined as string | undefined },
}));

vi.mock("../../config.js", () => ({
	config: {
		get AGENT_SPEND_KILL_SWITCH() {
			return mockSpendKillSwitch.value;
		},
	},
}));

describe("agent spend kill switch", () => {
	const originalValue = process.env.AGENT_SPEND_KILL_SWITCH;

	beforeEach(() => {
		vi.resetModules();
		mockSpendKillSwitch.value = undefined;
		delete process.env.AGENT_SPEND_KILL_SWITCH;
	});

	afterEach(() => {
		if (originalValue === undefined) {
			delete process.env.AGENT_SPEND_KILL_SWITCH;
		} else {
			process.env.AGENT_SPEND_KILL_SWITCH = originalValue;
		}
	});

	it.each([
		undefined,
		"false",
	])("allows spend when the switch is %s", async (value) => {
		mockSpendKillSwitch.value = value;
		const { assertAgentSpendAllowed } = await import("./index.js");
		expect(assertAgentSpendAllowed).toBeTypeOf("function");
		expect(assertAgentSpendAllowed()).toBeUndefined();
	});

	it("throws the stable typed error when the switch is true", async () => {
		mockSpendKillSwitch.value = "true";
		const { AgentSpendKillSwitchError, assertAgentSpendAllowed } = await import(
			"./index.js"
		);

		expect(AgentSpendKillSwitchError).toBeTypeOf("function");
		let thrown: unknown;
		try {
			assertAgentSpendAllowed();
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(AgentSpendKillSwitchError);
		expect(thrown).toMatchObject({
			code: "AGENT_SPEND_KILL_SWITCH",
			message: "Agent spend is disabled by kill switch",
		});
	});
});
