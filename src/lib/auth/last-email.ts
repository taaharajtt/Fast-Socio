/**
 * The email address this browser last signed in with.
 *
 * Exists to soften the one place iOS makes the app look broken: an installed
 * Home Screen web app gets its OWN storage partition, separate from Safari, so
 * it does not inherit the Safari session and opens at the login screen even
 * though the user signed in minutes earlier.
 *
 * READ THIS BEFORE ASSUMING IT DOES MORE THAN IT DOES. Because the partitions
 * are separate, an address written here in Safari is NOT visible to the
 * installed app — the same isolation that causes the re-login also prevents us
 * from carrying anything across it. There is no shared storage between the two,
 * and the one channel that would cross (baking a value into the URL that Safari
 * captures as the app's start URL) is out of the question: it would put a
 * personal identifier in a link that is bookmarked, shared and permanent.
 *
 * So this smooths the SECOND and later sign-ins inside the installed app —
 * session expiry, or signing back in — not the first one. The first launch is
 * handled by telling the truth instead (see the standalone note on /login).
 *
 * ONLY the email address is ever stored. Never a password, never a token,
 * never anything that could stand in for a session: this is a convenience for
 * typing, and it must not become a credential.
 */
const KEY = "fs-last-email";

/** Remember the address a successful sign-in used. */
export function rememberEmail(email: string): void {
  try {
    localStorage.setItem(KEY, email);
  } catch {
    /* private mode / storage disabled — the field simply starts empty */
  }
}

/**
 * The remembered address, or "".
 *
 * Deliberately NOT cleared on sign-out. An email address is not a secret, this
 * is a personal-phone campus app rather than a shared kiosk, and "sign out then
 * sign back in" is precisely the case the prefill is for — clearing it there
 * would remove most of the value for no real gain.
 */
export function recallEmail(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
