import type { MetadataRoute } from "next";

/**
 * VULN-14 (DAST): the app had no robots.txt. FAST SOCIO is a private,
 * authentication-gated campus app — none of its routes should be crawled or
 * indexed, so we disallow all user agents. Next.js App Router serves this at
 * /robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
