/**
 * FAST NUCES email validation (UI Spec §5.1; gates Phase 1 auth).
 *
 * OQ-9 (open question): the exact set of valid domains is not yet finalized.
 * FAST NUCES issues student mail under `nu.edu.pk` (e.g. k21-1234@nu.edu.pk).
 * Keep the allow-list here so it is the single place to update once OQ-9 is
 * answered (e.g. if per-campus subdomains like khi.nu.edu.pk are used).
 */
export const ALLOWED_EMAIL_DOMAINS = ["nu.edu.pk"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dev-only allow-list of specific full email addresses that may sign in even
 * though they are off-domain (comma-separated in NEXT_PUBLIC_DEV_ALLOWED_EMAILS).
 * Used for dogfooding before the app is opened to real FAST students. Leave the
 * env var unset in production so only nu.edu.pk addresses pass.
 */
const DEV_ALLOWED_EMAILS = (process.env.NEXT_PUBLIC_DEV_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** True if `email` is well-formed and on an allowed FAST domain (or dev-listed). */
export function isValidFastEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  if (!EMAIL_RE.test(value)) return false;
  if (DEV_ALLOWED_EMAILS.includes(value)) return true;
  const domain = value.slice(value.lastIndexOf("@") + 1);
  return ALLOWED_EMAIL_DOMAINS.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`)
  );
}
