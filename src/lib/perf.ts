/**
 * Timing for the phases that decide how fast a tab switch feels.
 *
 * WHAT CHANGED (audit F14). This used to be `const enabled = NODE_ENV ===
 * "development"`, i.e. compiled to nothing in production. The privacy reasoning
 * behind that was sound but the conclusion was too strong: the audit could not
 * answer basic questions — how long the proxy takes, how long a Supabase round
 * trip takes, which layout query is the slow one — because the only code that
 * measured them was switched off exactly where the answers live.
 *
 * So it now runs in production too, SAMPLED. Everything the privacy argument
 * relied on still holds by construction:
 *
 *   - The only things recorded are a hard-coded label and a duration. Never a
 *     row, a user id, a token, a signed URL, or a query.
 *   - Labels are literals written by us at the call site ("layout:shell",
 *     "home:feed"), never interpolated from data.
 *   - Nothing is sent anywhere. It writes to stdout, which on the VPS means
 *     `docker compose logs` with the json-file rotation already configured.
 *
 * A 1% rate on a hot path still yields plenty of observations while keeping log
 * volume trivial. Set PERF_SAMPLE_RATE=1 temporarily to capture everything
 * while chasing something specific; 0 disables it entirely without a deploy.
 * See the note on `everyN` below for why the sampler counts rather than rolls.
 */
const isDev = process.env.NODE_ENV === "development";

/** Fraction of calls to log: all of them in dev, 1% in production by default. */
const sampleRate = (() => {
  const raw = process.env.PERF_SAMPLE_RATE;
  if (raw !== undefined) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return isDev ? 1 : 0.01;
})();

/**
 * Sampling is COUNTER-BASED, not random, and that is not a stylistic choice.
 *
 * Under Cache Components, Next patches `Math.random()` in the server runtime
 * (see next/dist/server/node-environment-extensions/random.js) and throws
 * during prerendering: "used `Math.random()` before accessing either uncached
 * data or Request data". A prerender has to be deterministic, and this helper
 * wraps calls that happen inside prerendered Server Components — so a random
 * draw here breaks `next build` outright. It did: /chat failed to prerender.
 *
 * `performance.now()` is fine and is what the timing below uses. Next patches
 * `Date.now()` but deliberately leaves `performance` alone, documenting in that
 * same extension that `performance.now()` is the right tool for measuring
 * durations. Do not "simplify" it back to Date.now().
 *
 * A counter is also just better here. At a 1% rate on a path that runs a few
 * hundred times an hour, random sampling might yield nothing for a while;
 * every-Nth guarantees a steady trickle. Counters are per-label so a rare path
 * is sampled on its own schedule instead of being crowded out by a hot one.
 * The counter only ever gates a `console.log` — never the returned value — so
 * render output stays deterministic regardless of call order.
 */
const everyN = sampleRate > 0 ? Math.max(1, Math.round(1 / sampleRate)) : 0;
const counters = new Map<string, number>();

function shouldLog(label: string): boolean {
  if (everyN === 0) return false;
  const next = (counters.get(label) ?? 0) + 1;
  counters.set(label, next % everyN);
  return next % everyN === 1 % everyN;
}

/**
 * One measured phase: a label we chose and how long it took.
 *
 * Timings are passed explicitly from the code that measures to the code that
 * emits the header — there is deliberately no module-level "current request"
 * accumulator. Concurrent requests share this module, so a mutable per-request
 * store here would interleave one user's phases into another user's header.
 * The proxy (lib/supabase/middleware.ts) collects its own array locally and
 * sets `Server-Timing` on the response it returns.
 */
export type Timing = { label: string; ms: number };

// PromiseLike, not Promise: a Supabase query builder is thenable but is not an
// actual Promise, so requiring one would force a pointless `Promise.resolve()`
// (or an await) at every call site.
export async function timed<T>(
  label: string,
  fn: () => PromiseLike<T>
): Promise<T> {
  if (!shouldLog(label)) return fn();
  const started = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - started);
    console.log(`[perf] ${label} ${ms}ms`);
  }
}

/**
 * Measure one awaited step and return both the value and its duration, for
 * callers that want to put the number in a `Server-Timing` header rather than
 * (or as well as) a log line. Always measures — the caller decides what to do
 * with it — so use it on paths that are already doing real work.
 */
export async function measure<T>(
  label: string,
  fn: () => PromiseLike<T>
): Promise<{ value: T; timing: Timing }> {
  const started = performance.now();
  const value = await fn();
  return { value, timing: { label, ms: Math.round(performance.now() - started) } };
}

/**
 * Render a `Server-Timing` header value from measured phases.
 *
 * Safe to expose: the labels are ours and the durations are aggregate. This is
 * the standard header browsers surface in the network panel's Timing tab, so
 * it needs no client code to be useful, and synthetic monitoring can read it.
 */
export function serverTimingHeader(timings: Timing[]): string {
  return timings
    .map(({ label, ms }) => `${label.replace(/[^a-zA-Z0-9_-]/g, "_")};dur=${ms}`)
    .join(", ");
}
