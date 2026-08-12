/**
 * The app's canonical public origin.
 *
 * Route handlers used to derive their redirect origin from `request.url`. On
 * Vercel that was fine. Behind Caddy the Node process sees the INTERNAL
 * request (http://app:3000), so a magic-link confirmation would redirect the
 * user to an address that does not exist outside the Docker network — auth
 * appears to succeed and then dead-ends.
 *
 * Configuring the origin explicitly removes the guesswork entirely, and has a
 * second benefit: an attacker cannot steer a redirect by forging a Host header,
 * because we never read one.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  // Local dev fallback only. In production this variable is required — see
  // deploy/contabo/docker-compose.yml, where it is passed into the container.
  return "http://localhost:3000";
}
