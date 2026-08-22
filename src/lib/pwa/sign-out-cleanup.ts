/**
 * Purge browser-held state on sign-out (audit F4).
 *
 * WHY THIS EXISTS
 * The service worker's runtime caches are origin-scoped and outlive a session.
 * Before this, `aggressiveFrontEndNavCaching` stored authenticated HTML, RSC
 * payloads and Supabase reads in Cache Storage for 24 hours, and nothing ever
 * cleared them — so signing out left one user's rendered feed sitting on a
 * shared device for the next person to trip over.
 *
 * That specific hole is closed at the source: next.config.ts no longer caches
 * anything personalized. This function is the belt to that pair of braces. It
 * exists because the failure mode is silent and the blast radius is someone
 * else's private messages: if a future change re-adds a caching rule without
 * thinking it through, sign-out should still take the data with it.
 *
 * WHAT IT DELIBERATELY KEEPS
 * The workbox PRECACHE is left alone. It holds only the app shell — build
 * artefacts that are identical for every user and are exactly what makes the
 * next sign-in fast. Wiping it would make every sign-out cost a fresh ~1.3 MB
 * download for no privacy gain. Everything else goes, allow-list style: caches
 * are removed unless they are recognisably the precache, so a cache added later
 * under a name this file has never heard of is cleared rather than kept.
 *
 * Errors are swallowed on purpose. This runs while the user is already leaving;
 * a storage failure must not block the redirect to /login or surface a scary
 * message. Best-effort cleanup that sometimes no-ops is strictly better than a
 * sign-out that can fail.
 */

/** Cache names to preserve: the immutable, user-independent app shell. */
function isAppShellCache(name: string): boolean {
  return name.startsWith("workbox-precache");
}

export async function clearBrowserSessionState(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !isAppShellCache(n)).map((n) => caches.delete(n))
      );
    }
  } catch {
    // Storage unavailable (private mode, quota, permissions) — nothing to do.
  }
}
