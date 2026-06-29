import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { domainBus, EVENTS, type DomainEvent } from "./events.js";

afterEach(() => {
	domainBus.removeAllListeners();
});

describe("EVENTS", () => {
	it("defines expected event type constants", () => {
		expect(EVENTS.CARD_ASSIGNED).toBe("card:assigned");
		expect(EVENTS.CARD_DUE_DATE_CHANGED).toBe("card:dueDateChanged");
		expect(EVENTS.CARD_DUE_DATE_REMOVED).toBe("card:dueDateRemoved");
		expect(EVENTS.MEMBER_JOINED).toBe("member:joined");
		expect(EVENTS.SYSTEM_ALERT).toBe("system:alert");
		expect(EVENTS.CARD_DELETED).toBe("card:deleted");
	});
});

describe("domainBus", () => {
	it("is an EventEmitter instance", () => {
		expect(domainBus).toBeInstanceOf(EventEmitter);
	});

	it("delivers CARD_ASSIGNED events with the exact payload", () => {
		const received: DomainEvent[] = [];
		domainBus.on(EVENTS.CARD_ASSIGNED, (event: DomainEvent) => {
			received.push(event);
		});

		const event: DomainEvent = {
			type: EVENTS.CARD_ASSIGNED,
			workspaceId: 1,
			actorId: 42,
			payload: { cardId: 99, assigneeId: 7 },
		};
		domainBus.emit(EVENTS.CARD_ASSIGNED, event);

		expect(received).toEqual([event]);
	});
});
