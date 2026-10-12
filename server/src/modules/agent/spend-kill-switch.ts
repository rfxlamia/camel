import { config } from "../../config.js";

export const AGENT_SPEND_KILL_SWITCH_RESPONSE = {
	error: "Agent spend is disabled by kill switch",
	code: "AGENT_SPEND_KILL_SWITCH",
} as const;

export class AgentSpendKillSwitchError extends Error {
	readonly code = AGENT_SPEND_KILL_SWITCH_RESPONSE.code;

	constructor() {
		super(AGENT_SPEND_KILL_SWITCH_RESPONSE.error);
		this.name = "AgentSpendKillSwitchError";
	}
}

export function assertAgentSpendAllowed(): void {
	if (config.AGENT_SPEND_KILL_SWITCH === "true") {
		throw new AgentSpendKillSwitchError();
	}
}
