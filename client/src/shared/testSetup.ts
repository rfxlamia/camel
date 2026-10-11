// jsdom has no canvas backend. Lottie's SVG player nevertheless creates a
// one-pixel canvas at import time. Supply only that import-time 2D operation so
// real feature barrels can load without mocking their factories or UI exports.
if (typeof HTMLCanvasElement !== "undefined") {
	Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
		configurable: true,
		writable: true,
		value: (contextId: string) =>
			contextId === "2d"
				? {
						fillStyle: "",
						fillRect: () => {
							/* Import-time transparent pixel; no rendering in jsdom. */
						},
					}
				: null,
	});
}
