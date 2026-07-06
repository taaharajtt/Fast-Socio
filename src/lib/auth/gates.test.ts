import { describe, it, expect } from "vitest";
import { isDemoLoginEnabled } from "./gates";

// P1-03: the public one-click demo login must be off in production unless
// explicitly opted in.
describe("isDemoLoginEnabled", () => {
  it("is enabled in development", () => {
    expect(isDemoLoginEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isDemoLoginEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("is DISABLED in production by default", () => {
    expect(isDemoLoginEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isDemoLoginEnabled({ NODE_ENV: "production", ALLOW_DEMO_LOGIN: "" })).toBe(false);
    expect(isDemoLoginEnabled({ NODE_ENV: "production", ALLOW_DEMO_LOGIN: "1" })).toBe(false);
    expect(isDemoLoginEnabled({ NODE_ENV: "production", ALLOW_DEMO_LOGIN: "false" })).toBe(false);
  });

  it("can be explicitly opted into in production", () => {
    expect(isDemoLoginEnabled({ NODE_ENV: "production", ALLOW_DEMO_LOGIN: "true" })).toBe(true);
  });
});
