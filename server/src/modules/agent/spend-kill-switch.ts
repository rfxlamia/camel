import { config } from "../../config.js";

export class AgentSpendKillSwitchError extends Error {
	readonly code = "AGENT_SPEND_KILL_SWITCH";

	constructor() {
		super("Agent spend is disabled by kill switch");
		this.name = "AgentSpendKillSwitchError";
	}
}

export function assertAgentSpendAllowed(): void {
	if (config.AGENT_SPEND_KILL_SWITCH === "true") {
		throw new AgentSpendKillSwitchError();
	}
}
