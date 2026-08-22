/**
 * Dev-only timing for the phases that decide how fast a tab switch feels.
 *
 * Compiled to a no-op in production — `process.env.NODE_ENV` is inlined at
 * build time, so the `if` folds away and the callback is never referenced.
 * Nothing here logs a value: only a label and a duration, never a row, a user
 * id, a token or a signed URL, so it is safe to leave in place.
 *
 * Usage:
 *   const posts = await timed("home:feed", () => query());
 */
const enabled = process.env.NODE_ENV === "development";

// PromiseLike, not Promise: a Supabase query builder is thenable but is not an
// actual Promise, so requiring one would force a pointless `Promise.resolve()`
// (or an await) at every call site.
export async function timed<T>(
  label: string,
  fn: () => PromiseLike<T>
): Promise<T> {
  if (!enabled) return fn();
  const started = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - started);
    // eslint-disable-next-line no-console
    console.log(`[perf] ${label} ${ms}ms`);
  }
}
