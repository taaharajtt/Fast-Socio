/**
 * One place to build PostgREST text-search filters from untrusted input.
 *
 * PostgREST's `or()` argument is its own little grammar, not SQL:
 *
 *     or=(full_name.ilike.%ali%,username.ilike.%ali%)
 *
 * The value is the tail of a dot-separated triple, and the whole expression is
 * comma-separated and parenthesis-nested. So a raw user term can do several
 * distinct things, none of which are SQL injection but all of which are bugs:
 *
 *   1. `,` ends the current condition and starts another one, letting a
 *      searcher graft an extra filter onto the query (`a,is_banned.eq.true`).
 *   2. `(` / `)` unbalance the grouping, so the request 400s — a trivial DoS on
 *      the search box, and on admin pages a way to make search unusable.
 *   3. `%`, `*` and `_` are wildcards. `%` alone matches every row, which turns
 *      a scoped lookup into a full-table scan.
 *   4. `"` opens PostgREST's quoted-value form and swallows the rest.
 *
 * Three copies of an ad-hoc `replace(/[,()*%\\]/g, " ")` had grown across the
 * codebase, and two call sites (the admin user list and admin broadcast
 * recipient search) had no escaping at all. This module is the single
 * implementation; call sites should not hand-roll their own.
 *
 * Pure string logic — no imports, no `server-only` — so it is usable from
 * server actions, route handlers and server components alike, and is unit
 * tested in ./search.test.ts.
 */

/**
 * Longest search term we will send to PostgREST.
 *
 * Nothing in this app has a searchable name or roll number near this length
 * (roll numbers are 7 characters, `full_name` is a short display name), so the
 * cap only ever truncates abuse. It matters because `ilike '%<term>%'` cannot
 * use an index: an unbounded term is unbounded work per request, repeated for
 * every column in the `or()`.
 */
export const MAX_SEARCH_TERM_LENGTH = 64;

/** Shortest term worth querying. Below this, callers should return no results. */
export const MIN_SEARCH_TERM_LENGTH = 1;

/**
 * Characters that carry meaning in the PostgREST filter grammar or in LIKE.
 * Replaced with a space rather than deleted: deleting would silently join
 * neighbouring words ("a,b" -> "ab", which matches nothing), while a space
 * keeps the term readable and still harmless.
 */
const GRAMMAR_CHARS = /[,()*%_\\"'`]/g;

/**
 * C0 and C1 control characters, the Unicode line/paragraph separators, and the
 * zero-width / bidi-override / BOM characters. Mapped to a space so a term
 * cannot smuggle an invisible payload past a log line or a code review.
 *
 * Written as a code-point predicate rather than a regex literal on purpose:
 * a character class of raw control bytes is unreadable and easy to corrupt in
 * an editor, and the escaped form is just as easy to get subtly wrong.
 */
function isInvisible(codePoint: number): boolean {
  return (
    codePoint <= 0x1f || // C0 controls, incl. NUL, CR, LF
    (codePoint >= 0x7f && codePoint <= 0x9f) || // DEL + C1 controls
    (codePoint >= 0x200b && codePoint <= 0x200f) || // zero-width + bidi marks
    (codePoint >= 0x2028 && codePoint <= 0x202e) || // separators + bidi overrides
    codePoint === 0xfeff // BOM / zero-width no-break space
  );
}

/** Replace every invisible code point with a plain space. */
function stripInvisible(input: string): string {
  let out = "";
  for (const char of input) {
    out += isInvisible(char.codePointAt(0) ?? 0) ? " " : char;
  }
  return out;
}

/** Any run of whitespace, collapsed to a single space. */
const WHITESPACE_RUN = /\s+/g;

/**
 * Make an arbitrary value safe to interpolate into a PostgREST `ilike` pattern.
 *
 * Returns `""` when there is nothing usable left — callers MUST treat that as
 * "apply no filter at all" or "return no results", and must never fall back to
 * the raw input.
 */
export function escapeSearchTerm(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return (
    stripInvisible(raw)
      .replace(GRAMMAR_CHARS, " ")
      .replace(WHITESPACE_RUN, " ")
      .trim()
      .slice(0, MAX_SEARCH_TERM_LENGTH)
      // Slicing can leave a trailing space if the cut landed mid-gap.
      .trim()
  );
}

/** Column identifiers we are willing to embed. Developer-supplied, asserted anyway. */
const COLUMN_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Build the argument for `.or(...)` matching `term` against every column with
 * a case-insensitive contains, or `null` if the term is unusable.
 *
 * `null` — rather than a filter that matches everything — is deliberate: it
 * forces the call site to decide explicitly what an empty search means, and
 * makes "no filter" impossible to reach by accident.
 *
 *     const filter = orIlike(["full_name", "username"], input);
 *     if (filter) query = query.or(filter);
 */
export function orIlike(
  columns: readonly string[],
  term: unknown,
  { minLength = MIN_SEARCH_TERM_LENGTH }: { minLength?: number } = {},
): string | null {
  if (columns.length === 0) {
    throw new Error("orIlike: at least one column is required");
  }
  for (const column of columns) {
    // A bad identifier here is a programming error, not user input, so throwing
    // is right: it surfaces in development instead of shipping a broken filter.
    if (!COLUMN_NAME.test(column)) {
      throw new Error(`orIlike: unsafe column name ${JSON.stringify(column)}`);
    }
  }

  const safe = escapeSearchTerm(term);
  if (safe.length < minLength) return null;

  return columns.map((column) => `${column}.ilike.%${safe}%`).join(",");
}

/**
 * The `%term%` body for a single-column `.ilike(column, pattern)` call, or
 * `null` when the term is unusable. Same contract as {@link orIlike}.
 */
export function ilikeContains(
  term: unknown,
  { minLength = MIN_SEARCH_TERM_LENGTH }: { minLength?: number } = {},
): string | null {
  const safe = escapeSearchTerm(term);
  if (safe.length < minLength) return null;
  return `%${safe}%`;
}
