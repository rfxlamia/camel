import { describe, expect, it } from "vitest";
import { createCorsOriginPolicy } from "./cors.js";

describe("CORS origin policy", () => {
  it("allows only origins listed in CORS_ORIGIN", () => {
    const isAllowed = createCorsOriginPolicy({
      corsOrigin: "https://app.example.com, https://admin.example.com",
      nodeEnv: "production",
    });

    expect(isAllowed("https://app.example.com")).toBe(true);
    expect(isAllowed("https://admin.example.com")).toBe(true);
    expect(isAllowed("https://evil.example")).toBe(false);
  });

  it("keeps local Vite development origins available when no allowlist is set", () => {
    const isAllowed = createCorsOriginPolicy({ corsOrigin: undefined, nodeEnv: "development" });

    expect(isAllowed("http://localhost:5173")).toBe(true);
    expect(isAllowed("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowed("https://evil.example")).toBe(false);
  });

  it("does not allow browser origins by default in production", () => {
    const isAllowed = createCorsOriginPolicy({ corsOrigin: undefined, nodeEnv: "production" });

    expect(isAllowed("https://app.example.com")).toBe(false);
    expect(isAllowed(undefined)).toBe(true);
  });
});
