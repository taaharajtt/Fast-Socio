/**
 * Password validation for email/password auth (login/signup/reset).
 *
 * Kept as a pure function — the single place to tune the rule — so signup and
 * reset-password agree, and so it is unit-testable without a running app. The
 * authoritative minimum is also enforced by Supabase Auth; this mirrors it for
 * inline UX feedback. Mirrors the ALLOWED_EMAIL_DOMAINS pattern in ./email.ts.
 */

export const PASSWORD_MIN_LENGTH = 8;

/**
 * Returns a human-readable problem with `password`, or null if it is acceptable.
 * (Returning the message keeps call sites to a single branch.)
 */
export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.trim().length === 0) return "Password can't be blank.";
  return null;
}

/** Convenience boolean for disabling submit buttons. */
export function isValidPassword(password: string): boolean {
  return passwordError(password) === null;
}
