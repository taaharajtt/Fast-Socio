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

/** True if `email` is well-formed and on an allowed FAST domain. */
export function isValidFastEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  if (!EMAIL_RE.test(value)) return false;
  const domain = value.slice(value.lastIndexOf("@") + 1);
  return ALLOWED_EMAIL_DOMAINS.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`)
  );
}
