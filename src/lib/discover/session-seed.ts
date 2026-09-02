/**
 * The Discover deck's per-session shuffle seed (UAT-15).
 *
 * THE PROBLEM. The deck's order is a pure function of the viewer and the data,
 * so opening the app on Tuesday showed the same people in the same order as
 * Monday. It reads as a broken feed even when the ranking is right.
 *
 * WHY NOT `ORDER BY random()`. The deck is keyset-paginated. Re-randomising on
 * every page means page two is drawn from a different permutation than page
 * one, which produces duplicates AND silently skipped candidates — the exact
 * failure the 0157 pagination work exists to prevent. It would also throw away
 * relevance completely.
 *
 * THE RULE. One seed per app session, generated once and then passed to every
 * page and refill of that session. `get_discover_candidates` (mig 0178) uses it
 * as a deterministic tie-break WITHIN a compatibility band, so:
 *
 *   * the same seed always yields the same order — pagination stays correct and
 *     the deck never repeats or skips a card mid-session;
 *   * a different seed yields a different order among comparably relevant
 *     people;
 *   * relevance survives, because the band is ranked before the hash.
 *
 * WHAT COUNTS AS A NEW SESSION IN A PWA. `sessionStorage`, and nothing else.
 * A PWA is rarely "closed" — it is backgrounded for days and resumed — so
 * elapsed time, page loads and `visibilitychange` all misfire. sessionStorage is
 * scoped to the tab/window session by the platform: it survives navigation and
 * reloads within one session (so a refresh does NOT reshuffle mid-browse, which
 * would cause the very duplicates we are avoiding) and is empty when the app is
 * opened fresh. A standalone PWA launch gets a new one.
 */

const KEY = "fs:discover:seed";

/**
 * The cookie the SERVER reads to order the first page.
 *
 * The first page of the deck is server-rendered, and a server component cannot
 * read `sessionStorage` — nor may it write a cookie during render in Next 16.
 * So the client owns the cookie and rotates it: on the first Discover open of a
 * session it ADOPTS whatever the server just used (so page one and every refill
 * of this session share one seed, which is what keeps pagination correct), and
 * writes a fresh value for the NEXT session to pick up.
 *
 * The value is an ordering input and nothing else — no identity, no state, no
 * security meaning — so `SameSite=Lax` on a year-long cookie is appropriate and
 * it is deliberately not `HttpOnly` (the client must rotate it).
 */
export const SEED_COOKIE = "fs_discover_seed";

/** Generate a fresh seed. Not security-sensitive — only an ordering input. */
export function newSessionSeed(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The seed for this app session, created on first use.
 *
 * `storage` is injectable so the behaviour is testable without a browser and
 * without a global mock — the tests drive a plain in-memory Storage.
 *
 * Every read is wrapped: `sessionStorage` THROWS (not returns null) in a
 * privacy-restricted context such as Safari with site data blocked, and a
 * Discover deck must not fail to render because ordering could not be
 * remembered. The fallback is a fresh per-call seed, which degrades to "shuffles
 * more often than intended" rather than to a blank screen.
 */
export function getSessionSeed(storage?: Storage | null): string {
  const store =
    storage ?? (typeof window !== "undefined" ? safeSessionStorage() : null);
  if (!store) return newSessionSeed();

  try {
    const existing = store.getItem(KEY);
    if (existing) return existing;
    const seed = newSessionSeed();
    store.setItem(KEY, seed);
    return seed;
  } catch {
    return newSessionSeed();
  }
}

/** Forget the current seed, so the next read starts a new shuffle. */
export function clearSessionSeed(storage?: Storage | null): void {
  const store =
    storage ?? (typeof window !== "undefined" ? safeSessionStorage() : null);
  try {
    store?.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * This session's seed, adopting the server's and rotating for the next one.
 *
 * Call it once, on the client, when Discover mounts. Idempotent within a
 * session: the second call returns the same value and rotates nothing.
 */
export function ensureSessionSeed(
  cookieSeed: string | null,
  storage?: Storage | null
): string {
  const store =
    storage ?? (typeof window !== "undefined" ? safeSessionStorage() : null);
  if (!store) return cookieSeed ?? newSessionSeed();

  try {
    const existing = store.getItem(KEY);
    if (existing) return existing;

    // First Discover open of this session.
    const seed = cookieSeed ?? newSessionSeed();
    store.setItem(KEY, seed);
    writeSeedCookie(newSessionSeed());
    return seed;
  } catch {
    return cookieSeed ?? newSessionSeed();
  }
}

/** Parse the seed cookie out of a `document.cookie`-style string. */
export function readSeedCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SEED_COOKIE && rest.length > 0) {
      const value = rest.join("=").trim();
      return value === "" ? null : decodeURIComponent(value);
    }
  }
  return null;
}

function writeSeedCookie(value: string): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${SEED_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* ordering falls back to the unseeded deck */
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
