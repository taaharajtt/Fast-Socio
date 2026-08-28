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
   * `swe-worker-*.js` is the same class of bug, found 2026-08-28: next-pwa
   * emits it alongside sw.js, but only sw.js and workbox-* were excluded, so
   * the worker answered `307 -> /login` and the browser refused to execute it
   * ("MIME type ('text/html') is not executable"). That is the worker backing
   * `cacheOnFrontEndNav` / `aggressiveFrontEndNavCaching` in next.config.ts —
   * both were switched on but had never actually worked, so every client-side
   * navigation went to the server that the option exists to avoid.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|sw.js|swe-worker-.*|workbox-.*|icons/.*|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
