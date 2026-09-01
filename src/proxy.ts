import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /*
   * Run on all paths except static assets and the PWA artifacts, so the auth
   * session stays fresh on navigations without touching cached files.
   *
   * robots.txt is excluded for the same reason manifest.webmanifest is: it is a
   * generated metadata file, not a page, and it has no session to refresh.
   * Without the exclusion it fell through to the auth gate and answered
   * `307 -> /login` (verified in production 2026-08-17). A crawler that cannot
   * fetch robots.txt, or that follows the redirect and gets HTML, treats the
   * site as having no robots.txt at all — i.e. crawl everything — which is the
   * exact opposite of what src/app/robots.ts says, and silently undid the
   * VULN-14 fix.
   *
   * `push-sw.js` is the THIRD instance of this same bug, found 2026-09-01, and
   * the one the two fixes below kept missing: the exclusion list already held
   * `sw.js`, but that alternative is anchored at the start of the path, so it
   * never matched `push-sw.js`. Our Web Push handlers live in that file and the
   * generated worker pulls them in with `importScripts("/push-sw.js")` (see
   * workboxOptions in next.config.ts) — a fetch that DOES follow the auth gate.
   * Signed out, it answered `307 -> /login`, the import threw, and the whole
   * service worker install failed, costing that client every runtime cache the
   * worker provides. Measured in production over 24h before the fix: 40x 200,
   * 54x 304 and 9x 307, i.e. roughly one install in eleven was failing — the
   * ones that happened before the visitor signed in.
   *
   * `swe-worker-*.js` is the same class of bug, found 2026-08-28: next-pwa
   * emits it alongside sw.js, but only sw.js and workbox-* were excluded, so
   * the worker answered `307 -> /login` and the browser refused to execute it
   * ("MIME type ('text/html') is not executable"). That is the worker backing
   * `cacheOnFrontEndNav` / `aggressiveFrontEndNavCaching` in next.config.ts —
   * both were switched on but had never actually worked, so every client-side
   * navigation went to the server that the option exists to avoid.
   *
   * `monitoring` is the Sentry tunnel (tunnelRoute in next.config.ts), excluded
   * for TWO reasons (perf audit 2.4). It was falling through to the auth gate,
   * which meant (a) every browser error report from a signed-in user paid a JWT
   * verify plus a profiles query before being forwarded, and (b) — the actual
   * bug — a report from a SIGNED-OUT user was answered with `307 -> /login` and
   * silently discarded. Errors on /login and /signup, i.e. exactly the ones that
   * explain why someone could not get into the app, were never reaching Sentry.
   * It is an ingest endpoint, not a page: it has no session to refresh.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|push-sw.js|sw.js|swe-worker-.*|workbox-.*|monitoring|icons/.*|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
