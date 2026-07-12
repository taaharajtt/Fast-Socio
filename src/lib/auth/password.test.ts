import { describe, it, expect } from "vitest";
import { passwordError, PASSWORD_MIN_LENGTH } from "./password";

describe("passwordError", () => {
  it("accepts a password at the minimum length", () => {
    expect(passwordError("a".repeat(PASSWORD_MIN_LENGTH))).toBeNull();
  });

  it("accepts a longer password", () => {
    expect(passwordError("correct horse battery staple")).toBeNull();
  });

  it("rejects a password shorter than the minimum", () => {
    expect(passwordError("a".repeat(PASSWORD_MIN_LENGTH - 1))).toMatch(
      /at least/i
    );
  });

  it("rejects an empty password", () => {
    expect(passwordError("")).toMatch(/at least/i);
  });
});
