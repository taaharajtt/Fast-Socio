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
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|sw.js|workbox-.*|icons/.*|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
