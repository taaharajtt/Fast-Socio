/**
 * FAST NUCES email validation (UI Spec §5.1; gates Phase 1 auth).
 *
 * Restricted to the FAST NUCES Islamabad campus: student mail is issued under
 * `isb.nu.edu.pk` (e.g. i240733@isb.nu.edu.pk). Batches before Fall 2023 were
 * instead issued org-wide addresses under the bare `nu.edu.pk` domain shared by
 * every campus, so those are admitted only when the local-part is an Islamabad
 * roll number ("i" + 6 digits, e.g. i221000@nu.edu.pk). Keep the allow-list
 * here so it is the single place to update if other campuses are onboarded
 * later. This must stay in sync with the DB trigger
 * (0097_allow_legacy_isb_nu_emails.sql), which is the authoritative gate.
 */
export const ALLOWED_EMAIL_DOMAINS = ["isb.nu.edu.pk"] as const;

/** Pre-2023 Islamabad address: roll number local-part on the org-wide domain. */
const LEGACY_ISB_EMAIL_RE = /^i\d{6}@nu\.edu\.pk$/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dev-only allow-list of specific full email addresses that may sign in even
 * though they are off-domain (comma-separated in NEXT_PUBLIC_DEV_ALLOWED_EMAILS).
 * Used for dogfooding before the app is opened to real FAST students. Leave the
 * env var unset in production so only isb.nu.edu.pk addresses pass.
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
  if (LEGACY_ISB_EMAIL_RE.test(value)) return true;
  const domain = value.slice(value.lastIndexOf("@") + 1);
  return ALLOWED_EMAIL_DOMAINS.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`)
  );
}
