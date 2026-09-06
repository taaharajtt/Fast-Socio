import type { MessageCursor } from "@/lib/chat/message-merge";

/**
 * The keyset predicate, expressed once, in PostgREST's filter grammar.
 *
 * "Strictly older than the cursor" over the pair `(created_at, id)` is:
 *
 *     created_at < c  OR  (created_at = c AND id < i)
 *
 * which PostgREST spells as an `or=(…)` group with a nested `and(…)`. This is
 * the exact lexicographic order `compareMessages` sorts by, so the rows the
 * database excludes are precisely the rows already on screen — no gap, no
 * repeat, and no dependence on `created_at` being unique.
 *
 * WHY THE VALUES ARE QUOTED. A timestamptz renders as
 * `2026-07-14T18:15:46.842105+00:00`, and unquoted it contains characters
 * PostgREST's filter parser treats structurally — the `+` most importantly,
 * which decodes to a space. Double-quoting makes the whole thing one literal.
 * Verified against a live PostgREST before this was built on: unquoted the
 * predicate is a parse error, quoted it returns exactly the older rows and
 * never the anchor itself.
 *
 * The embedded double-quote guard is not paranoia about SQL — PostgREST
 * parameterises — but about the FILTER string: a value containing `"` would end
 * the literal early and change which rows come back. A uuid and an ISO
 * timestamp can never contain one, so a value that does is a programming error
 * and is rejected rather than silently reinterpreted.
 */
export function olderThanFilter(cursor: MessageCursor): string {
  const at = literal(cursor.createdAt);
  const id = literal(cursor.id);
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`;
}

function literal(value: string): string {
  if (value.includes('"')) {
    throw new Error("keyset cursor value contains a quote");
  }
  return `"${value}"`;
}
