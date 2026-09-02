/**
 * The feed composer's anonymity decision, as pure rules (UAT-13).
 *
 * The report was that a post the author did not mark anonymous came out
 * anonymous. Anonymity is not a display preference — once a post is written
 * anonymous, ordinary viewers can never be shown the author again — so the flag
 * has to be decided somewhere testable, with an explicit default, rather than
 * inferred from whatever the form state happened to be holding.
 *
 * Three rules, and every one of them exists because its absence is a real bug:
 *
 *  1. THE DEFAULT IS `false`, WRITTEN OUT. Not `undefined`, not a missing key,
 *     not a truthy form string ("false" and "0" are both truthy). A composer
 *     that forgets to send the field must produce an attributed post.
 *  2. ONLY A LITERAL `true` MAKES A POST ANONYMOUS. Anything else — undefined,
 *     null, "", "false", 0 — resolves to attributed.
 *  3. RESET IS PART OF THE LIFECYCLE. A composer that stays mounted across
 *     posts (the home feed's does) must clear the flag on success AND whenever
 *     it is reopened, or the second post silently inherits the first one's
 *     choice. That is the stale-modal-state path this module makes impossible
 *     to get wrong.
 */

export type ComposerDraft = {
  body: string;
  imageUrl: string | null;
  pollOptions: string[] | null;
  isAnonymous: boolean;
};

/** A composer's starting state. Anonymity is off, explicitly, every time. */
export function emptyComposerDraft(): ComposerDraft {
  return { body: "", imageUrl: null, pollOptions: null, isAnonymous: false };
}

/**
 * What the composer resets to after a successful post, or on reopen.
 *
 * Identical to `emptyComposerDraft` today and deliberately a separate name: the
 * two are the same thing only for as long as nothing is meant to persist
 * between posts, and if that ever changes the anonymity flag must NOT be what
 * persists.
 */
export function resetComposerDraft(): ComposerDraft {
  return emptyComposerDraft();
}

/**
 * The authoritative anonymity decision, applied on the server.
 *
 * `communityId` forces attribution: community Main-panel posts are always
 * attributed (anonymity lives in the community chat room instead), and because
 * the flag is client-supplied that rule is enforced here rather than trusted to
 * a hidden toggle.
 */
export function resolveAnonymity(
  requested: unknown,
  communityId?: string | null
): boolean {
  if (communityId) return false;
  return requested === true;
}
