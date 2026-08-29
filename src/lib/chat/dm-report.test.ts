import { describe, expect, it } from "vitest";
import {
  DISCLOSURE_NOTICE,
  DM_REPORT_CATEGORIES,
  MAX_DESCRIPTION_LENGTH,
  MAX_REPORT_MESSAGES,
  MIN_DESCRIPTION_LENGTH,
  canDisclose,
  evidenceSummary,
  isDmReportCategory,
  normalizeSelection,
  undisclosableReason,
  validateDescription,
  validateSelection,
} from "@/lib/chat/dm-report";

/**
 * These cover the client-side affordances only. The security properties they
 * mirror — the 1..10 bound, cross-conversation ids, trusted sender/timestamp
 * copying, the daily cap, the duplicate guard, evidence immutability, and the
 * fact that admins can no longer reach a transcript — live in SQL and are
 * verified by supabase/tests/dm_reporting_verification.sql, which needs a real
 * database. Passing this file proves the UI will not *offer* an invalid
 * report; it does not prove the server would refuse one.
 */

describe("selection bounds", () => {
  it("rejects an empty selection", () => {
    const r = validateSelection(0);
    expect(r.ok).toBe(false);
  });

  it("accepts 1 through 10", () => {
    for (let n = 1; n <= MAX_REPORT_MESSAGES; n++) {
      expect(validateSelection(n).ok).toBe(true);
    }
  });

  it("rejects 11", () => {
    const r = validateSelection(11);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("10");
  });
});

describe("normalizeSelection", () => {
  it("deduplicates before capping, so repeats do not eat the budget", () => {
    const ids = ["a", "a", "a", "b", "c"];
    expect(normalizeSelection(ids)).toEqual(["a", "b", "c"]);
  });

  it("caps at the maximum", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `m${i}`);
    expect(normalizeSelection(ids)).toHaveLength(MAX_REPORT_MESSAGES);
  });

  it("preserves order", () => {
    expect(normalizeSelection(["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(normalizeSelection([])).toEqual([]);
  });
});

describe("description limits", () => {
  it("rejects a description that is too short", () => {
    expect(validateDescription("too short").ok).toBe(false);
  });

  it("does not let whitespace pad to the minimum", () => {
    const padded = "abc" + " ".repeat(MIN_DESCRIPTION_LENGTH);
    expect(padded.length).toBeGreaterThan(MIN_DESCRIPTION_LENGTH);
    expect(validateDescription(padded).ok).toBe(false);
  });

  it("accepts a description at the minimum", () => {
    expect(validateDescription("x".repeat(MIN_DESCRIPTION_LENGTH)).ok).toBe(true);
  });

  it("rejects a description over the maximum", () => {
    expect(
      validateDescription("x".repeat(MAX_DESCRIPTION_LENGTH + 1)).ok,
    ).toBe(false);
  });
});

describe("categories", () => {
  it("accepts every advertised category value", () => {
    for (const c of DM_REPORT_CATEGORIES) {
      expect(isDmReportCategory(c.value)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isDmReportCategory("harassment; drop table")).toBe(false);
    expect(isDmReportCategory("")).toBe(false);
    expect(isDmReportCategory(null)).toBe(false);
    expect(isDmReportCategory(42)).toBe(false);
  });
});

describe("disclosability", () => {
  it("refuses a deleted message and explains why", () => {
    const m = { id: "abc", deleted_at: "2026-08-01T00:00:00Z" };
    expect(canDisclose(m)).toBe(false);
    expect(undisclosableReason(m)).toContain("deleted");
  });

  it("refuses an optimistic row that has no server id yet", () => {
    const m = { id: "temp-123", deleted_at: null };
    expect(canDisclose(m)).toBe(false);
    expect(undisclosableReason(m)).toContain("still sending");
  });

  it("allows an ordinary message", () => {
    expect(canDisclose({ id: "real-id", deleted_at: null })).toBe(true);
  });
});

describe("evidenceSummary", () => {
  const base = { body: null, attachment_type: null, shared_post_id: null };

  it("prefers the body", () => {
    expect(evidenceSummary({ ...base, body: "hello" })).toBe("hello");
  });

  it("falls through a whitespace-only body to the attachment", () => {
    expect(
      evidenceSummary({ ...base, body: "   ", attachment_type: "image" }),
    ).toBe("Photo attachment");
  });

  it("names a voice note", () => {
    expect(evidenceSummary({ ...base, attachment_type: "voice" })).toBe(
      "Voice note",
    );
  });

  it("names a shared post", () => {
    expect(evidenceSummary({ ...base, shared_post_id: "p1" })).toBe(
      "Shared post",
    );
  });

  it("does not render an empty string for an empty message", () => {
    expect(evidenceSummary(base)).toBe("Empty message");
  });
});

describe("disclosure notice", () => {
  it("is the exact wording the product committed to", () => {
    expect(DISCLOSURE_NOTICE).toBe(
      "The selected messages, their senders, timestamps, and your description " +
        "will be shared with FAST SOCIO moderators. No other messages from " +
        "this conversation will be shared.",
    );
  });
});
