/**
 * URL-safety helpers (audit Phase 2).
 *
 * Pure functions so they are unit-testable without a server. Used to (a) stop
 * open redirects on post-auth `next` params and (b) validate that stored media
 * URLs actually point at this app's own Supabase storage.
 */

/**
 * Return a safe local redirect path derived from an untrusted `next` value.
 * Only same-site absolute paths are allowed; anything that could send the user
 * off-domain (protocol-relative `//host`, backslash tricks, a scheme, or an
 * `@host` authority once concatenated to the origin) falls back to `/home`.
 */
export function safeNextPath(next: unknown, fallback = "/home"): string {
  if (typeof next !== "string" || next.length === 0) return fallback;
  // Must be an absolute path on this site…
  if (next[0] !== "/") return fallback;
  // …but not protocol-relative or a backslash-smuggled host.
  if (next[1] === "/" || next[1] === "\\") return fallback;
  // No control chars / whitespace that browsers may normalize into a host.
  if (/[\x00-\x1f\x7f\\]/.test(next)) return fallback;
  // Defence in depth: it must parse as a same-origin URL.
  try {
    const u = new URL(next, "https://internal.invalid");
    if (u.origin !== "https://internal.invalid") return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

/**
 * True if `url` is a public object URL served by this project's own object
 * storage. `baseUrl` defaults to the configured Contabo public base URL.
 *
 * Callers use this to refuse a client-supplied media URL before persisting it,
 * so it must stay an exact prefix match: anything looser (a `.includes()`, or
 * accepting any https URL) would let a caller store a URL pointing at somebody
 * else's host and have the app render it as if it were ours.
 */
export function isAppStorageUrl(
  url: unknown,
  baseUrl: string | undefined = process.env.NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL
): boolean {
  if (typeof url !== "string" || !baseUrl) return false;
  return url.startsWith(`${baseUrl.replace(/\/$/, "")}/`);
}
