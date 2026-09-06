/**
 * The first-contact message request, as pure rules.
 *
 * UAT-01 asks for the same request to be sendable from two places — the message
 * bubble on a Discover person card, and "Request to chat" on a profile — with
 * identical behaviour. The way that actually holds is for both to share ONE
 * validator and ONE server action, rather than two call sites that agree today
 * and drift the first time one of them is edited.
 *
 * The database enforces the same bounds in `send_message_request` (mig 0178);
 * this module exists so the composer can disable its own button and count
 * characters without a round trip, and so the boundary cases are unit-testable.
 */

/** Product rule (UAT-01). The table CHECK stays at 500 for historical rows. */
export const MESSAGE_REQUEST_MAX = 250;
export const MESSAGE_REQUEST_MIN = 1;

export type MessageRequestValidation =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Validate a request body exactly as the RPC does.
 *
 * Length is measured on the TRIMMED text, which is also what gets stored — so
 * 250 characters plus a trailing newline is accepted rather than rejected for
 * being 251, and a body of only whitespace is rejected rather than stored as an
 * empty opening line.
 */
export function validateMessageRequest(body: string): MessageRequestValidation {
  const text = body.trim();
  if (text.length < MESSAGE_REQUEST_MIN)
    return { ok: false, error: "Write a short message to send with your request." };
  if (text.length > MESSAGE_REQUEST_MAX)
    return {
      ok: false,
      error: `Keep it under ${MESSAGE_REQUEST_MAX} characters.`,
    };
  return { ok: true, text };
}

/** Remaining characters, floored at zero, for the composer's counter. */
export function messageRequestRemaining(body: string): number {
  return Math.max(0, MESSAGE_REQUEST_MAX - body.trim().length);
}

/**
 * Map a database error onto something a student can act on.
 *
 * The RPC deliberately answers "that account is not available" for both a block
 * and a deactivated account, so neither side can probe the other's block list by
 * comparing error text; that message is passed through unchanged.
 *
 * "not accepting message requests" is deliberately its OWN sentence rather than
 * being folded into that one. It is not a block and not a ban — it is a setting
 * the recipient has advertised by hiding the button — so telling the sender
 * plainly is what stops them retrying a request that can never land. It is also
 * the message a STALE profile produces: the button was rendered before the
 * recipient turned the setting on, and the database refuses the send.
 */
export function messageRequestError(raw: string | null | undefined): string {
  const message = (raw ?? "").toLowerCase();
  if (message.includes("1-250")) return `Keep it under ${MESSAGE_REQUEST_MAX} characters.`;
  if (message.includes("yourself")) return "You can’t send a request to yourself.";
  if (message.includes("not accepting message requests"))
    return "This person isn’t accepting message requests.";
  if (message.includes("not available")) return "That account is not available.";
  if (message.includes("not authenticated")) return "Sign in to send a request.";
  return "Couldn’t send that request — try again.";
}
