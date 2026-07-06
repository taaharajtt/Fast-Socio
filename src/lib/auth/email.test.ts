import { describe, it, expect } from "vitest";
import { isValidFastEmail } from "./email";

// P1-02: the client-side gate. This is defence-in-depth / UX only — the
// authoritative check is the DB trigger (0021_enforce_signup_email_domain.sql),
// verified separately in supabase/tests/. These tests pin the allow-list logic.
describe("isValidFastEmail", () => {
  it("accepts a standard FAST NUCES student address", () => {
    expect(isValidFastEmail("k21-1234@nu.edu.pk")).toBe(true);
  });

  it("accepts a campus subdomain address", () => {
    expect(isValidFastEmail("student@khi.nu.edu.pk")).toBe(true);
  });

  it("is case-insensitive and trims", () => {
    expect(isValidFastEmail("  K21-1234@NU.EDU.PK  ")).toBe(true);
  });

  it("rejects off-domain addresses", () => {
    expect(isValidFastEmail("attacker@gmail.com")).toBe(false);
    expect(isValidFastEmail("someone@example.edu")).toBe(false);
  });

  it("rejects look-alike domains that merely contain the allowed domain", () => {
    // Must not be fooled by suffix/substring tricks.
    expect(isValidFastEmail("x@nu.edu.pk.evil.com")).toBe(false);
    expect(isValidFastEmail("x@notnu.edu.pk")).toBe(false);
    expect(isValidFastEmail("x@nu.edu.pkk")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isValidFastEmail("")).toBe(false);
    expect(isValidFastEmail("no-at-sign")).toBe(false);
    expect(isValidFastEmail("a@b@nu.edu.pk")).toBe(false);
    expect(isValidFastEmail("spaces in@nu.edu.pk")).toBe(false);
  });
});
