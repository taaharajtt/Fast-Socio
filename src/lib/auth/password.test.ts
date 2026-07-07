import { describe, it, expect } from "vitest";
import { passwordError, isValidPassword, PASSWORD_MIN_LENGTH } from "./password";

// UX-level password gate. The authoritative minimum is enforced by Supabase Auth;
// these pin the inline-feedback rule shared by signup + reset-password.
describe("passwordError", () => {
  it("accepts a password at or above the minimum length", () => {
    expect(passwordError("a".repeat(PASSWORD_MIN_LENGTH))).toBeNull();
    expect(passwordError("correct horse battery")).toBeNull();
    expect(isValidPassword("hunter2!!")).toBe(true);
  });

  it("rejects passwords shorter than the minimum", () => {
    expect(passwordError("short")).toContain(String(PASSWORD_MIN_LENGTH));
    expect(isValidPassword("1234567")).toBe(false);
  });

  it("rejects an all-whitespace password of sufficient length", () => {
    expect(passwordError(" ".repeat(PASSWORD_MIN_LENGTH))).toBe(
      "Password can't be blank."
    );
  });

  it("rejects an empty password", () => {
    expect(isValidPassword("")).toBe(false);
  });
});
