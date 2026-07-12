/**
 * Password validation for the email+password login model (signup sets a password
 * on the /set-password screen after the magic link; forgot-password resets it).
 *
 * Kept as a pure function so it is unit-testable without a running server and so
 * the same rule is shared by /set-password and any future server-side check.
 * Deliberately minimal — a single length floor — matching Supabase's own default
 * minimum; tighten here if a stronger policy is ever required.
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Returns a human-readable error string if `password` is unacceptable, or `null`
 * if it passes. (Not a boolean, so callers can surface the specific reason.)
 */
export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}
