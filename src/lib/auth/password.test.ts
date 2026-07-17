import { describe, it, expect } from "vitest";
import { passwordError, PASSWORD_MIN_LENGTH } from "./password";

describe("passwordError", () => {
  it("accepts a password meeting length and every character class", () => {
    expect(passwordError("Abcdefghi1")).toBeNull();
  });

  it("accepts a compliant passphrase", () => {
    expect(passwordError("Correct horse battery staple 1")).toBeNull();
  });

  it("rejects a password shorter than the minimum", () => {
    expect(passwordError("Abcdefg1".slice(0, PASSWORD_MIN_LENGTH - 1))).toMatch(
      /at least/i
    );
  });

  it("rejects an empty password", () => {
    expect(passwordError("")).toMatch(/at least/i);
  });

  // The specific weak passwords the 2026-07-15 DAST demonstrated as accepted.
  it.each(["123456", "password", "12345678"])("rejects %s", (pw) => {
    expect(passwordError(pw)).not.toBeNull();
  });

  it("rejects a long all-lowercase wordlist entry", () => {
    // Long enough to pass any length floor, but a top-wordlist password. With
    // no HIBP on the free tier, the character classes are the only thing
    // catching this — the main reason they are enabled at all.
    expect(passwordError("password1234")).toMatch(/uppercase/i);
  });

  it("documents the cost: an all-lowercase passphrase is rejected", () => {
    // "correct horse battery staple" is strong by entropy and this rule turns
    // it away, while "Password12" above passes. That is the known trade-off of
    // composition rules (NIST SP 800-63B). Kept as a test so the cost is
    // explicit rather than folklore: if leaked-password protection is ever
    // enabled (Pro tier), drop the classes and this expectation flips back to
    // toBeNull().
    expect(passwordError("correct horse battery staple")).toMatch(/uppercase/i);
  });
});
