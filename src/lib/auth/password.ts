/**
 * Password validation for the email+password login model (signup sets a password
 * on the /set-password screen after the magic link; forgot-password resets it).
 *
 * Kept as a pure function so it is unit-testable without a running server and so
 * the same rule is shared by /set-password and any future server-side check.
 *
 * THIS MUST MIRROR THE SUPABASE AUTH CONFIG. GoTrue enforces the real policy;
 * this exists so the user is told the rule up front instead of round-tripping
 * into a raw server error. Live config as of 2026-07-17:
 *   password_min_length         = 10
 *   password_required_characters = lower : upper : digits
 * Change one, change the other.
 *
 * Hardening context (F3 / VULN-08): the server floor used to be 6 with no
 * complexity, which is what let the 2026-07-15 attacker brute-force /token.
 * This file said 8, so the client was the stricter gate — meaning `password` and
 * `12345678` were settable through the real form.
 *
 * On the character classes: they are a deliberate compromise, not a best
 * practice. NIST SP 800-63B advises against composition rules, because they
 * reject strong passphrases ("correct horse battery staple") while accepting
 * weak-but-compliant strings ("Password12"). The better control is a breach
 * list — Supabase's leaked-password protection (HaveIBeenPwned) — but that is
 * Pro-tier only and this project is on the free plan (HTTP 402, verified
 * 2026-07-17). Without it, classes are the only thing rejecting all-lowercase
 * wordlist entries like `password1234`. If this project ever moves to Pro:
 * enable password_hibp_enabled, drop password_required_characters, and let
 * length plus the breach list do the work.
 */
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Returns a human-readable error string if `password` is unacceptable, or `null`
 * if it passes. (Not a boolean, so callers can surface the specific reason.)
 *
 * Order matters: report length first, since it is the rule most likely to be
 * hit and the easiest to act on.
 */
export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[a-z]/.test(password)) {
    return "Password must include a lowercase letter.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must include an uppercase letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must include a number.";
  }
  return null;
}
