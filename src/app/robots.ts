import type { MetadataRoute } from "next";

/**
 * VULN-14 (DAST): the app had no robots.txt. FAST SOCIO is a private,
 * authentication-gated campus app — none of its routes should be crawled or
 * indexed, so the default is disallow-everything.
 *
 * The only exception is four static, unauthenticated informational pages
 * (/privacy, /terms, /about, /support — see src/app/(public)/) that are
 * intentionally public and fine to index. Per the robots.txt spec (and every
 * major crawler's implementation), when multiple rules could match a path,
 * the MOST SPECIFIC (longest) matching path wins regardless of listed order —
 * so a longer `Allow: /privacy` beats the shorter `Disallow: /` for that
 * path, while every other route still falls through to the blanket
 * disallow. No authenticated app route (feed, chat, profile, admin, etc.)
 * should ever become indexable through this file — if you add another public
 * page, add its exact path here explicitly; do not loosen the blanket rule.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
        allow: ["/privacy", "/terms", "/about", "/support"],
      },
    ],
  };
}
