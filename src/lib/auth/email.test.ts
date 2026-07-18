import { describe, it, expect } from "vitest";
import { isValidFastEmail } from "./email";

// P1-02: the client-side gate. This is defence-in-depth / UX only — the
// authoritative check is the DB trigger (0021_enforce_signup_email_domain.sql),
// verified separately in supabase/tests/. These tests pin the allow-list logic.
describe("isValidFastEmail", () => {
  it("accepts a standard FAST NUCES Islamabad student address", () => {
    expect(isValidFastEmail("k21-1234@isb.nu.edu.pk")).toBe(true);
  });

  it("is case-insensitive and trims", () => {
    expect(isValidFastEmail("  K21-1234@ISB.NU.EDU.PK  ")).toBe(true);
  });

  it("accepts a pre-2023 Islamabad roll number on the org-wide domain", () => {
    expect(isValidFastEmail("i221000@nu.edu.pk")).toBe(true);
    expect(isValidFastEmail("  I221000@NU.EDU.PK  ")).toBe(true);
  });

  it("rejects non-Islamabad locals on the bare nu.edu.pk domain and other campuses", () => {
    expect(isValidFastEmail("k21-1234@nu.edu.pk")).toBe(false);
    expect(isValidFastEmail("l221000@nu.edu.pk")).toBe(false);
    expect(isValidFastEmail("i22100@nu.edu.pk")).toBe(false);
    expect(isValidFastEmail("i2210000@nu.edu.pk")).toBe(false);
    expect(isValidFastEmail("student@khi.nu.edu.pk")).toBe(false);
  });

  it("rejects off-domain addresses", () => {
    expect(isValidFastEmail("attacker@gmail.com")).toBe(false);
    expect(isValidFastEmail("someone@example.edu")).toBe(false);
  });

  it("rejects look-alike domains that merely contain the allowed domain", () => {
    // Must not be fooled by suffix/substring tricks.
    expect(isValidFastEmail("x@isb.nu.edu.pk.evil.com")).toBe(false);
    expect(isValidFastEmail("x@notisb.nu.edu.pk")).toBe(false);
    expect(isValidFastEmail("x@isb.nu.edu.pkk")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isValidFastEmail("")).toBe(false);
    expect(isValidFastEmail("no-at-sign")).toBe(false);
    expect(isValidFastEmail("a@b@isb.nu.edu.pk")).toBe(false);
    expect(isValidFastEmail("spaces in@isb.nu.edu.pk")).toBe(false);
  });
});
