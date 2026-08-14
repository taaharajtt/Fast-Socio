import { describe, expect, it } from "vitest";
import {
  MAX_SEARCH_TERM_LENGTH,
  escapeSearchTerm,
  ilikeContains,
  orIlike,
} from "./search";

/**
 * The property that actually matters: whatever comes out of escapeSearchTerm
 * cannot change the SHAPE of the PostgREST filter it is interpolated into.
 * Everything else in this file is a specific instance of that.
 */
const STRUCTURAL = [",", "(", ")", "%", "*", "_", "\\", '"', "'", "`"];

describe("escapeSearchTerm", () => {
  it("leaves ordinary names untouched", () => {
    expect(escapeSearchTerm("Ali Raza")).toBe("Ali Raza");
    expect(escapeSearchTerm("Zainab")).toBe("Zainab");
  });

  it("leaves roll numbers untouched", () => {
    // Usernames are the campus roll number and are searched on every admin page.
    expect(escapeSearchTerm("i232064")).toBe("i232064");
    expect(escapeSearchTerm("i245681")).toBe("i245681");
  });

  it("trims and collapses surrounding whitespace", () => {
    expect(escapeSearchTerm("   Ali    Raza  ")).toBe("Ali Raza");
    expect(escapeSearchTerm("\t\nAli\r\nRaza\t")).toBe("Ali Raza");
  });

  it("returns empty string for non-strings and blank input", () => {
    expect(escapeSearchTerm(undefined)).toBe("");
    expect(escapeSearchTerm(null)).toBe("");
    expect(escapeSearchTerm(42)).toBe("");
    expect(escapeSearchTerm({})).toBe("");
    expect(escapeSearchTerm("")).toBe("");
    expect(escapeSearchTerm("     ")).toBe("");
  });

  it("removes every character with meaning in the filter grammar", () => {
    for (const char of STRUCTURAL) {
      expect(escapeSearchTerm(char)).toBe("");
      expect(escapeSearchTerm(`a${char}b`)).toBe("a b");
    }
  });

  it("neutralizes a comma used to graft on an extra condition", () => {
    // Without escaping this would append a second filter to the or() group.
    expect(escapeSearchTerm("a,is_banned.eq.true")).toBe("a is banned.eq.true");
    expect(escapeSearchTerm("x,admin_role.eq.super_admin")).not.toContain(",");
  });

  it("neutralizes parentheses that would unbalance the group", () => {
    expect(escapeSearchTerm("a),or(id.not.is.null")).not.toMatch(/[()]/);
  });

  it("neutralizes LIKE wildcards so a term cannot match every row", () => {
    expect(escapeSearchTerm("%")).toBe("");
    expect(escapeSearchTerm("%%%")).toBe("");
    expect(escapeSearchTerm("_")).toBe("");
    expect(escapeSearchTerm("a%b")).toBe("a b");
  });

  it("strips control characters, zero-width marks and the BOM", () => {
    const ch = (code: number) => String.fromCharCode(code);
    expect(escapeSearchTerm(`a${ch(0x00)}b`)).toBe("a b"); // NUL
    expect(escapeSearchTerm(`a${ch(0x1b)}b`)).toBe("a b"); // ESC
    expect(escapeSearchTerm(`a${ch(0x7f)}b`)).toBe("a b"); // DEL
    expect(escapeSearchTerm(`a${ch(0x200b)}b`)).toBe("a b"); // zero-width space
    expect(escapeSearchTerm(`a${ch(0x202e)}b`)).toBe("a b"); // RTL override
    expect(escapeSearchTerm(`a${ch(0x2028)}b`)).toBe("a b"); // line separator
    expect(escapeSearchTerm(`${ch(0xfeff)}Ali`)).toBe("Ali"); // BOM
  });

  it("caps the term length", () => {
    const long = "a".repeat(5000);
    expect(escapeSearchTerm(long)).toHaveLength(MAX_SEARCH_TERM_LENGTH);
  });

  it("never leaves a trailing space after truncation", () => {
    const term = `${"a".repeat(MAX_SEARCH_TERM_LENGTH - 1)} bbbb`;
    const out = escapeSearchTerm(term);
    expect(out).toBe(out.trim());
    expect(out.length).toBeLessThanOrEqual(MAX_SEARCH_TERM_LENGTH);
  });

  it("preserves non-ASCII names", () => {
    expect(escapeSearchTerm("علی")).toBe("علی");
    expect(escapeSearchTerm("Zoë")).toBe("Zoë");
    expect(escapeSearchTerm("محمد رضا")).toBe("محمد رضا");
  });

  it("preserves characters that are harmless in the value position", () => {
    // The value is the tail of `column.operator.value`, so dots, dashes, @ and
    // + are not separators once we are past the operator.
    expect(escapeSearchTerm("a.b")).toBe("a.b");
    expect(escapeSearchTerm("al-rehman")).toBe("al-rehman");
    expect(escapeSearchTerm("a@b")).toBe("a@b");
  });

  it("is idempotent", () => {
    for (const input of ["Ali, Raza (x)%", "i232064", "  a  b  ", "%%%"]) {
      const once = escapeSearchTerm(input);
      expect(escapeSearchTerm(once)).toBe(once);
    }
  });
});

describe("orIlike", () => {
  it("builds the filter for the common two-column name/roll search", () => {
    expect(orIlike(["full_name", "username"], "Ali")).toBe(
      "full_name.ilike.%Ali%,username.ilike.%Ali%",
    );
  });

  it("builds a single-column filter", () => {
    expect(orIlike(["title"], "lab")).toBe("title.ilike.%lab%");
  });

  it("returns null rather than a match-everything filter", () => {
    expect(orIlike(["full_name", "username"], "")).toBeNull();
    expect(orIlike(["full_name", "username"], "   ")).toBeNull();
    expect(orIlike(["full_name", "username"], "%")).toBeNull();
    expect(orIlike(["full_name", "username"], null)).toBeNull();
    expect(orIlike(["full_name", "username"], undefined)).toBeNull();
  });

  it("honours a minimum length", () => {
    expect(orIlike(["full_name"], "a", { minLength: 2 })).toBeNull();
    expect(orIlike(["full_name"], "ab", { minLength: 2 })).toBe(
      "full_name.ilike.%ab%",
    );
  });

  it("produces a filter with exactly one comma per extra column", () => {
    // The structural invariant: a hostile term must not add conditions.
    const hostile = "a,b,c,d,e,(f),%g%";
    const filter = orIlike(["full_name", "username"], hostile);
    expect(filter).not.toBeNull();
    expect(filter!.split(",")).toHaveLength(2);
    expect(filter!.match(/\.ilike\./g)).toHaveLength(2);
  });

  it("keeps the filter well-formed for every structural character", () => {
    for (const char of STRUCTURAL) {
      const filter = orIlike(["full_name", "username"], `Ali${char}Raza`);
      expect(filter).toBe(
        "full_name.ilike.%Ali Raza%,username.ilike.%Ali Raza%",
      );
    }
  });

  it("rejects unsafe column names as a programming error", () => {
    expect(() => orIlike(["full_name; drop"], "a")).toThrow(/unsafe column/);
    expect(() => orIlike(["Full_Name"], "a")).toThrow(/unsafe column/);
    expect(() => orIlike(["*"], "a")).toThrow(/unsafe column/);
    expect(() => orIlike([], "a")).toThrow(/at least one column/);
  });

  it("validates columns even when the term is unusable", () => {
    // Otherwise a bad identifier would only surface for some inputs.
    expect(() => orIlike(["bad name"], "")).toThrow(/unsafe column/);
  });
});

describe("ilikeContains", () => {
  it("wraps a safe term in wildcards", () => {
    expect(ilikeContains("CS")).toBe("%CS%");
    expect(ilikeContains(" cs101 ")).toBe("%cs101%");
  });

  it("returns null for unusable terms", () => {
    expect(ilikeContains("")).toBeNull();
    expect(ilikeContains("%")).toBeNull();
    expect(ilikeContains(undefined)).toBeNull();
  });

  it("contains exactly the two wildcards it added", () => {
    expect(ilikeContains("a%b%c")!.match(/%/g)).toHaveLength(2);
  });
});
