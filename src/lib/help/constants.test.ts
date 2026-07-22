import { describe, expect, it } from "vitest";
import { HELP_TABS, DEFAULT_HELP_TAB, isHelpTab } from "./constants";

describe("Campus Help internal tabs", () => {
  it("is exactly SOCIO | ME (no Following/Urgent/etc.)", () => {
    expect(HELP_TABS.map((t) => t.key)).toEqual(["socio", "me"]);
    expect(HELP_TABS.map((t) => t.label)).toEqual(["SOCIO", "ME"]);
  });

  it("defaults to SOCIO", () => {
    expect(DEFAULT_HELP_TAB).toBe("socio");
  });

  it("validates known tabs and rejects retired ones", () => {
    expect(isHelpTab("socio")).toBe(true);
    expect(isHelpTab("me")).toBe(true);
    expect(isHelpTab("following")).toBe(false);
    expect(isHelpTab("urgent")).toBe(false);
    expect(isHelpTab("communities")).toBe(false);
    expect(isHelpTab("")).toBe(false);
  });
});
