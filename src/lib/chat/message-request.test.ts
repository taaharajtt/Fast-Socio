import { describe, expect, it } from "vitest";
import {
  MESSAGE_REQUEST_MAX,
  messageRequestError,
  messageRequestRemaining,
  validateMessageRequest,
} from "@/lib/chat/message-request";

/**
 * UAT-01 boundaries. The cases here are the ones named in the acceptance
 * criteria — 0, 1, 250 and 251 characters — plus the two that decide whether
 * those numbers mean anything: whether length is measured before or after
 * trimming, and whether both entry points can disagree about it.
 *
 * They cannot: there is one validator, and `send_message_request` (mig 0178)
 * applies the identical 1..250 rule in SQL, so a caller bypassing the UI is
 * held to the same bound.
 */
describe("message request length", () => {
  it("rejects an empty message (0 characters)", () => {
    const r = validateMessageRequest("");
    expect(r.ok).toBe(false);
  });

  it("rejects whitespace-only, which is 0 characters once trimmed", () => {
    // Not a nitpick: without trimming, "   " passes a `length >= 1` check and
    // lands in someone's Requests panel as a blank opening line.
    expect(validateMessageRequest("   \n\t ").ok).toBe(false);
  });

  it("accepts exactly 1 character", () => {
    const r = validateMessageRequest("h");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("h");
  });

  it("accepts exactly 250 characters", () => {
    const r = validateMessageRequest("a".repeat(250));
    expect(r.ok).toBe(true);
  });

  it("rejects 251 characters", () => {
    const r = validateMessageRequest("a".repeat(251));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("250");
  });

  it("measures the TRIMMED length, so 250 plus a trailing newline is fine", () => {
    // The trimmed text is what gets stored, so validating the untrimmed string
    // would reject a message that is exactly at the limit once stored.
    expect(validateMessageRequest("a".repeat(250) + "\n").ok).toBe(true);
  });

  it("returns the trimmed text, which is what the RPC will store", () => {
    const r = validateMessageRequest("  hey there  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("hey there");
  });

  it("counts down from the cap and never goes negative", () => {
    expect(messageRequestRemaining("")).toBe(MESSAGE_REQUEST_MAX);
    expect(messageRequestRemaining("abc")).toBe(MESSAGE_REQUEST_MAX - 3);
    expect(messageRequestRemaining("a".repeat(400))).toBe(0);
  });
});

describe("message request error mapping", () => {
  it("keeps block and unavailable-account indistinguishable", () => {
    // Deliberate: distinct copy would let a sender probe whether they have been
    // blocked by comparing the two messages.
    expect(messageRequestError("that account is not available")).toBe(
      "That account is not available."
    );
  });

  it("names the limit when the database rejects the length", () => {
    expect(messageRequestError("message must be 1-250 characters")).toContain(
      "250"
    );
  });

  it("explains a self-request", () => {
    expect(
      messageRequestError("you cannot send a request to yourself")
    ).toContain("yourself");
  });

  it("falls back to something actionable for an unknown failure", () => {
    // Never surfaces a raw Postgres string to a student.
    const msg = messageRequestError("23505: duplicate key value violates …");
    expect(msg).not.toContain("23505");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("survives a missing error message", () => {
    expect(messageRequestError(null)).toBeTruthy();
    expect(messageRequestError(undefined)).toBeTruthy();
  });
});
