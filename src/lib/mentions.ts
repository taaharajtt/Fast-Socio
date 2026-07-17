/**
 * Comment @-mentions.
 *
 * A confirmed mention is stored inside the comment body as a self-contained
 * token so it renders as a profile link with ZERO extra lookups on every
 * surface — server-rendered, lazy-loaded replies, and realtime-inserted rows:
 *
 *     @[i240733](3f6b…-uuid)   →   link text "@i240733"  →  /profile/<uuid>
 *
 * The visible link text is always the mentioned user's roll-number username;
 * the uuid is the link target. The composer never shows the raw token — it
 * tracks username→id in state and only serialises confirmed picks at submit.
 */

const USERNAME = "[a-z0-9_]{1,20}";
const UUID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** Matches a stored mention token, capturing (1) username and (2) uuid. */
const TOKEN_SOURCE = `@\\[(${USERNAME})\\]\\((${UUID})\\)`;

/** A plain "@handle" the composer may produce before serialisation. */
const HANDLE_RE = /@([a-z0-9_]{1,20})/gi;

export type MentionPart =
  | { type: "text"; value: string }
  | { type: "mention"; username: string; id: string };

/** Split a stored body into ordered plain-text runs and mention tokens. */
export function parseMentions(body: string): MentionPart[] {
  const parts: MentionPart[] = [];
  const re = new RegExp(TOKEN_SOURCE, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last)
      parts.push({ type: "text", value: body.slice(last, m.index) });
    parts.push({ type: "mention", username: m[1], id: m[2] });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ type: "text", value: body.slice(last) });
  return parts;
}

/** Build a stored mention token from a confirmed (username, id) pick. */
export function mentionToken(username: string, id: string): string {
  return `@[${username}](${id})`;
}

/** Flatten tokens back to plain "@username" (raw / plain-text surfaces). */
export function mentionsToPlainText(body: string): string {
  return body.replace(new RegExp(TOKEN_SOURCE, "g"), "@$1");
}

/**
 * Turn the composer's plain text (clean "@username" handles) into the stored
 * body. Only handles the user actually picked from autocomplete (tracked in
 * `mentions`: lowercased username → id) become tokens; anything merely typed
 * that looks like "@handle" is left as text.
 */
export function serializeMentions(
  text: string,
  mentions: Record<string, string>
): string {
  return text.replace(HANDLE_RE, (whole, name: string) => {
    const id = mentions[name.toLowerCase()];
    return id ? mentionToken(name.toLowerCase(), id) : whole;
  });
}

/**
 * The active "@query" the caret currently sits in, or null. A mention starts at
 * the beginning of the text or after whitespace, so email addresses (a@b) never
 * trigger it. `query` is the typed fragment after "@" (may be empty).
 */
export function activeMentionQuery(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const m = upto.match(/(?:^|\s)@([a-z0-9_]{0,20})$/i);
  if (!m) return null;
  const query = m[1];
  return { start: caret - query.length - 1, query };
}
